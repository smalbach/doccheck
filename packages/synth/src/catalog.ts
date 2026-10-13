import type { Destination, Location, Party } from '@doccheck/schemas';

/**
 * Fictional parties, products and carriers. Names are invented on purpose: the evaluation set
 * must never look like a real company's paperwork. Ports use real UN/LOCODEs.
 */

export interface Product {
  sku: string;
  description: string;
  /** Short form used on the packing list and by some invoice templates. */
  shortDescription: string;
  hsCode: string;
  unit: 'PCS' | 'SETS' | 'PRS' | 'KG' | 'M2';
  /** Unit price range in minor units (cents). */
  priceCents: [number, number];
  netKgPerUnit: string;
  unitsPerPackage: number;
  packageType: 'CTN' | 'PLT' | 'BAG' | 'CRT' | 'DRM';
  tareKg: string;
  dimensionsCm: [number, number, number];
}

export interface Seller {
  party: Party;
  /** Ports the seller ships from. */
  ports: Location[];
  currencies: string[];
  /** Factory, when different from the seller (used for the ISF manufacturer element). */
  manufacturer?: Party;
  products: Product[];
}

export interface Buyer {
  destination: Destination;
  party: Party;
  /** Warehouse that receives the goods; becomes the consignee or ISF ship-to party. */
  shipTo?: Party;
  portsOfDischarge: Location[];
  placeOfDelivery: Location;
  currencies: string[];
}

export interface Carrier {
  name: string;
  scac: string;
  /** ISO 6346 owner code + equipment category (U). */
  ownerCodes: string[];
  blPrefix: string;
}

const loc = (name: string, unLocode: string): Location => ({ name, unLocode, country: unLocode.slice(0, 2) });

const P = {
  teddy: {
    sku: 'TB-200', description: 'Plush teddy bear 30 cm, polyester filling', shortDescription: 'Plush teddy bear 30 cm',
    hsCode: '9503.00', unit: 'PCS', priceCents: [650, 980], netKgPerUnit: '0.180', unitsPerPackage: 50,
    packageType: 'CTN', tareKg: '1.20', dimensionsCm: [60, 40, 40],
  },
  puzzle: {
    sku: 'PZ-1000', description: 'Jigsaw puzzle 1000 pieces, cardboard, boxed', shortDescription: 'Jigsaw puzzle 1000 pcs',
    hsCode: '9503.00', unit: 'PCS', priceCents: [310, 520], netKgPerUnit: '0.620', unitsPerPackage: 24,
    packageType: 'CTN', tareKg: '0.90', dimensionsCm: [52, 38, 30],
  },
  kettle: {
    sku: 'EK-17', description: 'Electric kettle 1.7 L, stainless steel, 1500 W, 120 V', shortDescription: 'Electric kettle 1.7 L',
    hsCode: '8516.71', unit: 'PCS', priceCents: [1150, 1890], netKgPerUnit: '1.050', unitsPerPackage: 8,
    packageType: 'CTN', tareKg: '1.10', dimensionsCm: [55, 45, 42],
  },
  blender: {
    sku: 'BL-600', description: 'Countertop blender 600 W with glass jar', shortDescription: 'Blender 600 W',
    hsCode: '8509.40', unit: 'PCS', priceCents: [1890, 2650], netKgPerUnit: '2.300', unitsPerPackage: 4,
    packageType: 'CTN', tareKg: '1.40', dimensionsCm: [50, 50, 45],
  },
  tshirt: {
    sku: 'TS-CTN-M', description: "Men's T-shirt, knitted, 100% cotton, assorted sizes", shortDescription: "Men's cotton T-shirt",
    hsCode: '6109.10', unit: 'PCS', priceCents: [210, 395], netKgPerUnit: '0.190', unitsPerPackage: 100,
    packageType: 'CTN', tareKg: '0.80', dimensionsCm: [60, 40, 35],
  },
  jacket: {
    sku: 'JK-PL-02', description: "Women's padded jacket, woven polyester shell", shortDescription: "Women's padded jacket",
    hsCode: '6202.40', unit: 'PCS', priceCents: [1450, 2390], netKgPerUnit: '0.850', unitsPerPackage: 20,
    packageType: 'CTN', tareKg: '1.00', dimensionsCm: [65, 45, 45],
  },
  socks: {
    sku: 'SK-WL-3', description: 'Wool blend socks, knitted, 3-pair pack', shortDescription: 'Wool socks 3-pack',
    hsCode: '6115.94', unit: 'PRS', priceCents: [180, 320], netKgPerUnit: '0.075', unitsPerPackage: 240,
    packageType: 'CTN', tareKg: '0.70', dimensionsCm: [58, 38, 32],
  },
  bolts: {
    sku: 'HB-M12', description: 'Hex bolts M12 x 60, carbon steel, zinc plated', shortDescription: 'Hex bolt M12x60',
    hsCode: '7318.15', unit: 'KG', priceCents: [190, 260], netKgPerUnit: '1.000', unitsPerPackage: 500,
    packageType: 'PLT', tareKg: '22.00', dimensionsCm: [120, 100, 60],
  },
  pump: {
    sku: 'CP-750', description: 'Centrifugal water pump 0.75 kW, cast iron body', shortDescription: 'Centrifugal pump 0.75 kW',
    hsCode: '8413.70', unit: 'PCS', priceCents: [6800, 9400], netKgPerUnit: '14.500', unitsPerPackage: 1,
    packageType: 'CRT', tareKg: '4.50', dimensionsCm: [55, 40, 40],
  },
  bearings: {
    sku: 'BB-6204', description: 'Ball bearings 6204-2RS, 20 x 47 x 14 mm', shortDescription: 'Ball bearing 6204-2RS',
    hsCode: '8482.10', unit: 'PCS', priceCents: [85, 140], netKgPerUnit: '0.110', unitsPerPackage: 200,
    packageType: 'CTN', tareKg: '0.90', dimensionsCm: [40, 30, 25],
  },
  coffee: {
    sku: 'CF-GRN-60', description: 'Green coffee beans, arabica, not roasted, in 60 kg jute bags', shortDescription: 'Green coffee arabica',
    hsCode: '0901.11', unit: 'KG', priceCents: [420, 610], netKgPerUnit: '1.000', unitsPerPackage: 60,
    packageType: 'BAG', tareKg: '0.80', dimensionsCm: [95, 60, 25],
  },
  tiles: {
    sku: 'CT-6060', description: 'Glazed porcelain floor tiles 60 x 60 cm', shortDescription: 'Porcelain tile 60x60',
    hsCode: '6907.21', unit: 'M2', priceCents: [690, 1150], netKgPerUnit: '21.000', unitsPerPackage: 40,
    packageType: 'PLT', tareKg: '25.00', dimensionsCm: [120, 80, 90],
  },
  oliveOil: {
    sku: 'OO-EV-5', description: 'Extra virgin olive oil, 5 L tins', shortDescription: 'EV olive oil 5 L',
    hsCode: '1509.20', unit: 'PCS', priceCents: [2150, 2990], netKgPerUnit: '4.600', unitsPerPackage: 4,
    packageType: 'CTN', tareKg: '0.90', dimensionsCm: [40, 30, 35],
  },
  valves: {
    sku: 'BV-2IN', description: 'Brass ball valves 2 inch, threaded', shortDescription: 'Brass ball valve 2"',
    hsCode: '8481.80', unit: 'PCS', priceCents: [1240, 1780], netKgPerUnit: '1.350', unitsPerPackage: 20,
    packageType: 'CTN', tareKg: '1.10', dimensionsCm: [45, 35, 30],
  },
} satisfies Record<string, Product>;

export const SELLERS: Seller[] = [
  {
    party: { name: 'Brightstar Toys Manufacturing Co., Ltd.', address: { lines: ['No. 18 Longgang Industrial Ave', 'Buji Subdistrict'], city: 'Shenzhen', region: 'Guangdong', postalCode: '518112', country: 'CN' }, contact: { name: 'Lily Chen', email: 'export@brightstar-toys.example' } },
    ports: [loc('Yantian', 'CNYTN'), loc('Shekou', 'CNSHK')],
    currencies: ['USD'],
    products: [P.teddy, P.puzzle],
  },
  {
    party: { name: 'Ningbo Everbright Appliance Co., Ltd.', address: { lines: ['366 Jiangnan Rd', 'Beilun District'], city: 'Ningbo', region: 'Zhejiang', postalCode: '315800', country: 'CN' } },
    ports: [loc('Ningbo', 'CNNGB'), loc('Shanghai', 'CNSHA')],
    currencies: ['USD'],
    manufacturer: { name: 'Cixi Hongda Electric Factory', address: { lines: ['22 Xinxing Rd'], city: 'Cixi', region: 'Zhejiang', country: 'CN' } },
    products: [P.kettle, P.blender],
  },
  {
    party: { name: 'Saigon Apparel Joint Stock Company', address: { lines: ['Lot B4, Tan Thuan Export Processing Zone', 'District 7'], city: 'Ho Chi Minh City', postalCode: '700000', country: 'VN' }, taxId: '0301234567' },
    ports: [loc('Ho Chi Minh City', 'VNSGN'), loc('Cai Mep', 'VNCMT')],
    currencies: ['USD'],
    products: [P.tshirt, P.jacket, P.socks],
  },
  {
    party: { name: 'Qingdao Hengli Fasteners & Machinery Co., Ltd.', address: { lines: ['55 Huangpu Rd', 'Huangdao District'], city: 'Qingdao', region: 'Shandong', country: 'CN' } },
    ports: [loc('Qingdao', 'CNTAO')],
    currencies: ['USD'],
    products: [P.bolts, P.bearings, P.pump],
  },
  {
    party: { name: 'Pune Precision Engineering Pvt. Ltd.', address: { lines: ['Plot 41, MIDC Bhosari'], city: 'Pune', region: 'Maharashtra', postalCode: '411026', country: 'IN' }, taxId: '27AABCP1234F1Z5' },
    ports: [loc('Nhava Sheva', 'INNSA'), loc('Mundra', 'INMUN')],
    currencies: ['USD'],
    products: [P.pump, P.valves, P.bearings],
  },
  {
    party: { name: 'Cafe Alto Huila Exportadores S.A.S.', address: { lines: ['Carrera 5 # 12-40'], city: 'Neiva', region: 'Huila', country: 'CO' }, taxId: '900123456-7' },
    ports: [loc('Buenaventura', 'COBUN'), loc('Cartagena', 'COCTG')],
    currencies: ['USD'],
    products: [P.coffee],
  },
  {
    party: { name: 'Ceramiche Valle Secchia S.p.A.', address: { lines: ['Via Radici in Piano 112'], city: 'Sassuolo', region: 'MO', postalCode: '41049', country: 'IT' }, taxId: 'IT01234560362' },
    ports: [loc('La Spezia', 'ITSPE'), loc('Genoa', 'ITGOA')],
    currencies: ['EUR', 'USD'],
    products: [P.tiles, P.oliveOil],
  },
  {
    party: { name: 'Nordhafen Armaturen GmbH', address: { lines: ['Industriestrasse 9'], city: 'Bremen', postalCode: '28197', country: 'DE' }, taxId: 'DE812345678' },
    ports: [loc('Bremerhaven', 'DEBRV'), loc('Hamburg', 'DEHAM')],
    currencies: ['EUR'],
    products: [P.valves, P.pump],
  },
];

export const BUYERS: Buyer[] = [
  {
    destination: 'CA',
    party: { name: 'Northern Lantern Retail Inc.', address: { lines: ['250 Front St W, Suite 1400'], city: 'Toronto', region: 'ON', postalCode: 'M5V 3G5', country: 'CA' }, taxId: '812345678RM0001' },
    shipTo: { name: 'Northern Lantern DC Brampton', address: { lines: ['8 Steinway Blvd'], city: 'Brampton', region: 'ON', postalCode: 'L6T 4X7', country: 'CA' } },
    portsOfDischarge: [loc('Vancouver', 'CAVAN'), loc('Prince Rupert', 'CAPRR'), loc('Montreal', 'CAMTR')],
    placeOfDelivery: loc('Toronto', 'CATOR'),
    currencies: ['USD', 'CAD'],
  },
  {
    destination: 'CA',
    party: { name: 'Quincaillerie Saint-Laurent Ltée', address: { lines: ['1450 boul. Industriel'], city: 'Laval', region: 'QC', postalCode: 'H7S 1P6', country: 'CA' }, taxId: '873456789RM0001' },
    portsOfDischarge: [loc('Montreal', 'CAMTR'), loc('Halifax', 'CAHAL')],
    placeOfDelivery: loc('Montreal', 'CAMTR'),
    currencies: ['USD', 'CAD'],
  },
  {
    destination: 'CA',
    party: { name: 'Coastal Mountain Hardware Ltd.', address: { lines: ['3900 North Fraser Way'], city: 'Burnaby', region: 'BC', postalCode: 'V5J 5H6', country: 'CA' }, taxId: '845678901RM0001' },
    portsOfDischarge: [loc('Vancouver', 'CAVAN')],
    placeOfDelivery: loc('Vancouver', 'CAVAN'),
    currencies: ['USD', 'CAD'],
  },
  {
    destination: 'CA',
    party: { name: 'Prairie Roasters Co-operative', address: { lines: ['77 Commerce Dr'], city: 'Winnipeg', region: 'MB', postalCode: 'R3P 1A2', country: 'CA' }, taxId: '856789012RM0001' },
    portsOfDischarge: [loc('Vancouver', 'CAVAN'), loc('Montreal', 'CAMTR')],
    placeOfDelivery: loc('Winnipeg', 'CAWNP'),
    currencies: ['USD', 'CAD'],
  },
  {
    destination: 'US',
    party: { name: 'Bluebonnet Home Goods LLC', address: { lines: ['4200 Ambassador Caffery Pkwy'], city: 'Houston', region: 'TX', postalCode: '77041', country: 'US' }, taxId: '74-3812456' },
    shipTo: { name: 'Bluebonnet Home Goods DC', address: { lines: ['9800 Wallisville Rd'], city: 'Houston', region: 'TX', postalCode: '77013', country: 'US' } },
    portsOfDischarge: [loc('Houston', 'USHOU')],
    placeOfDelivery: loc('Houston', 'USHOU'),
    currencies: ['USD'],
  },
  {
    destination: 'US',
    party: { name: 'Harborline Industrial Supply Inc.', address: { lines: ['1200 Port Ave'], city: 'Elizabeth', region: 'NJ', postalCode: '07201', country: 'US' }, taxId: '22-4519873' },
    portsOfDischarge: [loc('New York', 'USNYC')],
    placeOfDelivery: loc('Newark', 'USEWR'),
    currencies: ['USD'],
  },
  {
    destination: 'US',
    party: { name: 'Pacific Trail Outfitters Corp.', address: { lines: ['2150 E 37th St'], city: 'Vernon', region: 'CA', postalCode: '90058', country: 'US' }, taxId: '95-4783210' },
    shipTo: { name: 'Pacific Trail Fulfillment Center', address: { lines: ['13500 Valley Blvd'], city: 'Fontana', region: 'CA', postalCode: '92335', country: 'US' } },
    portsOfDischarge: [loc('Los Angeles', 'USLAX'), loc('Long Beach', 'USLGB')],
    placeOfDelivery: loc('Fontana', 'USFON'),
    currencies: ['USD'],
  },
  {
    destination: 'US',
    party: { name: 'Lakeshore Coffee Importers LLC', address: { lines: ['640 W Lake St'], city: 'Chicago', region: 'IL', postalCode: '60661', country: 'US' }, taxId: '36-4128765' },
    portsOfDischarge: [loc('Savannah', 'USSAV'), loc('New York', 'USNYC')],
    placeOfDelivery: loc('Chicago', 'USCHI'),
    currencies: ['USD'],
  },
];

export const CARRIERS: Carrier[] = [
  { name: 'Pacific Crest Container Line', scac: 'PCCL', ownerCodes: ['PCLU', 'PCRU'], blPrefix: 'PCCL' },
  { name: 'Meridian Ocean Shipping', scac: 'MRDN', ownerCodes: ['MDOU'], blPrefix: 'MRDN' },
  { name: 'Aurora Global Lines', scac: 'AGLX', ownerCodes: ['AGXU', 'AGLU'], blPrefix: 'AGLX' },
  { name: 'Tidewater Express Lines', scac: 'TDWE', ownerCodes: ['TWEU'], blPrefix: 'TDWE' },
];

/** Freight forwarders: issue house BLs and act as ISF consolidator. */
export const FORWARDERS: Party[] = [
  { name: 'Silverline Logistics (HK) Ltd.', address: { lines: ['Unit 1203, 12/F, Harbour Centre', '25 Harbour Rd'], city: 'Wan Chai', country: 'HK' } },
  { name: 'Compass Freight Forwarding Co.', address: { lines: ['18 Changjiang Rd'], city: 'Shanghai', country: 'CN' } },
  { name: 'Keystone Cargo Consolidators GmbH', address: { lines: ['Am Sandtorkai 41'], city: 'Hamburg', postalCode: '20457', country: 'DE' } },
];

/** Typical container capacity, in m3, used to decide how many boxes a shipment needs. */
export const CONTAINER_TYPES = [
  { type: '20GP', capacityM3: 28, maxKg: 21000 },
  { type: '40GP', capacityM3: 58, maxKg: 26000 },
  { type: '40HC', capacityM3: 66, maxKg: 26000 },
] as const;
