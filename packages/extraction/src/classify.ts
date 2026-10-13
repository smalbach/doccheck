import type { DocumentType } from '@doccheck/schemas';

/**
 * Document type from its title and vocabulary. Freight documents announce themselves in the
 * header, so keywords cover the synthetic set. Titles are matched loosely because OCR mangles
 * large or underlined headings ("MMERCIAL I ICE"), and words that appear on more than one type
 * (net and gross weight, packages) are not counted.
 */
const SIGNALS: { type: DocumentType; title: RegExp; words: RegExp[] }[] = [
  {
    type: 'BILL_OF_LADING',
    title: /\b(BILL OF LADING|SEA ?WAYBILL|OCEAN BILL|CONNAISSEMENT|LADING|WAYBILL)\b/i,
    words: [/\bB\/L\b/i, /\bPORT OF LOADING\b/i, /\bVESSEL\b/i, /\bCONTAINER NO\b/i, /\bSHIPPED ON BOARD\b/i, /\bNOTIFY PARTY\b/i, /\bSEAL NO\b/i],
  },
  {
    type: 'PACKING_LIST',
    title: /\b(PACKING LIST|LISTE DE COLISAGE|PACKING)\b/i,
    words: [/\bC\/NO\b/i, /\bCARTON NO\b/i, /\bDIMENSIONS\b/i, /\bPACKING LIST NO\b/i, /\bMEAS\b/i, /\bCBM\b/i],
  },
  {
    type: 'COMMERCIAL_INVOICE',
    // "Invoice No." on a packing list or BL is a reference to the invoice, not a title.
    title: /\b(COMMERCIAL INVOICE|FACTURE COMMERCIALE|PROFORMA INVOICE|M+ERCIAL)\b|\bINVOICE\b(?!\.?\s*(NO|N°|#|REF|NUMBER)\b)/i,
    words: [
      /\bUNIT PRICE\b|\bU\/P\b|\bPRIX UNITAIRE\b/i,
      /\bAMOUNT\b|\bAMT\b|\bMONTANT\b/i,
      /\bTERMS OF SALE\b|\bTERMS:/i,
      /\bSOLD TO\b|\bBUYER\b|\bACHETEUR\b/i,
      /\bCURRENCY\b|\bDEVISE\b/i,
      /\bPAYMENT\b/i,
    ],
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
