import type { Attestation, Evidence } from '@doccheck/schemas';
import type { Rule, RuleResult } from '../types';

/**
 * T13 (informational): the original bill of lading and the certificate of origin show a signature or
 * stamp. The check reads the paper, not the text (packages/extraction/src/attestation.ts), so it only
 * runs on documents that were looked at; a photo of a signed copy or an e-signature may still be fine.
 * A sea waybill needs no signed original and is not checked, nor is a page without a place to sign
 * (no signature label): nothing says a signature is missing there.
 */
export const t13SignatureStamp: Rule = {
  definition: {
    id: 'T13',
    title: 'Original BL and certificate of origin are signed or stamped',
    appliesTo: 'ALL',
    requires: [],
    requiresAny: ['BILL_OF_LADING', 'CERTIFICATE_OF_ORIGIN', 'CUSMA_CERTIFICATION'],
    kind: 'DETERMINISTIC',
    severity: 'INFO',
    optional: true,
  },
  applies: (ctx) => [ctx.billOfLading, ctx.certificateOfOrigin, ctx.cusmaCertification].some((d) => d && ctx.attestations?.[d.id] && ctx.attestations[d.id].signatureBlock !== false),
  run(ctx) {
    const seen = Object.fromEntries(Object.entries(ctx.attestations ?? {}).filter(([, a]) => a.signatureBlock !== false));
    const results: RuleResult[] = [];
    const evidence = (documentId: string, a: Attestation, value: string): Evidence => ({
      documentId,
      field: 'attestation',
      value,
      ...(a.page ? { source: { documentId, page: a.page, bbox: a.bbox, rawText: 'Signature block' } } : {}),
    });
    const bl = ctx.billOfLading;
    const blSeen = bl && seen[bl.id];
    if (bl && blSeen && bl.data.blType?.form !== 'SEAWAY' && !blSeen.signature && !blSeen.stamp) {
      results.push({
        message: 'No signature or stamp was found on the bill of lading. An original BL is signed by the carrier or its agent; an unsigned one may not release the goods.',
        evidence: [evidence(bl.id, blSeen, 'no signature, no stamp')],
        suggestedFix: 'Check the paper original; if it is unsigned, ask the carrier or forwarder for a signed one or for a telex release.',
      });
    }
    const coo = ctx.certificateOfOrigin;
    const cooSeen = coo && seen[coo.id];
    if (coo && cooSeen && (!cooSeen.signature || !cooSeen.stamp)) {
      const lacking = [!cooSeen.signature && 'signature', !cooSeen.stamp && 'stamp'].filter(Boolean).join(' or ');
      results.push({
        message: `No ${lacking} was found on the certificate of origin. Chamber certificates are signed and stamped by the issuing body.`,
        evidence: [evidence(coo.id, cooSeen, `no ${lacking}`)],
        suggestedFix: 'Check the original; customs may not accept an unsigned or unstamped certificate.',
      });
    }
    const cusma = ctx.cusmaCertification;
    const cusmaSeen = cusma && seen[cusma.id];
    if (cusma && cusmaSeen && !cusmaSeen.signature) {
      results.push({
        message: 'No signature was found on the CUSMA certification (element 9 asks for an authorized signature; an electronic one also counts).',
        evidence: [evidence(cusma.id, cusmaSeen, 'no signature')],
        suggestedFix: 'Confirm the certification was signed, by hand or electronically, by the certifier.',
      });
    }
    return results;
  },
};
