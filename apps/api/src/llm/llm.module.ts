import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { llmFromEnv, type LlmClient } from '@doccheck/extraction';
import { loadIndexFile, OllamaEmbedder, type RegulationIndex } from '@doccheck/regulations';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

export const LLM = Symbol('LLM');

/** The local model client, with every call logged to llm_calls. */
const llmProvider = {
  provide: LLM,
  inject: [PG_POOL],
  useFactory: (pool: Pool): LlmClient => {
    const llm = llmFromEnv();
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
    const index = await loadIndexFile(file, new OllamaEmbedder(model, process.env.OLLAMA_BASE_URL || undefined));
    this.logger.log(`Loaded ${index.chunks.length} regulation chunks from ${file}`);
    return index;
  }
}

@Global()
@Module({
  providers: [llmProvider, RegulationsService],
  exports: [LLM, RegulationsService],
})
export class LlmModule {}

export const InjectLlm = () => Inject(LLM);
