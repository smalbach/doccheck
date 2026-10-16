import { LINK_PLACEHOLDER } from './portal-token';
import type { PortalKind } from './portal.types';

/** The line with the portal link, added to an email whose text does not have the placeholder. */
const LINK_LINE: Record<string, Record<PortalKind, string>> = {
  en: {
    correction: 'Upload the corrected documents, and see what is left to fix:',
    pre_shipment: 'Upload the draft invoice and packing list here to check them before shipping:',
  },
  es: {
    correction: 'Sube los documentos corregidos y mira qué falta corregir:',
    pre_shipment: 'Sube aquí el borrador de la factura y de la lista de empaque para revisarlos antes del embarque:',
  },
  fr: {
    correction: 'Téléversez les documents corrigés et voyez ce qu’il reste à corriger :',
    pre_shipment: 'Téléversez ici la facture et la liste de colisage provisoires pour les vérifier avant l’expédition :',
  },
};

/** The email text with the portal link in it: as written when it has the placeholder, else with the line added. */
export function withLinkLine(body: string, kind: PortalKind, language?: string | null): string {
  if (body.includes(LINK_PLACEHOLDER)) return body;
  const line = (LINK_LINE[language ?? 'en'] ?? LINK_LINE.en!)[kind];
  return `${body.trimEnd()}\n\n${line}\n${LINK_PLACEHOLDER}`;
}
