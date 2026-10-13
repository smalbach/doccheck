import type { DocumentType } from '@doccheck/schemas';

/**
 * Document type from its title and vocabulary. Freight documents announce themselves in the
 * header, so keywords cover the synthetic set; an LLM fallback can be added for unlabeled scans.
 */
const SIGNALS: { type: DocumentType; title: RegExp; words: RegExp[] }[] = [
  {
    type: 'BILL_OF_LADING',
    title: /\b(BILL OF LADING|SEA ?WAYBILL|OCEAN BILL|CONNAISSEMENT)\b/i,
    words: [/\bB\/L\b/i, /\bPORT OF LOADING\b/i, /\bVESSEL\b/i, /\bCONTAINER NO\b/i, /\bSHIPPED ON BOARD\b/i],
  },
  {
    type: 'PACKING_LIST',
    title: /\b(PACKING LIST|LISTE DE COLISAGE)\b/i,
    words: [/\bC\/NO\b/i, /\bCARTON NO\b/i, /\bDIMENSIONS\b/i, /\bN\.?W\.?\b/i, /\bG\.?W\.?\b/i],
  },
  {
    type: 'COMMERCIAL_INVOICE',
    title: /\b(COMMERCIAL INVOICE|FACTURE COMMERCIALE|PROFORMA INVOICE|INVOICE)\b/i,
    words: [/\bUNIT PRICE\b|\bU\/P\b/i, /\bAMOUNT\b|\bAMT\b/i, /\bTERMS OF SALE\b|\bTERMS:/i, /\bSOLD TO\b|\bBUYER\b/i],
  },
];

export function classifyDocument(text: string): { type: DocumentType; confidence: number } {
  const head = text.split('\n').slice(0, 8).join('\n');
  const scores = SIGNALS.map((s) => ({
    type: s.type,
    score: (s.title.test(head) ? 3 : s.title.test(text) ? 1 : 0) + s.words.filter((w) => w.test(text)).length * 0.5,
  })).sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (best.score === 0) return { type: 'UNKNOWN', confidence: 0 };
  const confidence = Math.min(0.99, best.score / (best.score + (second?.score ?? 0) + 0.5));
  return { type: best.type, confidence: Math.round(confidence * 100) / 100 };
}
