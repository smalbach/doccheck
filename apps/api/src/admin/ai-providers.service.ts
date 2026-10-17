import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { CLOUD_OCR_ENGINES, cloudOcrProblem, llmProviderFromEnv, ocrCloudImage, ocrEngine, ocrTestImage } from '@doccheck/extraction';
import { buildIndexFile, embedderFromEnv, indexName } from '@doccheck/regulations';
import { findTariffDir, loadTariffData, MemoryVectors, vectorIndexFile } from '@doccheck/tariff';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../db/db.module';
import { isDemo } from '../demo/demo-mode';
import { corpusDir, embedderFromEnvOrNull, LLM_PROVIDER, providerFromEnvOrOllama, RegulationsService } from '../llm/llm.module';
import type { SwitchableProvider } from '../llm/switchable-provider';
import { open, seal, type Sealed } from '../messaging/secret-box';
import { TariffService } from '../tariff/tariff.service';
import type { AiProvidersDto } from './ai-providers.dto';

const KEY = 'aiProviders';

/** What the model, embedding and OCR code reads; a saved configuration writes them, a reset puts .env back. */
const ENV_KEYS = [
  'AI_LOCAL_ONLY',
  'LLM_PROVIDER',
  'LLM_REMOTE_MODEL',
  'EMBED_PROVIDER',
  'EMBED_MODEL',
  'EMBED_DIMENSIONS',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_VISION_API_KEY',
  'TEXTRACT_REGION',
  'TEXTRACT_ACCESS_KEY_ID',
  'TEXTRACT_SECRET_ACCESS_KEY',
  'AZURE_DI_ENDPOINT',
  'AZURE_DI_API_KEY',
] as const;
type EnvKey = (typeof ENV_KEYS)[number];

type Credentials = AiProvidersDto['credentials'];
type CredentialName = keyof Credentials;
/** The secret field of each credential. */
const SECRET_FIELD: Record<CredentialName, string> = {
  openai: 'apiKey',
  azureOpenai: 'apiKey',
  anthropic: 'apiKey',
  gemini: 'apiKey',
  googleVision: 'apiKey',
  awsTextract: 'secretAccessKey',
  azureDi: 'apiKey',
};
/** The variable each credential's secret comes from in .env. */
const SECRET_ENV: Record<CredentialName, EnvKey> = {
  openai: 'OPENAI_API_KEY',
  azureOpenai: 'AZURE_OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  googleVision: 'GOOGLE_VISION_API_KEY',
  awsTextract: 'TEXTRACT_SECRET_ACCESS_KEY',
  azureDi: 'AZURE_DI_API_KEY',
};
const CREDENTIALS = Object.keys(SECRET_FIELD) as CredentialName[];

type StoredCredential = Record<string, unknown> & { secret?: Sealed };
interface Stored extends Omit<AiProvidersDto, 'credentials'> {
  credentials: Partial<Record<CredentialName, StoredCredential | null>>;
}

/** A credential as the settings page shows it: everything but the secret, which is only "set". */
type CredentialView = Record<string, unknown> & { hasKey: boolean };

export interface ReindexJob {
  running: boolean;
  embedder: string;
  step: string;
  done: number;
  total: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

/**
 * Which model services DocCheck uses (local Ollama and Tesseract by default; OpenAI-compatible,
 * Azure OpenAI, Anthropic, Gemini, Google Vision, Textract and Azure Document Intelligence when an
 * admin allows outside services), with their keys sealed (secret-box.ts). Saved values are applied
 * by writing the variables the packages read, like the other settings.
 */
@Injectable()
export class AiProvidersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiProvidersService.name);
  private readonly envAtStart = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<EnvKey, string | undefined>;
  private stored?: { value: Stored; updatedAt: string; updatedBy?: string };
  private job?: ReindexJob;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(LLM_PROVIDER) private readonly provider: SwitchableProvider,
    private readonly regulations: RegulationsService,
    private readonly tariff: TariffService,
  ) {}

  async onApplicationBootstrap() {
    if (isDemo()) return;
    const { rows } = await this.pool.query('select s.value, s.updated_at, u.email from settings s left join users u on u.id = s.updated_by where s.key = $1', [KEY]);
    if (!rows[0]) return;
    this.stored = { value: rows[0].value, updatedAt: new Date(rows[0].updated_at).toISOString(), ...(rows[0].email ? { updatedBy: rows[0].email } : {}) };
    this.apply(this.stored.value);
    if (CREDENTIALS.some((c) => this.stored!.value.credentials[c]?.secret && !open(this.stored!.value.credentials[c]!.secret!))) {
      this.logger.error('Saved AI provider keys cannot be read with this SETTINGS_KEY: enter them again in the settings');
    }
  }

  view() {
    const editable = !isDemo();
    const config = this.stored ? this.viewOf(this.stored.value) : this.viewOfEnv();
    const embedder = embedderFromEnvOrNull();
    const tariffDir = findTariffDir();
    const regulationsFile = embedder ? this.regulations.indexFile(embedder) : undefined;
    return {
      source: this.stored ? ('admin' as const) : ('env' as const),
      editable,
      ...(this.stored ? { updatedAt: this.stored.updatedAt, ...(this.stored.updatedBy ? { updatedBy: this.stored.updatedBy } : {}) } : {}),
      config,
      active: { llm: this.provider.id, embeddings: embedder?.id ?? null, ocr: ocrEngine() },
      indexes: {
        embedder: embedder?.id ?? null,
        regulations: !!regulationsFile && existsSync(regulationsFile),
        tariff: Object.fromEntries((['US', 'CA'] as const).map((d) => [d, !!embedder && !!tariffDir && existsSync(vectorIndexFile(tariffDir, d, indexName(embedder.id)))])),
      },
      ...(this.job ? { reindex: this.job } : {}),
    };
  }

  async save(dto: AiProvidersDto, userId: string) {
    if (isDemo()) throw new ForbiddenException('Settings are read-only in the demo');
    const value = this.merge(dto);
    this.check(value);
    await this.pool.query(
      `insert into settings (key, value, updated_by) values ($1, $2, $3)
       on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
      [KEY, JSON.stringify(value), userId],
    );
    const { rows } = await this.pool.query('select email from users where id = $1', [userId]);
    this.stored = { value, updatedAt: new Date().toISOString(), ...(rows[0]?.email ? { updatedBy: rows[0].email } : {}) };
    this.apply(value);
    this.logger.log(
      `AI providers saved: local only ${value.localOnly ? 'on' : 'off'}, model ${this.provider.id}, embeddings ${embedderFromEnvOrNull()?.id ?? 'off'}, keys for ${CREDENTIALS.filter((c) => value.credentials[c]).join(', ') || 'none'}`,
    );
    return this.view();
  }

  async reset() {
    if (isDemo()) throw new ForbiddenException('Settings are read-only in the demo');
    const env: Partial<Record<EnvKey, string>> = Object.fromEntries(ENV_KEYS.flatMap((k) => (this.envAtStart[k] === undefined ? [] : [[k, this.envAtStart[k]]])));
    const problem = this.ocrProblem({ ...this.baseEnv(), ...env });
    if (problem) throw new BadRequestException(`Choose another OCR engine first: ${problem}`);
    await this.pool.query('delete from settings where key = $1', [KEY]);
    this.stored = undefined;
    this.writeEnv(env);
    return this.view();
  }

  /** Tries one service with `dto` (unsaved values; empty keys take the saved ones) or what is in effect. */
  async test(target: string, dto: AiProvidersDto | undefined): Promise<{ ok: boolean; detail: string }> {
    if (isDemo()) throw new ForbiddenException('Settings are read-only in the demo');
    const env = dto ? { ...this.baseEnv(), ...this.envOf(this.merge(dto)) } : { ...process.env };
    const secrets = ENV_KEYS.filter((k) => /KEY|SECRET/.test(k)).flatMap((k) => (env[k] ? [env[k]!] : []));
    const started = Date.now();
    try {
      if (target === 'llm') {
        const provider = llmProviderFromEnv(env);
        const { output } = await provider.generate({
          system: 'You check that a connection works. Answer with JSON only.',
          user: 'Return {"ok": true}.',
          schema: z.object({ ok: z.boolean() }),
          signal: AbortSignal.timeout(90_000),
        });
        if ((output as { ok?: unknown })?.ok !== true) return { ok: false, detail: `${provider.id} answered, but not with the expected JSON` };
        return { ok: true, detail: `${provider.id} answered in ${Date.now() - started} ms` };
      }
      if (target === 'embeddings') {
        const embedder = embedderFromEnv(env);
        const [v] = await embedder.embed(['DocCheck connection test']);
        return { ok: true, detail: `${embedder.id}: ${v?.length ?? 0} dimensions in ${Date.now() - started} ms` };
      }
      if ((CLOUD_OCR_ENGINES as readonly string[]).includes(target)) {
        const problem = cloudOcrProblem(target, env);
        if (problem) return { ok: false, detail: problem };
        const words = await ocrCloudImage(target, await ocrTestImage(), env);
        const text = words.map((w) => w.str).join(' ');
        return { ok: /12345/.test(text), detail: text ? `Read "${text.slice(0, 80)}" in ${Date.now() - started} ms` : 'No text recognized on the test image' };
      }
      throw new BadRequestException(`Unknown test target ${target}`);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      let detail = (err instanceof Error ? err.message : String(err)).slice(0, 400);
      for (const s of secrets) detail = detail.split(s).join('***');
      return { ok: false, detail };
    }
  }

  /**
   * Embeds the regulation corpus and the tariff lines with the current embedding model, in the
   * background (the view reports progress); search uses the new indexes once they are written.
   */
  reindex(scope: 'all' | 'regulations' | 'tariff' = 'all'): ReindexJob {
    if (isDemo()) throw new ForbiddenException('Settings are read-only in the demo');
    if (this.job?.running) throw new ConflictException('Indexes are already being rebuilt');
    let embedder;
    try {
      embedder = embedderFromEnv(process.env);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    const corpus = corpusDir();
    const job: ReindexJob = { running: true, embedder: embedder.id, step: scope === 'tariff' ? 'tariff' : 'regulations', done: 0, total: 0, startedAt: new Date().toISOString() };
    this.job = job;
    void (async () => {
      if (corpus && scope !== 'tariff') {
        await buildIndexFile(corpus, resolve(corpus, 'index', `${indexName(embedder.id)}.json`), embedder);
        this.regulations.reset();
      }
      const dir = findTariffDir();
      for (const destination of dir && scope !== 'regulations' ? (['US', 'CA'] as const) : []) {
        job.step = `tariff-${destination}`;
        const { schedule } = await loadTariffData(dir!, destination);
        const vectors = await MemoryVectors.build(schedule, embedder, {
          onProgress: (done, total) => {
            job.done = done;
            job.total = total;
          },
        });
        await vectors.save(vectorIndexFile(dir!, destination, indexName(embedder.id)), schedule);
      }
      this.tariff.reset();
      job.step = 'done';
      this.logger.log(`Indexes rebuilt with ${embedder.id}`);
    })()
      .catch((err: unknown) => {
        job.error = (err instanceof Error ? err.message : String(err)).slice(0, 400);
        this.logger.error(`Rebuilding the indexes with ${embedder.id} failed: ${job.error}`);
      })
      .finally(() => {
        job.running = false;
        job.finishedAt = new Date().toISOString();
      });
    return job;
  }

  /** Whatever the configuration does not set: the process environment without this service's variables. */
  private baseEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const k of ENV_KEYS) delete env[k];
    return env;
  }

  /** Refuses a configuration that cannot run: missing keys, or an outside service while local only is on. */
  private check(value: Stored) {
    const env = { ...this.baseEnv(), ...this.envOf(value) };
    for (const [what, build] of [
      ['Model', () => llmProviderFromEnv(env)],
      ['Embeddings', () => embedderFromEnv(env)],
    ] as const) {
      try {
        build();
      } catch (err) {
        throw new BadRequestException(`${what}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const problem = this.ocrProblem(env);
    if (problem) throw new BadRequestException(`OCR (${ocrEngine()}): ${problem}. Choose another OCR engine first.`);
  }

  private ocrProblem(env: NodeJS.ProcessEnv) {
    const engine = ocrEngine();
    return (CLOUD_OCR_ENGINES as readonly string[]).includes(engine) ? cloudOcrProblem(engine, env) : undefined;
  }

  /** The variables a configuration sets (undefined: not set, so the default applies). */
  private envOf(v: Stored): Partial<Record<EnvKey, string>> {
    const c = v.credentials;
    const secret = (name: CredentialName) => {
      const sealed = c[name]?.secret;
      return sealed ? open(sealed) : undefined;
    };
    const str = (x: unknown) => (typeof x === 'string' && x ? x : undefined);
    const env: Partial<Record<EnvKey, string | undefined>> = {
      AI_LOCAL_ONLY: String(v.localOnly),
      LLM_PROVIDER: v.llm.provider,
      LLM_REMOTE_MODEL: v.llm.provider === 'ollama' ? undefined : (v.llm.model ?? undefined),
      EMBED_PROVIDER: v.embeddings.provider,
      // Ollama without a model set keeps EMBED_MODEL from .env (bge-m3 by default).
      EMBED_MODEL: v.embeddings.model ?? (v.embeddings.provider === 'ollama' ? this.envAtStart.EMBED_MODEL : undefined),
      EMBED_DIMENSIONS: v.embeddings.dimensions ? String(v.embeddings.dimensions) : undefined,
      OPENAI_BASE_URL: str(c.openai?.baseUrl),
      OPENAI_API_KEY: secret('openai'),
      AZURE_OPENAI_ENDPOINT: str(c.azureOpenai?.endpoint),
      AZURE_OPENAI_API_VERSION: str(c.azureOpenai?.apiVersion),
      AZURE_OPENAI_API_KEY: secret('azureOpenai'),
      ANTHROPIC_API_KEY: secret('anthropic'),
      GEMINI_API_KEY: secret('gemini'),
      GOOGLE_VISION_API_KEY: secret('googleVision'),
      TEXTRACT_REGION: str(c.awsTextract?.region),
      TEXTRACT_ACCESS_KEY_ID: str(c.awsTextract?.accessKeyId),
      TEXTRACT_SECRET_ACCESS_KEY: secret('awsTextract'),
      AZURE_DI_ENDPOINT: str(c.azureDi?.endpoint),
      AZURE_DI_API_KEY: secret('azureDi'),
    };
    return Object.fromEntries(Object.entries(env).filter(([, x]) => x !== undefined)) as Partial<Record<EnvKey, string>>;
  }

  private apply(v: Stored) {
    this.writeEnv(this.envOf(v));
  }

  /** Sets exactly these variables (the others of ENV_KEYS are removed) and swaps what reads them. */
  private writeEnv(env: Partial<Record<EnvKey, string>>) {
    for (const k of ENV_KEYS) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    this.provider.replace(providerFromEnvOrOllama(this.logger));
    this.regulations.reset();
    this.tariff.reset();
  }

  /**
   * The DTO with its secrets sealed. An empty secret keeps the saved one or, while the
   * configuration still comes from .env, the one in .env.
   */
  private merge(dto: AiProvidersDto): Stored {
    const credentials: Stored['credentials'] = {};
    for (const name of CREDENTIALS) {
      const given = dto.credentials[name] as (Record<string, unknown> | null) | undefined;
      if (!given) {
        credentials[name] = null;
        continue;
      }
      const field = SECRET_FIELD[name];
      const { [field]: plain, ...rest } = given;
      const fromEnv = this.envAtStart[SECRET_ENV[name]];
      const secret = typeof plain === 'string' && plain ? seal(plain) : (this.stored?.value.credentials[name]?.secret ?? (fromEnv ? seal(fromEnv) : undefined));
      credentials[name] = { ...rest, ...(secret ? { secret } : {}) };
    }
    return { localOnly: dto.localOnly, llm: dto.llm, embeddings: dto.embeddings, credentials };
  }

  private viewOf(v: Stored) {
    const credentials = Object.fromEntries(
      CREDENTIALS.map((name) => {
        const c = v.credentials[name];
        if (!c) return [name, null];
        const { secret, ...rest } = c;
        return [name, { ...rest, hasKey: !!secret } satisfies CredentialView];
      }),
    ) as Record<CredentialName, CredentialView | null>;
    return { localOnly: v.localOnly, llm: v.llm, embeddings: v.embeddings, credentials };
  }

  /** The configuration .env describes, in the same shape. */
  private viewOfEnv() {
    const e = this.envAtStart;
    const has = (k: EnvKey) => !!e[k];
    const llmProvider = (e.LLM_PROVIDER || 'ollama') as AiProvidersDto['llm']['provider'];
    const embedProvider = (e.EMBED_PROVIDER || 'ollama') as AiProvidersDto['embeddings']['provider'];
    return {
      localOnly: e.AI_LOCAL_ONLY !== 'false',
      llm: { provider: llmProvider, model: llmProvider === 'ollama' ? null : (e.LLM_REMOTE_MODEL ?? null) },
      embeddings: { provider: embedProvider, model: embedProvider === 'ollama' ? null : (e.EMBED_MODEL ?? null), dimensions: Number(e.EMBED_DIMENSIONS) || null },
      credentials: {
        openai: e.OPENAI_BASE_URL || has('OPENAI_API_KEY') ? { baseUrl: e.OPENAI_BASE_URL || 'https://api.openai.com/v1', hasKey: has('OPENAI_API_KEY') } : null,
        azureOpenai: e.AZURE_OPENAI_ENDPOINT ? { endpoint: e.AZURE_OPENAI_ENDPOINT, apiVersion: e.AZURE_OPENAI_API_VERSION || '2024-10-21', hasKey: has('AZURE_OPENAI_API_KEY') } : null,
        anthropic: has('ANTHROPIC_API_KEY') ? { hasKey: true } : null,
        gemini: has('GEMINI_API_KEY') ? { hasKey: true } : null,
        googleVision: has('GOOGLE_VISION_API_KEY') ? { hasKey: true } : null,
        awsTextract: e.TEXTRACT_REGION ? { region: e.TEXTRACT_REGION, accessKeyId: e.TEXTRACT_ACCESS_KEY_ID ?? '', hasKey: has('TEXTRACT_SECRET_ACCESS_KEY') } : null,
        azureDi: e.AZURE_DI_ENDPOINT ? { endpoint: e.AZURE_DI_ENDPOINT, hasKey: has('AZURE_DI_API_KEY') } : null,
      } as Record<CredentialName, CredentialView | null>,
    };
  }
}
