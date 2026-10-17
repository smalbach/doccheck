import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, ServiceUnavailableException, type OnApplicationBootstrap } from '@nestjs/common';
import { CLOUD_OCR_ENGINES, cloudOcrProblem, terminateOcr } from '@doccheck/extraction';
import { isDemo } from '../demo/demo-mode';
import { LLM_PROVIDER, providerFromEnvOrOllama } from '../llm/llm.module';
import type { SwitchableProvider } from '../llm/switchable-provider';
import { listOllamaModels } from './ollama-models';
import { isSettingKey, OCR_ENGINES, OCR_LANGUAGES, OCR_PSM_VALUES, SETTING_KEYS, SETTINGS, type SettingDefinition, type SettingKey } from './settings.definitions';
import { SettingsRepository } from './settings.repository';

export type SettingSource = 'default' | 'env' | 'admin';

export interface SettingView {
  key: SettingKey;
  value: unknown;
  source: SettingSource;
  defaultValue: unknown;
  /** What .env says, if anything (the value a reset goes back to). */
  envValue?: unknown;
  updatedAt?: string;
  updatedBy?: string;
}

/** Model and OCR settings: defaults, then .env, then what an admin saved; applied while the API runs. */
@Injectable()
export class SettingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SettingsService.name);
  /** .env as it was at start, before any admin value was written over it. */
  private readonly envAtStart: Partial<Record<SettingKey, string>> = Object.fromEntries(
    SETTING_KEYS.flatMap((k) => (process.env[SETTINGS[k].env] ? [[k, process.env[SETTINGS[k].env]]] : [])),
  );

  constructor(
    private readonly repo: SettingsRepository,
    @Inject(LLM_PROVIDER) private readonly provider: SwitchableProvider,
  ) {}

  /** Saved values apply at start (after migrations). The read-only demo keeps .env: its caches were built for it. */
  async onApplicationBootstrap() {
    if (isDemo()) return;
    for (const stored of await this.repo.list()) {
      if (!isSettingKey(stored.key)) continue;
      const parsed = (SETTINGS[stored.key] as SettingDefinition<unknown>).schema.safeParse(stored.value);
      if (parsed.success) await this.apply(stored.key, parsed.data);
      else this.logger.warn(`Ignoring saved setting ${stored.key}: ${parsed.error.issues[0]?.message}`);
    }
  }

  private fromEnv(key: SettingKey): unknown {
    const raw = this.envAtStart[key];
    return raw === undefined ? undefined : (SETTINGS[key] as SettingDefinition<unknown>).fromEnv(raw);
  }

  async list(): Promise<{
    settings: SettingView[];
    options: { ocrLanguages: string[]; ocrPsm: readonly string[]; ocrScale: { min: number; max: number }; ocrEngines: readonly string[] };
    editable: boolean;
    /** With the Unlimited-OCR engine in use: whether its server answers. */
    ocrServer?: { url: string; reachable: boolean };
  }> {
    const stored = new Map((await this.repo.list()).map((s) => [s.key, s]));
    const settings = SETTING_KEYS.map((key): SettingView => {
      const def = SETTINGS[key] as SettingDefinition<unknown>;
      const envValue = this.fromEnv(key);
      const saved = isDemo() ? undefined : stored.get(key);
      const base = { key, defaultValue: def.defaultValue, ...(envValue !== undefined ? { envValue } : {}) };
      if (saved) return { ...base, value: saved.value, source: 'admin', updatedAt: saved.updatedAt, ...(saved.updatedBy ? { updatedBy: saved.updatedBy } : {}) };
      return { ...base, value: envValue ?? def.defaultValue, source: envValue !== undefined ? 'env' : 'default' };
    });
    const value = <K extends SettingKey>(key: K) => settings.find((s) => s.key === key)?.value as (typeof SETTINGS)[K]['defaultValue'];
    const ocrServer = value('ocrEngine') === 'unlimited' ? { url: value('ocrUrl'), reachable: await ocrServerReachable(value('ocrUrl')) } : undefined;
    return {
      settings,
      options: { ocrLanguages: OCR_LANGUAGES, ocrPsm: OCR_PSM_VALUES, ocrScale: { min: 2, max: 6 }, ocrEngines: OCR_ENGINES },
      editable: !isDemo(),
      ...(ocrServer ? { ocrServer } : {}),
    };
  }

  /** Validates every value first, then saves and applies them together. */
  async update(values: Record<string, unknown>, userId: string) {
    if (isDemo()) throw new ForbiddenException('Settings are read-only in the demo');
    const entries: [SettingKey, unknown][] = [];
    for (const [key, raw] of Object.entries(values)) {
      if (!isSettingKey(key)) throw new BadRequestException(`Unknown setting ${key}`);
      const parsed = (SETTINGS[key] as SettingDefinition<unknown>).schema.safeParse(raw);
      if (!parsed.success) throw new BadRequestException(`${key}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      entries.push([key, parsed.data]);
    }
    const model = entries.find(([k]) => k === 'llmModel')?.[1] as string | undefined;
    if (model !== undefined) await this.assertInstalled(model);
    // Switching to Unlimited-OCR, or moving its server, needs a server that answers.
    const next = <K extends SettingKey>(key: K) => (entries.find(([k]) => k === key)?.[1] ?? this.current(key)) as (typeof SETTINGS)[K]['defaultValue'];
    if (entries.some(([k]) => k === 'ocrEngine' || k === 'ocrUrl') && next('ocrEngine') === 'unlimited' && !(await ocrServerReachable(next('ocrUrl')))) {
      throw new ServiceUnavailableException(`The Unlimited-OCR server at ${next('ocrUrl')} does not answer (start it with npm run ocr:server)`);
    }
    // A cloud engine needs its key (AI providers) and outside services allowed.
    const engine = entries.find(([k]) => k === 'ocrEngine')?.[1] as string | undefined;
    const cloudProblem = engine && (CLOUD_OCR_ENGINES as readonly string[]).includes(engine) ? cloudOcrProblem(engine) : undefined;
    if (cloudProblem) throw new BadRequestException(cloudProblem);
    await this.repo.save(entries, userId);
    for (const [key, value] of entries) await this.apply(key, value);
    this.logger.log(`Settings changed: ${entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`);
    return this.list();
  }

  async reset(key: string) {
    if (isDemo()) throw new ForbiddenException('Settings are read-only in the demo');
    if (!isSettingKey(key)) throw new BadRequestException(`Unknown setting ${key}`);
    await this.repo.remove(key);
    await this.apply(key, this.fromEnv(key) ?? SETTINGS[key].defaultValue);
    return this.list();
  }

  /** The value in effect: apply() writes saved values to process.env, which starts as .env. */
  private current(key: SettingKey): unknown {
    const def = SETTINGS[key] as SettingDefinition<unknown>;
    const raw = process.env[def.env];
    return raw ? def.fromEnv(raw) : def.defaultValue;
  }

  private async assertInstalled(model: string) {
    const models = await listOllamaModels();
    if (!models) throw new ServiceUnavailableException('Ollama is not reachable, so the model cannot be checked');
    const found = models.find((m) => m.name === model || m.name.replace(/:latest$/, '') === model);
    if (!found) throw new BadRequestException(`Model ${model} is not installed in Ollama`);
    if (found.embedding) throw new BadRequestException(`${model} is an embedding model; it cannot read documents`);
  }

  /** Writes the value where the packages read it and swaps what has to be swapped. */
  private async apply(key: SettingKey, value: unknown) {
    const def = SETTINGS[key] as SettingDefinition<unknown>;
    process.env[def.env] = def.toEnv(value);
    if (key === 'llmModel') this.provider.replace(providerFromEnvOrOllama(this.logger));
    // The OCR worker keeps its languages and page mode: a new one starts on the next scan.
    if (key === 'ocrLanguages' || key === 'ocrPsm') await terminateOcr();
  }
}

/** GET {url}/health answers 2xx within 2 s. */
async function ocrServerReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
