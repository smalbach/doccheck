import type { WebhookEvent } from './events';

export type ChatKind = 'slack' | 'teams';

export interface ChatOptions {
  /**
   * Off by default: the message says what happened (counts, rule ids, severities) and links back to
   * the shipment, but quotes nothing from the documents. On: finding messages, file names, the subject
   * and sender of a supplier's reply, which may contain values from the documents.
   */
  includeDetails: boolean;
}

interface ChatMessage {
  title: string;
  lines: string[];
  link?: { label: string; url: string };
}

/** What an event says in a chat channel, before it is shaped for Slack or Teams. */
export function chatMessage(event: WebhookEvent, opts: ChatOptions): ChatMessage {
  const ref = (s: { reference: string | null; id: string } | null) => (s ? s.reference || `shipment ${s.id.slice(0, 8)}` : 'a shipment');
  switch (event.type) {
    case 'document.extracted': {
      const d = event.data as WebhookEvent<'document.extracted'>['data'];
      return {
        title: `Document read: ${ref(d.shipment)}`,
        lines: [`${typeLabel(d.document.type)}${d.document.normalized ? '' : ' (not complete enough for the rules)'}`, ...(opts.includeDetails ? [`File: ${d.document.fileName}`] : [])],
        link: { label: 'Open the shipment', url: d.shipment.url },
      };
    }
    case 'validation.completed': {
      const d = event.data as WebhookEvent<'validation.completed'>['data'];
      const sev = Object.entries(d.validation.bySeverity).filter(([, n]) => n).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(', ');
      return {
        title: `Validated: ${ref(d.shipment)}`,
        lines: [d.validation.findings === 0 ? 'No findings.' : `${d.validation.findings} finding(s)${sev ? `: ${sev}` : ''}.`, ...(d.validation.skipped ? [`${d.validation.skipped} rule(s) could not run: a document is missing.`] : [])],
        link: { label: 'Open the shipment', url: d.shipment.url },
      };
    }
    case 'finding.created':
    case 'finding.resolved': {
      const d = event.data as WebhookEvent<'finding.created'>['data'];
      const verb = event.type === 'finding.created' ? 'New finding' : 'Finding resolved';
      return {
        title: `${verb}: ${ref(d.shipment)}`,
        lines: [`${d.finding.ruleId} · ${d.finding.severity.toLowerCase()}`, ...(opts.includeDetails ? [d.finding.message] : [])],
        link: { label: 'Open the shipment', url: d.shipment.url },
      };
    }
    case 'supplier.replied': {
      const d = event.data as WebhookEvent<'supplier.replied'>['data'];
      return {
        title: `Supplier replied${d.shipment ? `: ${ref(d.shipment)}` : ''}`,
        lines: [
          ...(opts.includeDetails ? [`From ${d.message.from}`, `Subject: ${d.thread.subject}`] : []),
          ...(d.message.attachments ? [`${d.message.attachments} attachment(s)`] : []),
        ],
        link: { label: 'Open the conversation', url: d.thread.url },
      };
    }
    default:
      return { title: 'DocCheck test message', lines: ['Alerts from DocCheck will appear in this channel.'] };
  }
}

const TYPE_LABELS: Record<string, string> = {
  COMMERCIAL_INVOICE: 'Commercial invoice',
  PACKING_LIST: 'Packing list',
  BILL_OF_LADING: 'Bill of lading',
  ISF: 'ISF filing',
  UNKNOWN: 'Unrecognized document',
};
const typeLabel = (t: string) => TYPE_LABELS[t] ?? t;

/** Slack mrkdwn: &, < and > are control characters. */
const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Body for a Slack incoming webhook (Block Kit, with a plain-text fallback). */
export function slackBody(event: WebhookEvent, opts: ChatOptions): Record<string, unknown> {
  const m = chatMessage(event, opts);
  const text = [`*${slackEscape(m.title)}*`, ...m.lines.map(slackEscape)].join('\n');
  return {
    text: m.title,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
      ...(m.link ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: m.link.label }, url: m.link.url }] }] : []),
    ],
  };
}

/**
 * Body for a Microsoft Teams incoming webhook: an Adaptive Card, which both the Workflows
 * ("Post to a channel when a webhook request is received") and the older connector webhooks accept.
 */
export function teamsBody(event: WebhookEvent, opts: ChatOptions): Record<string, unknown> {
  const m = chatMessage(event, opts);
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: m.title, weight: 'Bolder', size: 'Medium', wrap: true },
            ...m.lines.map((l) => ({ type: 'TextBlock', text: l, wrap: true })),
          ],
          ...(m.link ? { actions: [{ type: 'Action.OpenUrl', title: m.link.label, url: m.link.url }] } : {}),
        },
      },
    ],
  };
}

export const chatBody = (kind: ChatKind, event: WebhookEvent, opts: ChatOptions) => (kind === 'slack' ? slackBody(event, opts) : teamsBody(event, opts));

/** Hosts incoming-webhook URLs live on, per kind. Anything else is refused, so the URL cannot point at an internal service. */
export const CHAT_HOSTS: Record<ChatKind, RegExp> = {
  slack: /^hooks\.slack(-gov)?\.com$/i,
  teams: /(^|\.)(webhook\.office\.com|logic\.azure\.com|powerplatform\.com)$/i,
};

/** The URL is https and on the kind's host. */
export function isChatWebhookUrl(kind: ChatKind, url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && CHAT_HOSTS[kind].test(u.hostname);
  } catch {
    return false;
  }
}
