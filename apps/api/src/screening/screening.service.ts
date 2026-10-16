import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ShipmentContext } from '@doccheck/rules';
import {
  DEFAULT_THRESHOLDS, LIST_IDS, LISTS, loadScreening, partyKey, refreshLists, screenShipment, SOURCES,
  type ListVersion, type LoadedScreening, type RefreshOutcome, type ScreeningOutput, type ScreeningThresholds,
} from '@doccheck/screening';
import type { PublicUser } from '../auth/auth.types';
import { isDemo } from '../demo/demo-mode';
import type { AddAllowlistDto, SearchQuery, ThresholdsDto } from './screening.dto';
import { ScreeningRepository, THRESHOLD_KEYS } from './screening.repository';

/** Where the lists are cached: SCREENING_DIR, else data/screening of the repository. */
export function screeningDir(): string {
  if (process.env.SCREENING_DIR) return resolve(process.env.SCREENING_DIR);
  const candidates = [resolve(process.cwd(), 'data/screening'), resolve(__dirname, '../../../../data/screening')];
  return candidates.find((d) => existsSync(d)) ?? candidates.find((d) => existsSync(resolve(d, '..'))) ?? candidates[0];
}

interface RefreshRun {
  startedAt: string;
  by: string;
  finishedAt?: string;
  outcomes?: RefreshOutcome[];
  error?: string;
}

/**
 * Denied and restricted party screening. Lists are read from the cache on disk (data/screening)
 * when the API starts and after each refresh; nothing is fetched while validating, so screening
 * works offline. No party data leaves the server: the lists come in, nothing goes out.
 */
@Injectable()
export class ScreeningService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScreeningService.name);
  readonly dir = screeningDir();
  private loaded?: Promise<LoadedScreening>;
  private running?: RefreshRun;
  private last?: RefreshRun;

  constructor(private readonly repo: ScreeningRepository) {}

  onApplicationBootstrap() {
    void this.lists().then(
      (l) => this.logger.log(l.index.size ? `Screening against ${l.index.size} list entries from ${this.dir}` : `No screening lists cached in ${this.dir}: run npm run screening:fetch or refresh from Administration`),
      (err) => this.logger.warn(`Screening lists not loaded: ${err instanceof Error ? err.message : err}`),
    );
  }

  /** The cached lists, indexed (loaded once, again after a refresh). */
  lists(): Promise<LoadedScreening> {
    this.loaded ??= loadScreening(this.dir).catch((err) => {
      this.loaded = undefined;
      throw err;
    });
    return this.loaded;
  }

  /** Thresholds in effect: saved by an admin, else SCREENING_MATCH_THRESHOLD / SCREENING_REVIEW_THRESHOLD, else the defaults. */
  async thresholds(): Promise<ScreeningThresholds & { source: 'admin' | 'env' | 'default'; updatedAt?: string; updatedBy?: string }> {
    const saved = await this.repo.thresholds();
    const match = saved.find((s) => s.key === THRESHOLD_KEYS.match);
    const review = saved.find((s) => s.key === THRESHOLD_KEYS.review);
    if (typeof match?.value === 'number' && typeof review?.value === 'number') {
      return { match: match.value, review: review.value, source: 'admin', updatedAt: match.updatedAt, ...(match.updatedBy ? { updatedBy: match.updatedBy } : {}) };
    }
    const env = (name: string) => {
      const n = Number(process.env[name]);
      return process.env[name] && n >= 0.5 && n <= 1 ? n : undefined;
    };
    const envMatch = env('SCREENING_MATCH_THRESHOLD');
    const envReview = env('SCREENING_REVIEW_THRESHOLD');
    if (envMatch !== undefined || envReview !== undefined) {
      const m = envMatch ?? DEFAULT_THRESHOLDS.match;
      return { match: m, review: Math.min(envReview ?? DEFAULT_THRESHOLDS.review, m), source: 'env' };
    }
    return { ...DEFAULT_THRESHOLDS, source: 'default' };
  }

  async setThresholds(dto: ThresholdsDto, user: PublicUser) {
    if (isDemo()) throw new ForbiddenException('Settings are read-only in the demo');
    await this.repo.saveThresholds(dto, user.id);
    this.logger.log(`Screening thresholds set to match ${dto.match}, review ${dto.review} by ${user.email}`);
    return this.status();
  }

  async resetThresholds() {
    if (isDemo()) throw new ForbiddenException('Settings are read-only in the demo');
    await this.repo.resetThresholds();
    return this.status();
  }

  /** Lists with their cached version, the refresh state and the thresholds. */
  async status() {
    const loaded = await this.lists().catch(() => undefined);
    const versions = new Map((loaded?.manifest.lists ?? []).map((l) => [l.id, l]));
    const lists = LIST_IDS.map((id): ListVersion & { cached: boolean } => {
      const v = versions.get(id);
      const info = LISTS[id];
      return v
        ? { ...v, cached: v.entries > 0 }
        : { id, name: info.name, publisher: info.publisher, page: info.page, downloads: [], versionDate: '', fetchedAt: '', sha256: '', entries: 0, cached: false };
    });
    return {
      dir: this.dir,
      editable: !isDemo(),
      entries: loaded?.index.size ?? 0,
      ...(loaded?.manifest.refreshedAt ? { refreshedAt: loaded.manifest.refreshedAt } : {}),
      lists,
      refreshing: this.running ?? null,
      ...(this.last ? { lastRefresh: this.last } : {}),
      thresholds: { ...(await this.thresholds()), defaults: DEFAULT_THRESHOLDS },
    };
  }

  /**
   * Starts downloading the lists in the background (several minutes: the EU file is large) and
   * answers at once; GET status shows progress. Only one refresh runs at a time.
   */
  async refresh(user: PublicUser, only?: string[]) {
    if (isDemo()) throw new ForbiddenException('The lists cannot be refreshed in the demo');
    if (this.running) throw new ConflictException(`A refresh started at ${this.running.startedAt} is still running`);
    const known = new Set(SOURCES.map((s) => s.id));
    const unknown = (only ?? []).filter((s) => !known.has(s));
    if (unknown.length) throw new BadRequestException(`Unknown sources: ${unknown.join(', ')}`);
    const run: RefreshRun = { startedAt: new Date().toISOString(), by: user.email };
    this.running = run;
    this.logger.log(`Screening lists refresh started by ${user.email}`);
    void refreshLists(this.dir, { only: only?.length ? only : undefined })
      .then(({ outcomes }) => {
        run.outcomes = outcomes;
        for (const o of outcomes) if (!o.ok) this.logger.warn(`Screening source ${o.source} failed: ${o.error}`);
      })
      .catch((err) => {
        run.error = err instanceof Error ? err.message : String(err);
        this.logger.error(`Screening lists refresh failed: ${run.error}`);
      })
      .finally(() => {
        run.finishedAt = new Date().toISOString();
        this.last = run;
        this.running = undefined;
        this.loaded = undefined;
        void this.lists().catch(() => undefined);
      });
    return this.status();
  }

  /** "Check a name": the best entries for a name, each classed as the rules would. */
  async search(q: SearchQuery) {
    const [{ index }, t] = await Promise.all([this.lists(), this.thresholds()]);
    const review = Math.min(t.review, t.match);
    return {
      entries: index.size,
      thresholds: { match: t.match, review },
      matches: index.search({ name: q.q, country: q.country, city: q.city }, { minScore: Math.min(0.7, review), limit: 10 }).map((m) => ({
        list: m.entry.list,
        listName: LISTS[m.entry.list]?.name ?? m.entry.list,
        entry: m.entry,
        matchedName: m.matchedName,
        score: m.score,
        nameScore: m.nameScore,
        countryAdjust: m.countryAdjust,
        cityAdjust: m.cityAdjust,
        outcome: m.score >= t.match ? 'match' : m.score >= review ? 'review' : 'below',
      })),
    };
  }

  /** Screens a validation's parties against the lists with the owner account's allowlist. */
  async screen(ctx: ShipmentContext): Promise<ScreeningOutput & { lists: number }> {
    const [loaded, t, owner] = await Promise.all([this.lists().catch(() => undefined), this.thresholds(), this.repo.shipmentOwner(ctx.shipmentId).catch(() => undefined)]);
    const allowlist = owner ? await this.repo.activeAllowlist(owner) : [];
    const out = screenShipment(ctx, loaded && loaded.index.size > 0 ? loaded.index : undefined, { thresholds: t, allowlist, versions: loaded?.versions });
    return { ...out, lists: loaded?.manifest.lists.filter((l) => l.entries > 0).length ?? 0 };
  }

  allowlist(user: PublicUser, opts: { history: boolean; all: boolean }) {
    if (opts.all && user.role !== 'admin') throw new ForbiddenException('Only admins can see every account’s allowlist');
    return this.repo.list(opts.all ? undefined : user.id, opts.history);
  }

  /** Sets aside a match for the user's account. The entry must be on a cached list. */
  async addAllowlist(user: PublicUser, dto: AddAllowlistDto) {
    const { index } = await this.lists();
    const entry = index.entries.find((e) => e.list === dto.list && e.id === dto.entryId);
    if (!entry) throw new NotFoundException(`No entry ${dto.entryId} on list ${dto.list}`);
    const key = partyKey(dto.partyName);
    if (!key) throw new BadRequestException('The party name has no letters or digits');
    const added = await this.repo.add({ userId: user.id, partyName: dto.partyName, partyKey: key, list: dto.list, entryId: dto.entryId, entryName: entry.name, reason: dto.reason, createdBy: user.id });
    if (!added) throw new ConflictException('This match is already on your allowlist');
    this.logger.log(`Allowlist: ${user.email} set aside "${dto.partyName}" vs ${dto.list}/${dto.entryId}`);
    return added;
  }

  /** Puts a match back: the next validation flags it again. Admins can do it for any account. */
  async removeAllowlist(user: PublicUser, id: string, reason?: string) {
    const item = await this.repo.find(id);
    if (!item || (item.userId !== user.id && user.role !== 'admin')) throw new NotFoundException(`Allowlist entry ${id} not found`);
    if (item.removedAt) throw new ConflictException('Already removed');
    await this.repo.remove(id, user.id, reason || undefined);
    this.logger.log(`Allowlist: ${user.email} removed "${item.partyName}" vs ${item.list}/${item.entryId}`);
    return this.repo.find(id);
  }
}
