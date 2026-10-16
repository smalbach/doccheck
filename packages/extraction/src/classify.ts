import type { DocumentType } from '@doccheck/schemas';

/**
 * Document type from its title and vocabulary (invoice, packing list, bill of lading, ISF, and the other
 * documents: air waybill, certificates of origin, arrival notice, wood packaging, dangerous goods). Freight documents announce themselves in the
 * header, so keywords cover the synthetic set. Titles are matched loosely because OCR mangles
 * large or underlined headings ("MMERCIAL I ICE"), and words that appear on more than one type
 * (net and gross weight, packages) are not counted.
 */
const SIGNALS: { type: DocumentType; title: RegExp; words: RegExp[]; titleWeight?: number }[] = [
  {
    type: 'BILL_OF_LADING',
    // "B/L No." or "Bill of Lading No." on an arrival notice is a reference, and an air waybill is not a sea waybill.
    title: /\b(BILL OF LADING(?!\s*(NO|N°|#|NUMBER)\b)|SEA ?WAYBILL|OCEAN BILL|CONNAISSEMENT|LADING(?!\s*(NO|N°|#|NUMBER)\b)|(?<!AIR ?)WAYBILL)\b/i,
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
  {
    // ISF 10+2 filing confirmation printed by the broker. Its element names are specific to the
    // filing; "buyer" and "seller" are not counted because invoices use them too.
    type: 'ISF',
    title: /\b(IMPORTER SECURITY FILING|ISF FILING|ISF CONFIRMATION|ISF)\b|\b10\s?\+\s?2\b/i,
    words: [
      /\bIMPORTER OF RECORD\b/i,
      /\bCONSIGNEE (NO|NUMBER)\b/i,
      /\bCONTAINER STUFFING\b/i,
      /\bCONSOLIDATOR\b/i,
      /\bSHIP[- ]TO PARTY\b/i,
      /\bHTSUS?\b/i,
      /\bMANUFACTURER\b/i,
    ],
  },
  // The other documents have titles nothing else prints, so a title counts more (titleWeight), which
  // keeps the BL words an arrival notice or a dangerous goods form also prints from winning.
  {
    type: 'AIR_WAYBILL',
    title: /\b(AIR ?WAYBILL|AIRWAY ?BILL|MAWB|HAWB|LETTRE DE TRANSPORT A[EÉ]RIEN)\b(?!\s*(NO|N°|#|NUMBER)\b)/i,
    words: [/\bAIRPORT OF DEPARTURE\b/i, /\bAIRPORT OF DESTINATION\b/i, /\bCHARGEABLE WEIGHT\b/i, /\bNATURE AND QUANTITY OF GOODS\b/i, /\bRATE CLASS\b/i, /\bNO\.? OF PIECES\b/i, /\bISSUING CARRIER\b/i],
    titleWeight: 4,
  },
  {
    type: 'CUSMA_CERTIFICATION',
    title: /\b(CUSMA|USMCA|T-MEC|CERTIFICATION OF ORIGIN)\b/i,
    words: [/\bCERTIFIER\b/i, /\bBLANKET PERIOD\b/i, /\bORIGIN CRITERION\b/i, /\bPRODUCER\b/i, /\bIMPORTER\b/i, /\bAUTHORIZED SIGNATURE\b/i],
    titleWeight: 5,
  },
  {
    type: 'CERTIFICATE_OF_ORIGIN',
    title: /\b(CERTIFICATE OF ORIGIN|CERTIFICAT D'ORIGINE|CERTIFICADO DE ORIGEN)\b/i,
    words: [/\bCHAMBER OF COMMERCE\b/i, /\bHEREBY CERTIF/i, /\bISSUING (BODY|AUTHORITY)\b/i, /\bCOUNTRY OF ORIGIN\b/i, /\bORIGINATE\b/i],
    titleWeight: 5,
  },
  {
    type: 'ARRIVAL_NOTICE',
    title: /\b(ARRIVAL NOTICE|NOTICE OF ARRIVAL|AVIS D'ARRIV[EÉ]E|CARGO ARRIVAL)\b/i,
    words: [/\bETA\b/i, /\bLAST FREE DAY\b|\bFREE TIME\b/i, /\bDEMURRAGE\b/i, /\bAMOUNT DUE\b|\bCHARGES DUE\b/i, /\bAVAILABLE FOR (PICK ?UP|RELEASE)\b/i],
    titleWeight: 5,
  },
  {
    type: 'WOOD_PACKAGING_CERTIFICATE',
    title: /\b(FUMIGATION CERTIFICATE|HEAT TREATMENT CERTIFICATE|CERTIFICATE OF (FUMIGATION|HEAT TREATMENT)|ISPM ?15|PACKING DECLARATION|PACKAGING DECLARATION|WOOD PACKAGING (MATERIAL )?(DECLARATION|CERTIFICATE)|NON[- ]WOOD(EN)? (PACKING|PACKAGING) DECLARATION)\b/i,
    words: [/\bFUMIGANT\b/i, /\bDOSAGE\b/i, /\bIPPC\b/i, /\bHEAT[- ]TREAT/i, /\bMETHYL BROMIDE\b/i, /\bCORE TEMPERATURE\b/i, /\bWOOD(EN)? PACKAGING\b/i],
    titleWeight: 5,
  },
  {
    type: 'DANGEROUS_GOODS_DECLARATION',
    title: /\b(DANGEROUS GOODS (DECLARATION|NOTE|FORM)|SHIPPER'?S DECLARATION FOR DANGEROUS GOODS|MULTIMODAL DANGEROUS GOODS|HAZARDOUS MATERIALS? (DECLARATION|SHIPPING PAPER))\b/i,
    words: [/\bUN ?\d{4}\b/i, /\bPROPER SHIPPING NAME\b/i, /\bPACKING GROUP\b/i, /\bCLASS OR DIVISION\b|\bHAZARD CLASS\b/i, /\bEMERGENCY (CONTACT|RESPONSE)\b/i, /\bFLASH ?POINT\b/i, /\bIMDG\b/i],
    titleWeight: 5,
  },
];

export function classifyDocument(text: string): { type: DocumentType; confidence: number } {
  const head = text.split('\n').slice(0, 8).join('\n');
  const scores = SIGNALS.map((s) => ({
    type: s.type,
    score: (s.title.test(head) ? (s.titleWeight ?? 3) : s.title.test(text) ? 1 : 0) + s.words.filter((w) => w.test(text)).length * 0.5,
  })).sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (best.score === 0) return { type: 'UNKNOWN', confidence: 0 };
  const confidence = Math.min(0.99, best.score / (best.score + (second?.score ?? 0) + 0.5));
  return { type: best.type, confidence: Math.round(confidence * 100) / 100 };
}
