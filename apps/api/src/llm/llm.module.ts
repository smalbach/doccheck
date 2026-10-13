import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { llmFromEnv, terminateOcr, type LlmClient } from '@doccheck/extraction';
import { CachedEmbedder, loadIndexFile, OllamaEmbedder, type RegulationIndex } from '@doccheck/regulations';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { isDemo } from '../demo/demo-mode';

export const LLM = Symbol('LLM');

const repoRoot = () => [process.cwd(), resolve(__dirname, '../../../..')].find((d) => existsSync(resolve(d, 'eval'))) ?? process.cwd();

/** The local model client, with every call logged to llm_calls. */
const llmProvider = {
  provide: LLM,
  inject: [PG_POOL],
  useFactory: (pool: Pool): LlmClient => {
    // The read-only demo never calls the model: cached answers only, a miss is an error.
    const llm = isDemo()
      ? llmFromEnv({ ...process.env, LLM_CACHE_MODE: 'replay', LLM_CACHE_DIR: process.env.LLM_CACHE_DIR || resolve(repoRoot(), 'eval/cache', `ollama_${process.env.LLM_MODEL || 'qwen3.8'}`) })
      : llmFromEnv();
    llm.tracer = async (t) => {
      await pool.query(
        'insert into llm_calls (provider, model_version, prompt_version, cache_key, cached, ms, input_tokens, output_tokens, error) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [t.provider, t.modelVersion ?? null, t.promptVersion, t.key, t.cached, t.ms, t.usage?.inputTokens ?? null, t.usage?.outputTokens ?? null, t.error ?? null],
      );
    };
    return llm;
  },
};

/** Regulation index, loaded on first use from data/corpus/index/<EMBED_MODEL>.json. */
@Injectable()
export class RegulationsService {
  private readonly logger = new Logger(RegulationsService.name);
  private index?: Promise<RegulationIndex | null>;

  get(): Promise<RegulationIndex | null> {
    this.index ??= this.load();
    return this.index;
  }

  private async load(): Promise<RegulationIndex | null> {
    const model = process.env.EMBED_MODEL || 'bge-m3';
    const dirs = [process.env.CORPUS_DIR, resolve(process.cwd(), 'data/corpus'), resolve(__dirname, '../../../../data/corpus')].filter((d): d is string => !!d);
    const file = dirs.map((d) => resolve(d, 'index', `${model}.json`)).find((f) => existsSync(f));
    if (!file) {
      this.logger.warn(`No regulation index for ${model}; run npm run corpus:index. Findings will have no citations.`);
      return null;
    }
    // Citation queries are a fixed set; their vectors are kept next to the index so the demo needs
    // no embedding model. A query missing there is searched by keywords only.
    const embedder = new CachedEmbedder(new OllamaEmbedder(model, process.env.OLLAMA_BASE_URL || undefined), file.replace(/\.json$/, '.queries.json'), isDemo() ? 'replay' : 'readwrite');
    const index = await loadIndexFile(file, embedder);
    this.logger.log(`Loaded ${index.chunks.length} regulation chunks from ${file}`);
    return index;
  }
}

@Global()
@Module({
  providers: [llmProvider, RegulationsService],
  exports: [LLM, RegulationsService],
})
export class LlmModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    await terminateOcr();
  }
}

export const InjectLlm = () => Inject(LLM);
