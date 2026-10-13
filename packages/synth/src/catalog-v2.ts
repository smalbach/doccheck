import type { Location } from '@doccheck/schemas';
import { PRODUCTS as P, type Buyer, type Seller } from './catalog';

/**
 * Extra parties for set v2: names and addresses with accents and non-English words, so extraction
 * and the party-matching rules meet text the v1 prompt was never tuned on. Still fictional.
 */

const loc = (name: string, unLocode: string): Location => ({ name, unLocode, country: unLocode.slice(0, 2) });

export const SELLERS_V2: Seller[] = [
  {
    party: { name: 'Société Lyonnaise de Jouets S.A.R.L.', address: { lines: ["14 rue de l'Industrie"], city: 'Lyon', postalCode: '69007', country: 'FR' }, taxId: 'FR40123456789' },
    ports: [loc('Le Havre', 'FRLEH'), loc('Fos-sur-Mer', 'FRFOS')],
    currencies: ['EUR'],
    products: [P.teddy, P.puzzle],
  },
  {
    party: { name: 'Küchentechnik Müller & Söhne GmbH', address: { lines: ['Königstraße 48'], city: 'Stuttgart', postalCode: '70173', country: 'DE' }, taxId: 'DE298765432' },
    ports: [loc('Hamburg', 'DEHAM'), loc('Bremerhaven', 'DEBRV')],
    currencies: ['EUR'],
    manufacturer: { name: 'Elektrowerk Göppingen GmbH', address: { lines: ['Jahnstraße 12'], city: 'Göppingen', postalCode: '73037', country: 'DE' } },
    products: [P.kettle, P.blender],
  },
  {
    party: { name: 'Industrias Cerámicas del Levante, S.L.', address: { lines: ['Camí de la Mar, 23'], city: 'Vila-real', region: 'Castellón', postalCode: '12540', country: 'ES' }, taxId: 'ESB12345678' },
    ports: [loc('Valencia', 'ESVLC')],
    currencies: ['EUR', 'USD'],
    products: [P.tiles],
  },
  {
    party: { name: 'Công ty Cổ phần May Đông Á', address: { lines: ['Lô C2, KCN Đồng Văn II'], city: 'Duy Tiên', region: 'Hà Nam', country: 'VN' }, taxId: '0700123456' },
    ports: [loc('Hai Phong', 'VNHPH')],
    currencies: ['USD'],
    products: [P.tshirt, P.jacket, P.socks],
  },
  {
    party: { name: 'Azeites do Alentejo, Lda.', address: { lines: ['Rua da Fábrica, 7'], city: 'Beja', postalCode: '7800-309', country: 'PT' }, taxId: 'PT509876543' },
    ports: [loc('Lisboa', 'PTLIS'), loc('Sines', 'PTSIE')],
    currencies: ['EUR'],
    products: [P.oliveOil],
  },
  {
    party: { name: 'Cooperativa Agraria Cafetalera Pangoa Ltda.', address: { lines: ['Av. Túpac Amaru 315'], city: 'San Martín de Pangoa', region: 'Junín', country: 'PE' }, taxId: '20123456789' },
    ports: [loc('Callao', 'PECLL')],
    currencies: ['USD'],
    products: [P.coffee],
  },
  {
    party: { name: 'Özdemir Vana Sanayi ve Ticaret A.Ş.', address: { lines: ['İkitelli OSB, Demirciler Sitesi C Blok No: 9'], city: 'Başakşehir', region: 'İstanbul', postalCode: '34490', country: 'TR' }, taxId: '6810123456' },
    ports: [loc('Ambarlı', 'TRAMR')],
    currencies: ['EUR', 'USD'],
    products: [P.valves, P.pump],
  },
];

export const BUYERS_V2: Buyer[] = [
  {
    destination: 'CA',
    party: { name: 'Les Importations Bélanger & Frères inc.', address: { lines: ['2875 boul. Laurier, bureau 300'], city: 'Québec', region: 'QC', postalCode: 'G1V 2M2', country: 'CA' }, taxId: '881234567RM0001' },
    shipTo: { name: 'Entrepôt Bélanger – Lévis', address: { lines: ["1200 rue de l'Église"], city: 'Lévis', region: 'QC', postalCode: 'G6V 6N1', country: 'CA' } },
    portsOfDischarge: [loc('Montréal', 'CAMTR'), loc('Halifax', 'CAHAL')],
    placeOfDelivery: loc('Québec', 'CAQUE'),
    currencies: ['USD', 'CAD'],
  },
  {
    destination: 'CA',
    party: { name: 'Épicerie Fine Évangéline Coopérative Ltée', address: { lines: ['95 rue Champlain'], city: 'Dieppe', region: 'NB', postalCode: 'E1A 1N5', country: 'CA' }, taxId: '892345678RM0001' },
    portsOfDischarge: [loc('Halifax', 'CAHAL')],
    placeOfDelivery: loc('Moncton', 'CAMNT'),
    currencies: ['USD', 'CAD'],
  },
  {
    destination: 'US',
    party: { name: 'Peña Hermanos Distributors LLC', address: { lines: ['8250 NW 27th St'], city: 'Doral', region: 'FL', postalCode: '33122', country: 'US' }, taxId: '65-1234987' },
    portsOfDischarge: [loc('Miami', 'USMIA'), loc('Port Everglades', 'USPEF')],
    placeOfDelivery: loc('Miami', 'USMIA'),
    currencies: ['USD'],
  },
  {
    destination: 'US',
    party: { name: 'Nguyễn Family Foods Inc.', address: { lines: ['9200 Bolsa Ave'], city: 'Westminster', region: 'CA', postalCode: '92683', country: 'US' }, taxId: '33-7654321' },
    shipTo: { name: 'Nguyễn Family Foods – Cold Storage', address: { lines: ['15500 Gothard St'], city: 'Huntington Beach', region: 'CA', postalCode: '92647', country: 'US' } },
    portsOfDischarge: [loc('Long Beach', 'USLGB'), loc('Los Angeles', 'USLAX')],
    placeOfDelivery: loc('Los Angeles', 'USLAX'),
    currencies: ['USD'],
  },
];

/** Colours and sizes used to split a product into variant lines. */
export const VARIANT_COLOURS = [
  ['NV', 'navy'], ['BK', 'black'], ['GY', 'grey'], ['RD', 'red'], ['WH', 'white'], ['GN', 'green'],
  ['BL', 'blue'], ['BE', 'beige'], ['OR', 'orange'], ['YL', 'yellow'], ['BR', 'brown'], ['PK', 'pink'],
] as const;
export const VARIANT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
