import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '../auth/auth.types';
import { isDemo } from '../demo/demo-mode';
import { LLM_PROVIDER, RegulationsService } from '../llm/llm.module';
import type { SwitchableProvider } from '../llm/switchable-provider';
import { AdminRepository } from './admin.repository';
import { modelAccuracy } from './model-accuracy';
import { listOllamaModels } from './ollama-models';

@Injectable()
export class AdminService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly regulations: RegulationsService,
    @Inject(LLM_PROVIDER) private readonly provider: SwitchableProvider,
  ) {}

  /** Installed models, which one is in use, and what each scored on the evaluation set if it was measured. */
  async models() {
    const installed = await listOllamaModels();
    const current = this.provider.id.replace(/^ollama:/, '');
    const models = await Promise.all(
      (installed ?? []).filter((m) => !m.embedding).map(async (m) => ({
        ...m,
        current: m.name === current || m.name === `${current}:latest`,
        evaluated: await modelAccuracy(m.name),
      })),
    );
    return { reachable: installed !== null, current, models };
  }

  /** What the server is running with right now. */
  async system() {
    const [installed, build, index, counts] = await Promise.all([listOllamaModels(), this.provider.version(), this.regulations.get(), this.repo.counts()]);
    return {
      demo: isDemo(),
      ollama: { url: process.env.OLLAMA_BASE_URL || 'http://localhost:11434', reachable: installed !== null, models: installed?.length ?? 0 },
      model: { provider: this.provider.id, build: build ?? null },
      embeddings: { model: process.env.EMBED_MODEL || 'bge-m3', chunks: index?.chunks.length ?? null },
      queue: process.env.REDIS_URL ? 'bullmq' : 'in-process',
      storage: process.env.S3_ENDPOINT ? 's3' : 'disk',
      cache: { dir: process.env.LLM_CACHE_DIR || null, mode: process.env.LLM_CACHE_MODE || (process.env.LLM_CACHE_DIR ? 'readwrite' : 'off') },
      ocr: { engine: process.env.OCR_ENGINE === 'unlimited' ? 'unlimited' : 'tesseract', languages: (process.env.OCR_LANGS ?? 'eng+fra').split('+'), scale: Number(process.env.OCR_SCALE ?? 4), psm: process.env.OCR_PSM ?? '6' },
      agentEnabled: process.env.AGENT_ENABLED !== 'false',
      counts,
    };
  }

  users() {
    return this.repo.users();
  }

  /** Nobody changes their own role (no accidental lock-out); the last admin cannot be demoted. */
  async setRole(actorId: string, userId: string, role: Role) {
    if (actorId === userId) throw new BadRequestException('You cannot change your own role');
    const res = await this.repo.setRole(userId, role);
    if (res === 'not-found') throw new NotFoundException(`User ${userId} not found`);
    if (res === 'last-admin') throw new ConflictException('There must be at least one admin');
    return this.repo.users();
  }
}
