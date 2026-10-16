import type { Location } from '@doccheck/schemas';
import type { Buyer } from './catalog';

/**
 * Importers in Mexico, the EU and the UK, for the destinations set (V3). Fictional like the rest of the
 * catalog; their numbers are well formed: RFCs with a correct SAT check digit, EORIs with the issuing
 * country's prefix. Ports use real UN/LOCODEs.
 */
const loc = (name: string, unLocode: string): Location => ({ name, unLocode, country: unLocode.slice(0, 2) });

export const BUYERS_DESTINATIONS: Buyer[] = [
  {
    destination: 'MX',
    party: { name: 'Distribuidora Pacífico Norte, S.A. de C.V.', address: { lines: ['Av. Vallarta 6503, Local 12'], city: 'Zapopan', region: 'JAL', postalCode: '45010', country: 'MX' }, taxId: 'DPN070315K24' },
    shipTo: { name: 'Distribuidora Pacífico Norte – CEDIS El Salto', address: { lines: ['Carretera El Salto km 4.5'], city: 'El Salto', region: 'JAL', postalCode: '45680', country: 'MX' } },
    portsOfDischarge: [loc('Manzanillo', 'MXZLO'), loc('Lazaro Cardenas', 'MXLZC')],
    placeOfDelivery: loc('Guadalajara', 'MXGDL'),
    currencies: ['USD'],
  },
  {
    destination: 'MX',
    party: { name: 'Comercializadora del Bajío Abarrotes, S.A. de C.V.', address: { lines: ['Blvd. Bernardo Quintana 4100'], city: 'Querétaro', region: 'QRO', postalCode: '76090', country: 'MX' }, taxId: 'CBA990208H57' },
    portsOfDischarge: [loc('Veracruz', 'MXVER'), loc('Manzanillo', 'MXZLO')],
    placeOfDelivery: loc('Queretaro', 'MXQRO'),
    currencies: ['USD', 'MXN'],
  },
  {
    destination: 'EU',
    party: { name: 'Rheinufer Haushaltswaren GmbH', address: { lines: ['Hafenstrasse 112'], city: 'Duisburg', postalCode: '47119', country: 'DE' }, taxId: 'DE482910375516203' },
    shipTo: { name: 'Rheinufer Logistikzentrum', address: { lines: ['Logport-Allee 7'], city: 'Duisburg', postalCode: '47229', country: 'DE' } },
    portsOfDischarge: [loc('Hamburg', 'DEHAM'), loc('Rotterdam', 'NLRTM')],
    placeOfDelivery: loc('Duisburg', 'DEDUI'),
    currencies: ['EUR', 'USD'],
  },
  {
    destination: 'EU',
    party: { name: 'Polderhuis Retail B.V.', address: { lines: ['Waalhaven Zuidzijde 21'], city: 'Rotterdam', postalCode: '3089 JH', country: 'NL' }, taxId: 'NL861234905' },
    portsOfDischarge: [loc('Rotterdam', 'NLRTM'), loc('Antwerp', 'BEANR')],
    placeOfDelivery: loc('Rotterdam', 'NLRTM'),
    currencies: ['EUR', 'USD'],
  },
  {
    destination: 'EU',
    party: { name: 'Maison Rhodanienne Équipement S.A.S.', address: { lines: ['14 quai Rambaud'], city: 'Lyon', postalCode: '69002', country: 'FR' }, taxId: 'FR53829104700028' },
    portsOfDischarge: [loc('Le Havre', 'FRLEH'), loc('Marseille', 'FRMRS')],
    placeOfDelivery: loc('Lyon', 'FRLIO'),
    currencies: ['EUR'],
  },
  {
    destination: 'GB',
    party: { name: 'Thameside Home & Garden Ltd', address: { lines: ['Unit 4, Botany Way'], city: 'Purfleet', postalCode: 'RM19 1SR', country: 'GB' }, taxId: 'GB284019376000' },
    shipTo: { name: 'Thameside Distribution Centre', address: { lines: ['London Gateway Logistics Park, Gateway Rd'], city: 'Stanford-le-Hope', postalCode: 'SS17 9DY', country: 'GB' } },
    portsOfDischarge: [loc('London Gateway', 'GBLGP'), loc('Felixstowe', 'GBFXT')],
    placeOfDelivery: loc('Purfleet', 'GBPFT'),
    currencies: ['GBP', 'USD'],
  },
  {
    destination: 'GB',
    party: { name: 'Pennine Engineering Supplies plc', address: { lines: ['Trafford Wharf Rd'], city: 'Manchester', postalCode: 'M17 1EX', country: 'GB' }, taxId: 'GB731552098000' },
    portsOfDischarge: [loc('Southampton', 'GBSOU'), loc('Felixstowe', 'GBFXT')],
    placeOfDelivery: loc('Manchester', 'GBMNC'),
    currencies: ['GBP', 'EUR', 'USD'],
  },
];
