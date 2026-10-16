import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { appUrl } from '../auth/app-url';
import { PG_POOL } from '../db/db.module';
import { Mailer } from '../mail/mailer';

export const NOTIFICATION_KINDS = ['mention', 'assignment', 'approval_requested', 'approval_decided'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Per kind, whether it shows in the app and whether it is emailed. Missing kinds take these. */
export type NotificationPrefs = Record<NotificationKind, { inApp: boolean; email: boolean }>;
export const DEFAULT_PREFS: NotificationPrefs = {
  mention: { inApp: true, email: true },
  assignment: { inApp: true, email: true },
  approval_requested: { inApp: true, email: true },
  approval_decided: { inApp: true, email: false },
};

export const withDefaults = (stored: unknown): NotificationPrefs => {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<NotificationKind, Partial<{ inApp: boolean; email: boolean }>>>;
  return Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, { ...DEFAULT_PREFS[k], ...s[k] }])) as NotificationPrefs;
};

export interface Notification {
  id: string;
  kind: NotificationKind;
  orgId?: string;
  orgName?: string;
  shipmentId?: string;
  reference?: string;
  actorName?: string;
  detail: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

type Lang = 'en' | 'es' | 'fr';

const SUBJECTS: Record<NotificationKind, Record<Lang, (actor: string, ref: string) => string>> = {
  mention: {
    en: (a, r) => `${a} mentioned you on ${r}`,
    es: (a, r) => `${a} te mencionó en ${r}`,
    fr: (a, r) => `${a} vous a mentionné sur ${r}`,
  },
  assignment: {
    en: (a, r) => `${a} assigned you ${r}`,
    es: (a, r) => `${a} te asignó ${r}`,
    fr: (a, r) => `${a} vous a assigné ${r}`,
  },
  approval_requested: {
    en: (a, r) => `${a} asks for your approval on ${r}`,
    es: (a, r) => `${a} pide tu aprobación en ${r}`,
    fr: (a, r) => `${a} demande votre approbation sur ${r}`,
  },
  approval_decided: {
    en: (a, r) => `${a} answered your request on ${r}`,
    es: (a, r) => `${a} respondió tu solicitud en ${r}`,
    fr: (a, r) => `${a} a répondu à votre demande sur ${r}`,
  },
};
const OPEN: Record<Lang, string> = { en: 'Open in DocCheck', es: 'Abrir en DocCheck', fr: 'Ouvrir dans DocCheck' };
const SETTINGS: Record<Lang, string> = {
  en: 'You can choose which notifications are emailed in Account, Notifications.',
  es: 'Puedes elegir qué avisos llegan por correo en Cuenta, Notificaciones.',
  fr: 'Vous pouvez choisir les notifications envoyées par e-mail dans Compte, Notifications.',
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Tells members about mentions, assignments and approvals: in the app (GET /notifications) and by email
 * through the server's SMTP, each as the member chose (Account, Notifications). Nobody is notified of
 * their own action.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly mailer: Mailer,
  ) {}

  async notify(input: { userIds: string[]; kind: NotificationKind; orgId: string; shipmentId?: string; actorId: string; detail?: Record<string, unknown> }): Promise<void> {
    const ids = [...new Set(input.userIds)].filter((id) => id !== input.actorId);
    if (!ids.length) return;
    const { rows } = await this.pool.query(
      `select u.id, u.email, u.language, u.notification_prefs, a.name as actor_name, s.reference
       from users u left join users a on a.id = $2 left join shipments s on s.id = $3
       where u.id = any($1::uuid[]) and exists (select 1 from org_members m where m.org_id = $4 and m.user_id = u.id)`,
      [ids, input.actorId, input.shipmentId ?? null, input.orgId],
    );
    for (const r of rows) {
      const prefs = withDefaults(r.notification_prefs)[input.kind];
      const id = randomUUID();
      if (prefs.inApp) {
        await this.pool.query(
          'insert into notifications (id, user_id, org_id, kind, shipment_id, actor_id, detail) values ($1, $2, $3, $4, $5, $6, $7)',
          [id, r.id, input.orgId, input.kind, input.shipmentId ?? null, input.actorId, JSON.stringify(input.detail ?? {})],
        );
      }
      if (prefs.email) {
        const lang: Lang = r.language === 'es' || r.language === 'fr' ? r.language : 'en';
        void this.email(id, r.email, lang, input.kind, r.actor_name ?? 'DocCheck', r.reference ?? input.shipmentId?.slice(0, 8) ?? '', input.shipmentId, input.detail).catch((err: Error) =>
          this.logger.error(`Notification email to ${r.email} failed: ${err.message}`),
        );
      }
    }
  }

  private async email(id: string, to: string, lang: Lang, kind: NotificationKind, actor: string, ref: string, shipmentId: string | undefined, detail?: Record<string, unknown>) {
    const subject = SUBJECTS[kind][lang](actor, ref);
    const base = appUrl();
    const link = base && shipmentId ? `${base}/#/app/s/${shipmentId}` : base;
    const quote = typeof detail?.excerpt === 'string' ? detail.excerpt : undefined;
    const text = [subject, ...(quote ? ['', `"${quote}"`] : []), ...(link ? ['', `${OPEN[lang]}: ${link}`] : []), '', SETTINGS[lang]].join('\n');
    const html = `<!doctype html>
<html lang="${lang}"><body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1f2933">
<p>${escapeHtml(subject)}</p>
${quote ? `<blockquote style="margin: 0 0 1em; padding-left: 12px; border-left: 3px solid #cbd2d9; color: #3e4c59">${escapeHtml(quote)}</blockquote>` : ''}
${link ? `<p><a href="${escapeHtml(link)}" style="display: inline-block; padding: 10px 16px; background: #1d4ed8; color: #fff; border-radius: 6px; text-decoration: none">${OPEN[lang]}</a></p>` : ''}
<p style="color: #52606d">${SETTINGS[lang]}</p>
</body></html>`;
    await this.mailer.send({ to, subject, text, html });
    await this.pool.query('update notifications set emailed_at = now() where id = $1', [id]);
  }

  async list(userId: string, unreadOnly: boolean, limit: number): Promise<{ items: Notification[]; unread: number }> {
    const [{ rows }, { rows: count }] = await Promise.all([
      this.pool.query(
        `select n.*, o.name as org_name, s.reference, a.name as actor_name from notifications n
         left join organizations o on o.id = n.org_id left join shipments s on s.id = n.shipment_id left join users a on a.id = n.actor_id
         where n.user_id = $1 and ($2::boolean is false or n.read_at is null)
         order by n.created_at desc limit $3`,
        [userId, unreadOnly, limit],
      ),
      this.pool.query('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [userId]),
    ]);
    return {
      unread: count[0].n,
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        ...(r.org_id ? { orgId: r.org_id, orgName: r.org_name } : {}),
        ...(r.shipment_id ? { shipmentId: r.shipment_id } : {}),
        ...(r.reference ? { reference: r.reference } : {}),
        ...(r.actor_name ? { actorName: r.actor_name } : {}),
        detail: r.detail,
        read: r.read_at !== null,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    };
  }

  async markRead(userId: string, ids: string[] | 'all'): Promise<void> {
    if (ids === 'all') await this.pool.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [userId]);
    else await this.pool.query('update notifications set read_at = now() where user_id = $1 and id = any($2::uuid[]) and read_at is null', [userId, ids]);
  }

  async prefs(userId: string): Promise<NotificationPrefs> {
    const { rows } = await this.pool.query('select notification_prefs from users where id = $1', [userId]);
    return withDefaults(rows[0]?.notification_prefs);
  }

  async setPrefs(userId: string, prefs: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
    const merged = { ...(await this.prefs(userId)), ...prefs };
    await this.pool.query('update users set notification_prefs = $2 where id = $1', [userId, JSON.stringify(merged)]);
    return merged;
  }
}
