import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isChatWebhookUrl, type ChatKind, type EventType, type WebhookEvent } from '@doccheck/integrations';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { open, seal, type Sealed } from '../messaging/secret-box';
import { DeliveryWorker, toDeliveryView, type TargetType } from './deliveries';
import type { CreateChatAlertDto, CreateWebhookDto, UpdateChatAlertDto, UpdateWebhookDto } from './integrations.dto';
import { allowPrivateUrls, checkUrl } from './safe-fetch';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const newSecret = () => `whsec_${[...randomBytes(32)].map((b) => ALPHABET[b % ALPHABET.length]).join('')}`;

export interface WebhookView {
  id: string;
  url: string;
  description: string | null;
  events: EventType[];
  active: boolean;
  createdAt: string;
  lastDelivery: { status: string; at: string; responseStatus: number | null } | null;
}

export interface ChatAlertView {
  id: string;
  kind: ChatKind;
  name: string;
  /** Only the host: the URL itself is a credential. */
  urlHost: string;
  events: EventType[];
  includeDetails: boolean;
  active: boolean;
  createdAt: string;
  lastDelivery: { status: string; at: string; responseStatus: number | null } | null;
}

const last = (r: Record<string, unknown>) => (r.last_status ? { status: r.last_status as string, at: new Date(r.last_at as string).toISOString(), responseStatus: (r.last_response as number) ?? null } : null);
const LAST_DELIVERY = `left join lateral (select status as last_status, created_at as last_at, response_status as last_response from integration_deliveries d where d.target_id = t.id order by created_at desc limit 1) ld on true`;

/** Webhook subscriptions and chat alerts of an account, their test sends and delivery logs. */
@Injectable()
export class TargetsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly deliveries: DeliveryWorker,
  ) {}

  private checkWebhookUrl(url: string) {
    const reason = checkUrl(url);
    if (reason) throw new BadRequestException(reason);
  }

  private checkChatUrl(kind: ChatKind, url: string) {
    // In tests (private URLs allowed) a local receiver stands in for Slack or Teams.
    if (allowPrivateUrls() && !checkUrl(url)) return;
    if (!isChatWebhookUrl(kind, url)) throw new BadRequestException(kind === 'slack' ? 'Paste a Slack incoming-webhook URL (https://hooks.slack.com/...)' : 'Paste a Teams incoming-webhook or Workflows URL (https://...webhook.office.com/... or ...logic.azure.com/...)');
  }

  // Webhooks

  async listWebhooks(accountId: string): Promise<WebhookView[]> {
    const { rows } = await this.pool.query(`select t.*, ld.* from webhook_subscriptions t ${LAST_DELIVERY} where t.account_id = $1 order by t.created_at`, [accountId]);
    return rows.map((r) => ({ id: r.id, url: r.url, description: r.description, events: r.events, active: r.active, createdAt: new Date(r.created_at).toISOString(), lastDelivery: last(r) }));
  }

  /** The signing secret is in the answer; it can be shown again later from the app. */
  async createWebhook(accountId: string, dto: CreateWebhookDto): Promise<WebhookView & { secret: string }> {
    this.checkWebhookUrl(dto.url);
    const id = randomUUID();
    const secret = newSecret();
    await this.pool.query('insert into webhook_subscriptions (id, account_id, url, description, events, secret) values ($1, $2, $3, $4, $5, $6)', [id, accountId, dto.url, dto.description || null, dto.events, JSON.stringify(seal(secret))]);
    return { ...(await this.webhook(accountId, id)), secret };
  }

  async webhook(accountId: string, id: string): Promise<WebhookView> {
    const found = (await this.listWebhooks(accountId)).find((w) => w.id === id);
    if (!found) throw new NotFoundException(`Webhook ${id} not found`);
    return found;
  }

  async updateWebhook(accountId: string, id: string, dto: UpdateWebhookDto) {
    if (dto.url !== undefined) this.checkWebhookUrl(dto.url);
    const { rowCount } = await this.pool.query(
      `update webhook_subscriptions set url = coalesce($3, url), description = case when $4 then $5 else description end, events = coalesce($6, events), active = coalesce($7, active) where id = $1 and account_id = $2`,
      [id, accountId, dto.url ?? null, dto.description !== undefined, dto.description || null, dto.events ?? null, dto.active ?? null],
    );
    if (!rowCount) throw new NotFoundException(`Webhook ${id} not found`);
    return this.webhook(accountId, id);
  }

  async secret(accountId: string, id: string) {
    const { rows } = await this.pool.query('select secret from webhook_subscriptions where id = $1 and account_id = $2', [id, accountId]);
    if (!rows[0]) throw new NotFoundException(`Webhook ${id} not found`);
    return { secret: open(rows[0].secret as Sealed) ?? null };
  }

  /** A new secret; the old one stops signing at once. */
  async rotateSecret(accountId: string, id: string) {
    const secret = newSecret();
    const { rowCount } = await this.pool.query('update webhook_subscriptions set secret = $3 where id = $1 and account_id = $2', [id, accountId, JSON.stringify(seal(secret))]);
    if (!rowCount) throw new NotFoundException(`Webhook ${id} not found`);
    return { secret };
  }

  // Chat alerts

  async listChatAlerts(accountId: string): Promise<ChatAlertView[]> {
    const { rows } = await this.pool.query(`select t.*, ld.* from chat_alerts t ${LAST_DELIVERY} where t.account_id = $1 order by t.created_at`, [accountId]);
    return rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, urlHost: r.url_host, events: r.events, includeDetails: r.include_details, active: r.active, createdAt: new Date(r.created_at).toISOString(), lastDelivery: last(r) }));
  }

  async chatAlert(accountId: string, id: string): Promise<ChatAlertView> {
    const found = (await this.listChatAlerts(accountId)).find((w) => w.id === id);
    if (!found) throw new NotFoundException(`Chat alert ${id} not found`);
    return found;
  }

  async createChatAlert(accountId: string, dto: CreateChatAlertDto) {
    this.checkChatUrl(dto.kind, dto.url);
    const id = randomUUID();
    await this.pool.query('insert into chat_alerts (id, account_id, kind, name, url, url_host, events, include_details) values ($1, $2, $3, $4, $5, $6, $7, $8)', [
      id, accountId, dto.kind, dto.name, JSON.stringify(seal(dto.url)), new URL(dto.url).host, dto.events, dto.includeDetails,
    ]);
    return this.chatAlert(accountId, id);
  }

  async updateChatAlert(accountId: string, id: string, dto: UpdateChatAlertDto) {
    const current = await this.chatAlert(accountId, id);
    if (dto.url !== undefined) this.checkChatUrl(current.kind, dto.url);
    await this.pool.query(
      `update chat_alerts set name = coalesce($3, name), url = coalesce($4, url), url_host = coalesce($5, url_host), events = coalesce($6, events), include_details = coalesce($7, include_details), active = coalesce($8, active) where id = $1 and account_id = $2`,
      [id, accountId, dto.name ?? null, dto.url ? JSON.stringify(seal(dto.url)) : null, dto.url ? new URL(dto.url).host : null, dto.events ?? null, dto.includeDetails ?? null, dto.active ?? null],
    );
    return this.chatAlert(accountId, id);
  }

  // Both

  async remove(accountId: string, type: TargetType, id: string) {
    const { rowCount } = await this.pool.query(`delete from ${type === 'webhook' ? 'webhook_subscriptions' : 'chat_alerts'} where id = $1 and account_id = $2`, [id, accountId]);
    if (!rowCount) throw new NotFoundException(`${type === 'webhook' ? 'Webhook' : 'Chat alert'} ${id} not found`);
    await this.pool.query('delete from integration_deliveries where target_id = $1', [id]);
  }

  /** Sends a `ping` event now, whatever the target is subscribed to. */
  async test(accountId: string, type: TargetType, id: string) {
    if (type === 'webhook') await this.webhook(accountId, id);
    else await this.chatAlert(accountId, id);
    const event: WebhookEvent<'ping'> = { id: randomUUID(), type: 'ping', createdAt: new Date().toISOString(), data: { message: 'Test delivery from DocCheck' } };
    const deliveryId = await this.deliveries.create(accountId, type, id, event);
    return this.delivery(accountId, deliveryId!);
  }

  async deliveriesOf(accountId: string, targetId: string, limit = 50) {
    const { rows } = await this.pool.query('select * from integration_deliveries where account_id = $1 and target_id = $2 order by created_at desc limit $3', [accountId, targetId, limit]);
    return rows.map((r) => toDeliveryView(r));
  }

  async delivery(accountId: string, id: string) {
    const { rows } = await this.pool.query('select * from integration_deliveries where id = $1 and account_id = $2', [id, accountId]);
    if (!rows[0]) throw new NotFoundException(`Delivery ${id} not found`);
    return toDeliveryView(rows[0], true);
  }

  /** Sends the same event again, as a new delivery (the event id stays, so receivers can tell it is a repeat). */
  async redeliver(accountId: string, id: string) {
    const { rows } = await this.pool.query('select * from integration_deliveries where id = $1 and account_id = $2', [id, accountId]);
    const d = rows[0];
    if (!d) throw new NotFoundException(`Delivery ${id} not found`);
    const newId = await this.deliveries.create(accountId, d.target_type, d.target_id, d.payload, { eventId: d.event_id, redeliveryOf: d.id });
    return this.delivery(accountId, newId!);
  }
}
