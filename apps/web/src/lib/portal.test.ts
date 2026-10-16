import { describe, expect, it } from 'vitest';
import { LINK_PLACEHOLDER } from '../api/portal';
import { es } from '../i18n/messages/es';
import type { MessageKey, MessageVars } from '../i18n/keys';
import { translate } from '../i18n/translate';
import { isAppRoute } from './isAppRoute';
import { parseRoute } from './parseRoute';
import { routeKey } from './routeKey';
import { supplierLetter } from './supplierLetter';

describe('supplier portal route', () => {
  it('opens a portal link outside the signed-in app, with its token', () => {
    const route = parseRoute('#/portal?t=abc.def');
    expect(route).toEqual({ name: 'portal', token: 'abc.def' });
    expect(isAppRoute(route)).toBe(false);
    expect(parseRoute('#/portal')).toEqual({ name: 'portal', token: undefined });
  });

  it('starts over when another link opens in the same tab', () => {
    expect(routeKey(parseRoute('#/portal?t=a'))).not.toBe(routeKey(parseRoute('#/portal?t=b')));
  });
});

describe('correction letter with a portal link', () => {
  const t = (key: MessageKey, vars?: MessageVars) => translate(es, 'es', key, vars);
  const finding = { id: 'f', shipmentId: 's', ruleId: 'X2', severity: 'HIGH' as const, decidedBy: 'RULE' as const, message: 'm', evidence: [{ documentId: 'd', field: 'packageCount', value: '120' }], fingerprint: 'a'.repeat(32) };

  it('puts the placeholder on its own line before the closing, in the letter language', () => {
    const { body } = supplierLetter(t, { reference: 'R-1', findings: [finding], documents: new Map(), portalLink: true });
    const lines = body.split('\n');
    const at = lines.indexOf(LINK_PLACEHOLDER);
    expect(at).toBeGreaterThan(0);
    expect(lines[at - 1]).toBe(es.portal.letterLine);
    expect(lines.slice(at + 1)).toContain(es.letter.closing);
  });

  it('leaves it out when the link is unticked', () => {
    expect(supplierLetter(t, { reference: 'R-1', findings: [finding], documents: new Map() }).body).not.toContain(LINK_PLACEHOLDER);
  });
});
