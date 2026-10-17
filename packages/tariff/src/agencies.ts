import type { Destination, Severity } from '@doccheck/schemas';

/** Where an agency requirement comes from; `excerpt` is quoted from `url` unless it starts with "Summary:". */
export interface AgencySource {
  title: string;
  url: string;
  excerpt: string;
}

/**
 * One partner government agency (US PGA) or other government department (CA OGD) requirement,
 * matched on the declared HS code. The tables say what is *likely* needed: the final word is the
 * agency's own lookup (CBP ACE PGA flags, CFIA AIRS), which also depends on origin and end use.
 */
export interface AgencyRequirement {
  id: string;
  destination: Destination;
  agency: string;
  program: string;
  /** HS code prefixes (2, 4 or 6 digits) the requirement applies to. */
  prefixes: string[];
  /** Prefixes inside those that it does not apply to. */
  exclude?: string[];
  /** MEDIUM when goods are refused without a permit, licence or filing; LOW when it is data or a certificate to have ready. */
  severity: Extract<Severity, 'LOW' | 'MEDIUM'>;
  /** What to prepare, one sentence. */
  requirement: string;
  source: AgencySource;
}

const ecfr = (title: number, part: string) => `https://www.ecfr.gov/current/title-${title}/${part}`;
const justice = (path: string) => `https://laws-lois.justice.gc.ca/eng/${path}/index.html`;
const range = (from: number, to: number, width = 2) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(width, '0'));

/** Food chapters: meat, fish, dairy, produce, grains, oils, preparations, beverages; and salt. */
const FOOD = [...range(2, 4), ...range(7, 13), ...range(15, 22), '2501'];

export const AGENCY_REQUIREMENTS: AgencyRequirement[] = [
  // ---- United States: partner government agencies ----
  {
    id: 'US-FDA-FOOD',
    destination: 'US',
    agency: 'FDA',
    program: 'Prior Notice of imported food',
    prefixes: [...FOOD, '2309'],
    // Meat and poultry are FSIS's.
    exclude: ['0201', '0202', '0203', '0204', '0205', '0206', '0207', '0208', '0209', '0210', '1601', '1602'],
    severity: 'MEDIUM',
    requirement: 'Food needs FDA Prior Notice before it arrives, with the registration number of the facility that made it.',
    source: {
      title: '21 CFR Part 1, Subpart I: Prior Notice of Imported Food',
      url: ecfr(21, 'part-1/subpart-I'),
      excerpt: '(a) This subpart applies to all food for humans and other animals that is imported or offered for import into the United States for use, storage, or distribution in the United States…',
    },
  },
  {
    id: 'US-FSIS-MEAT',
    destination: 'US',
    agency: 'USDA FSIS',
    program: 'Imported meat and poultry reinspection',
    prefixes: ['0201', '0202', '0203', '0204', '0205', '0206', '0207', '0208', '0209', '0210', '1601', '1602'],
    severity: 'MEDIUM',
    requirement: 'Meat and poultry must come from an FSIS-eligible country and establishment, with a foreign inspection certificate, and are reinspected on entry.',
    source: {
      title: '9 CFR Part 327: Imported Products',
      url: ecfr(9, 'part-327'),
      excerpt: 'Offer(ed) for entry. The point at which the importer presents the imported product for reinspection.',
    },
  },
  {
    id: 'US-APHIS-ANIMALS',
    destination: 'US',
    agency: 'USDA APHIS',
    program: 'Veterinary Services import permit',
    prefixes: ['01', '0407', '0511'],
    severity: 'MEDIUM',
    requirement: 'Live animals, hatching eggs and animal products may need an APHIS import permit and a veterinary health certificate.',
    source: {
      title: '9 CFR Part 93: Importation of certain animals, birds, fish, and poultry',
      url: ecfr(9, 'part-93'),
      excerpt: '(a) No product or bird subject to the provisions of this part shall be brought into the United States except in accordance with the regulations in this part and part 94 of this subchapter…',
    },
  },
  {
    id: 'US-APHIS-PLANTS',
    destination: 'US',
    agency: 'USDA APHIS',
    program: 'Plant Protection and Quarantine',
    prefixes: ['06', '07', '08', '1209', '1211', '4401', '4403', '4406', '4407'],
    severity: 'MEDIUM',
    requirement: 'Plants, fresh fruit and vegetables, seeds and timber may need an APHIS permit and a phytosanitary certificate, and must be free of soil and pests.',
    source: {
      title: '7 CFR 319.56-3: General requirements for all imported fruits and vegetables',
      url: ecfr(7, 'part-319'),
      excerpt: 'All fruits and vegetables that are allowed importation under this subpart must be imported in accordance with the following requirements, except as specifically provided otherwise in this subpart.',
    },
  },
  {
    id: 'US-FDA-DRUGS',
    destination: 'US',
    agency: 'FDA',
    program: 'Drug import admissibility',
    prefixes: ['3003', '3004', '3002'],
    severity: 'MEDIUM',
    requirement: 'Drugs need an approved application (or an investigational exemption), a registered foreign establishment and the drug listing in the entry data.',
    source: {
      title: '21 CFR 314.410: Imports and exports of new drugs',
      url: ecfr(21, 'part-314/section-314.410'),
      excerpt: '(a) Imports. (1) A new drug may be imported into the United States if: (i) It is the subject of an approved application under this part; or (ii) it complies with the regulations pertaining to investigational new drugs under part 312…',
    },
  },
  {
    id: 'US-FDA-DEVICES',
    destination: 'US',
    agency: 'FDA',
    program: 'Medical device registration and listing',
    prefixes: ['9018', '9019', '9020', '9021', '9022'],
    severity: 'MEDIUM',
    requirement: 'Medical devices need the foreign establishment registration, the device listing and, where it applies, the 510(k) or PMA number in the entry data.',
    source: {
      title: '21 CFR 807.40: Registration and listing for foreign establishments',
      url: ecfr(21, 'part-807/section-807.40'),
      excerpt: '(a) Any establishment within any foreign country engaged in the manufacture, preparation, propagation, compounding, or processing of a device that is imported or offered for import into the United States shall register such establishment and list such devices…',
    },
  },
  {
    id: 'US-FDA-RADIATION',
    destination: 'US',
    agency: 'FDA',
    program: 'Radiation-emitting electronic products (Form FDA 2877)',
    prefixes: ['851650', '8528', '901320', '9022', '8539'],
    severity: 'LOW',
    requirement: 'Electronic products with an FDA performance standard (microwave ovens, displays, lasers, X-ray, some lamps) need the certification label and a Form FDA 2877 declaration.',
    source: {
      title: '21 CFR 1005.3: Importation of noncomplying goods prohibited',
      url: ecfr(21, 'part-1005/section-1005.3'),
      excerpt: 'The importation of any electronic product for which standards have been prescribed under section 534 of the Federal Food, Drug, and Cosmetic Act (the act) (21 U.S.C. 360kk) shall be refused admission into the United States unless there is affixed to such product a certification…',
    },
  },
  {
    id: 'US-EPA-TSCA',
    destination: 'US',
    agency: 'EPA',
    program: 'TSCA import certification',
    prefixes: ['28', '29', '32', '34', '35', '38', '3901', '3902', '3903', '3904', '3905', '3906', '3907', '3908', '3909', '3910', '3911', '3912', '3913', '3914'],
    exclude: ['3808', '2939', '2941'],
    severity: 'MEDIUM',
    requirement: 'Chemical substances and mixtures need a TSCA positive or negative certification from the importer at entry.',
    source: {
      title: '19 CFR 12.118: Toxic Substances Control Act',
      url: ecfr(19, 'part-12/section-12.118'),
      excerpt: 'The Toxic Substances Control Act (“TSCA”) (15 U.S.C. 2601 et seq.) governs the importation into the customs territory of the United States of a chemical substance in bulk form or as part of a mixture, and articles containing a chemical substance or mixture.',
    },
  },
  {
    id: 'US-EPA-PESTICIDES',
    destination: 'US',
    agency: 'EPA',
    program: 'Notice of Arrival of Pesticides and Devices (EPA Form 3540-1)',
    prefixes: ['3808'],
    severity: 'MEDIUM',
    requirement: 'Pesticides need an EPA Notice of Arrival (Form 3540-1) submitted before the shipment arrives.',
    source: {
      title: '19 CFR 12.112: Notice of arrival of pesticides and devices',
      url: ecfr(19, 'part-12/section-12.112'),
      excerpt: '(a) General. An importer or the importer\'s agent desiring to import pesticides or devices into the United States must submit to the Administrator, prior to the arrival of the shipment in the United States, a Notice of Arrival of Pesticides and Devices (Notice of Arrival) on U.S. Environmental Protection Agency (EPA) Form 3540-1.',
    },
  },
  {
    id: 'US-EPA-ENGINES',
    destination: 'US',
    agency: 'EPA',
    program: 'Vehicle and engine emissions (EPA Form 3520-1 / 3520-21)',
    prefixes: ['8407', '8408', '8701', '8702', '8703', '8704', '8705', '8711'],
    severity: 'MEDIUM',
    requirement: 'Motor vehicles and engines must meet EPA emission requirements, declared on EPA Form 3520-1 (vehicles) or 3520-21 (engines).',
    source: {
      title: '19 CFR 12.73: Importation of motor vehicles and motor vehicle engines',
      url: ecfr(19, 'part-12/section-12.73'),
      excerpt: '(a) Applicability of EPA requirements. This section is ancillary to the regulations of the U.S. Environmental Protection Agency (EPA) issued under the Clean Air Act… This section applies to imported motor vehicles…',
    },
  },
  {
    id: 'US-NHTSA',
    destination: 'US',
    agency: 'NHTSA',
    program: 'Motor vehicle safety declaration (HS-7)',
    prefixes: ['8702', '8703', '8704', '8711', '4011', '8708', '940120'],
    severity: 'MEDIUM',
    requirement: 'Motor vehicles and regulated equipment (tires, some parts, child seats) need an HS-7 declaration that they meet the Federal motor vehicle safety standards.',
    source: {
      title: '49 CFR 591.5: Declarations required for importation',
      url: ecfr(49, 'part-591/section-591.5'),
      excerpt: 'No person shall import a motor vehicle or item of motor vehicle equipment into the United States unless, at the time it is offered for importation, its importer files a declaration and documentation…',
    },
  },
  {
    id: 'US-FCC',
    destination: 'US',
    agency: 'FCC',
    program: 'Radio frequency devices (FCC Form 740)',
    prefixes: ['8471', '8517', '8518', '8519', '8521', '8525', '8526', '8527', '8528', '8543'],
    severity: 'LOW',
    requirement: 'Radio frequency devices must meet an FCC entry condition (equipment authorization or an exemption), declared with FCC Form 740 data when CBP asks for it.',
    source: {
      title: '47 CFR 2.1203: General requirement for entry into the U.S.A.',
      url: ecfr(47, 'part-2/section-2.1203'),
      excerpt: '(a) No radio frequency device may be imported into the Customs territory of the United States unless the importer or ultimate consignee, or their designated customs broker, determines that the device meets one of the conditions for entry set out in § 2.1204.',
    },
  },
  {
    id: 'US-CPSC',
    destination: 'US',
    agency: 'CPSC',
    program: "Children's Product Certificate / General Certificate of Conformity",
    prefixes: ['9503', '9504', '9505', '8712', '940171', '9403', '6111', '6209', '9506'],
    severity: 'MEDIUM',
    requirement: "Toys and other children's products need a Children's Product Certificate based on third-party testing; other regulated consumer products a General Certificate of Conformity.",
    source: {
      title: '16 CFR 1110.13: Certificate availability',
      url: ecfr(16, 'part-1110/section-1110.13'),
      excerpt: '(a) Accompanying certificates. A finished product certificate must accompany each finished product or finished product shipment required to be certified pursuant to § 1110.5.',
    },
  },
  {
    id: 'US-ATF',
    destination: 'US',
    agency: 'ATF',
    program: 'Import permit (ATF Form 6)',
    prefixes: ['9301', '9302', '9303', '9304', '9305', '9306'],
    severity: 'MEDIUM',
    requirement: 'Firearms, ammunition and other defense articles on the U.S. Munitions Import List need an ATF import permit (Form 6) before entry.',
    source: {
      title: '27 CFR 447.41: Permit requirement',
      url: ecfr(27, 'part-447/section-447.41'),
      excerpt: '(a) Articles on the U.S. Munitions Import List will not be imported into the United States except pursuant to a permit under this subpart.',
    },
  },
  {
    id: 'US-DEA',
    destination: 'US',
    agency: 'DEA',
    program: 'Controlled substances and listed chemicals import permit or declaration',
    prefixes: ['130211', '2939', '300341', '300342', '300343', '300441', '300442', '300443'],
    severity: 'MEDIUM',
    requirement: 'Controlled substances need a DEA import permit (Form 357) or declaration (Form 236), and List I chemicals an import declaration (Form 486), before shipment.',
    source: {
      title: '21 CFR 1312.11: Requirement of authorization to import',
      url: ecfr(21, 'part-1312/section-1312.11'),
      excerpt: '(a) No person shall import, or cause to be imported, into the customs territory of the United States… any controlled substances listed in Schedule I or II, or any narcotic controlled substance listed in Schedule III, IV, or V…',
    },
  },

  // ---- Canada: other government departments ----
  {
    id: 'CA-CFIA-FOOD',
    destination: 'CA',
    agency: 'CFIA',
    program: 'Safe Food for Canadians licence; AIRS conditions',
    prefixes: FOOD,
    severity: 'MEDIUM',
    requirement: 'Food imports need a Safe Food for Canadians licence to import; check CFIA AIRS (https://airs-sari.inspection.gc.ca) for this code and origin for certificates or permits.',
    source: {
      title: 'Safe Food for Canadians Act, s. 10(1)',
      url: justice('acts/S-1.1'),
      excerpt: 'It is prohibited for a person to send or convey from one province to another — or to import or export — a prescribed food commodity unless the person does so in accordance with the regulations.',
    },
  },
  {
    id: 'CA-CFIA-ANIMALS',
    destination: 'CA',
    agency: 'CFIA',
    program: 'Health of Animals import conditions (AIRS)',
    prefixes: ['01', '0407', '0502', '0504', '0505', '0506', '0511', '2309', '4101', '4102', '4103'],
    severity: 'MEDIUM',
    requirement: 'Live animals, animal by-products and animal feed may need a CFIA import permit or zoosanitary certificate; check AIRS for this code and origin.',
    source: {
      title: 'Health of Animals Regulations, s. 40',
      url: justice('regulations/C.R.C.,_c._296'),
      excerpt: 'No person shall import into Canada an animal by-product, manure or a thing containing an animal by-product or manure except in accordance with this Part.',
    },
  },
  {
    id: 'CA-CFIA-PLANTS',
    destination: 'CA',
    agency: 'CFIA',
    program: 'Plant protection import conditions (AIRS)',
    prefixes: ['06', '0701', '1209', '1211', '1404', '4401', '4403', '4404', '4406', '4407', '31'],
    severity: 'MEDIUM',
    requirement: 'Plants, seeds, wood and fertilizers may need a CFIA import permit or phytosanitary certificate; check AIRS for this code and origin.',
    source: {
      title: 'Plant Protection Regulations, s. 39(2)',
      url: justice('regulations/SOR-95-212'),
      excerpt: 'No person shall import into Canada a thing that the Minister or an inspector has prohibited from entering Canada in writing, or in a permit where the permit prohibits the importation of that thing.',
    },
  },
  {
    id: 'CA-HC-DEVICES',
    destination: 'CA',
    agency: 'Health Canada',
    program: 'Medical device establishment licence',
    prefixes: ['9018', '9019', '9020', '9021', '9022', '3005', '300650'],
    severity: 'MEDIUM',
    requirement: 'Medical devices can only be imported by a holder of a Medical Device Establishment Licence (and Class II–IV devices need a device licence).',
    source: {
      title: 'Medical Devices Regulations, s. 44(1)',
      url: justice('regulations/SOR-98-282'),
      excerpt: 'No person shall import or sell a medical device unless the person holds an establishment licence.',
    },
  },
  {
    id: 'CA-HC-TOYS',
    destination: 'CA',
    agency: 'Health Canada',
    program: 'Canada Consumer Product Safety Act: Toys Regulations',
    prefixes: ['9503', '9504', '9505'],
    severity: 'LOW',
    requirement: 'Toys must meet the Toys Regulations (small parts, labelling, chemical limits); keep the test reports the importer may be asked for.',
    source: {
      title: 'Toys Regulations (SOR/2011-17), s. 1',
      url: justice('regulations/SOR-2011-17'),
      excerpt: 'toy means a product that is intended for use by a child under 14 years of age in learning or play.',
    },
  },
  {
    id: 'CA-HC-PESTICIDES',
    destination: 'CA',
    agency: 'Health Canada (PMRA)',
    program: 'Pest Control Products Act registration',
    prefixes: ['3808'],
    severity: 'MEDIUM',
    requirement: 'Pest control products must be registered with the PMRA (or covered by an import exemption) and labelled as registered.',
    source: {
      title: 'Pest Control Products Act, s. 6',
      url: justice('acts/P-9.01'),
      excerpt: 'no person shall store, import, export or distribute a pest control product that is not packaged and labelled in accordance with the regulations and, if it is registered, the conditions of registration.',
    },
  },
  {
    id: 'CA-ECCC-SUBSTANCES',
    destination: 'CA',
    agency: 'ECCC',
    program: 'New Substances Notification (CEPA)',
    prefixes: ['28', '29', '32', '34', '38', '3901', '3902', '3903', '3904', '3905', '3906', '3907', '3908', '3909', '3910', '3911', '3912', '3913', '3914'],
    exclude: ['3808'],
    severity: 'LOW',
    requirement: 'A chemical or polymer that is not on the Domestic Substances List must be notified to Environment and Climate Change Canada before it is imported.',
    source: {
      title: 'New Substances Notification Regulations (Chemicals and Polymers)',
      url: justice('regulations/SOR-2005-247'),
      excerpt: 'Summary: under the Canadian Environmental Protection Act, 1999, a substance not on the Domestic Substances List is notified, with the information these Regulations prescribe, before it is manufactured or imported.',
    },
  },
  {
    id: 'CA-ECCC-EMISSIONS',
    destination: 'CA',
    agency: 'ECCC',
    program: 'On-Road Vehicle and Engine Emission Regulations',
    prefixes: ['8407', '8408', '8702', '8703', '8704', '8711'],
    severity: 'MEDIUM',
    requirement: 'Vehicles and engines must meet the Canadian emission standards; the importer keeps the evidence of conformity.',
    source: {
      title: 'On-Road Vehicle and Engine Emission Regulations, s. 4',
      url: justice('regulations/SOR-2003-2'),
      excerpt: '…to engines whose manufacture is completed in Canada on or after January 1, 2004 and to vehicles and engines that are imported into Canada on or after January 1, 2004.',
    },
  },
  {
    id: 'CA-TC-VEHICLES',
    destination: 'CA',
    agency: 'Transport Canada',
    program: 'Motor Vehicle Safety Act: Vehicle Import Form, Registrar of Imported Vehicles',
    prefixes: ['8702', '8703', '8704', '8711', '8716', '4011'],
    severity: 'MEDIUM',
    requirement: 'Vehicles need a Vehicle Import Form (Form 1) and, when not built to Canadian standards, inspection by the Registrar of Imported Vehicles; tires must meet the Motor Vehicle Tire Safety Regulations.',
    source: {
      title: 'Motor Vehicle Safety Regulations, s. 7',
      url: justice('regulations/C.R.C.,_c._1038'),
      excerpt: '…will be taken to the registrar of imported vehicles for inspection and will not be presented for registration under the laws of a province unless a Canadian certification label is issued in respect of the vehicle by the registrar of imported vehicles.',
    },
  },
  {
    id: 'CA-GAC-SUPPLY',
    destination: 'CA',
    agency: 'Global Affairs Canada',
    program: 'Import Control List: supply-managed farm products',
    prefixes: ['0105', '0207', '0209', '0210', '0401', '0402', '0403', '0404', '0405', '0406', '0407', '0408', '1601', '1602', '2105', '3501'],
    severity: 'MEDIUM',
    requirement: 'Poultry, eggs and dairy are on the Import Control List: an import permit is needed to enter within the tariff-rate quota, otherwise the over-access rate applies.',
    source: {
      title: 'Import Control List, items 95–106 (poultry, eggs) and 117–124 (dairy)',
      url: justice('regulations/C.R.C.,_c._604'),
      excerpt: 'Milk and cream, neither concentrated nor containing added sugar or other sweetening matter, of a fat content, by weight, not exceeding 6 per cent, that are classified under tariff item No. 0401.10.10…',
    },
  },
  {
    id: 'CA-GAC-STEEL',
    destination: 'CA',
    agency: 'Global Affairs Canada',
    program: 'Import Control List: steel products (General Import Permit No. 80/81)',
    prefixes: ['7206', '7207', '7208', '7209', '7210', '7211', '7212', '7213', '7214', '7215', '7216', '7217', '7218', '7219', '7220', '7221', '7222', '7223', '7224', '7225', '7226', '7227', '7228', '7229', '7301', '7302', '7303', '7304', '7305', '7306'],
    severity: 'LOW',
    requirement: 'Steel products are on the Import Control List: the entry must quote the general import permit (No. 80 carbon, No. 81 specialty steel).',
    source: {
      title: 'Import Control List, items 80 and 81',
      url: justice('regulations/C.R.C.,_c._604'),
      excerpt: 'Carbon steel products including semi-finished products (ingots, blooms, billets, slabs and sheet bars), plate, sheet and strip, wire rods, wire and wire products, railway-type products, bars, structural shapes and units, pipes and tubes, but excluding the specialty steel products referred to in item 81',
    },
  },
  {
    id: 'CA-GAC-WEAPONS',
    destination: 'CA',
    agency: 'Global Affairs Canada',
    program: 'Import Control List: weapons and munitions',
    prefixes: ['9301', '9302', '9303', '9304', '9305', '9306'],
    severity: 'MEDIUM',
    requirement: 'Weapons, munitions and their parts are on the Import Control List and need an import permit (and, for firearms, the Canadian Firearms Program forms).',
    source: {
      title: 'Import Control List, item 71',
      url: justice('regulations/C.R.C.,_c._604'),
      excerpt: 'Large-calibre armaments or weapons and projectors that are (a) guns…',
    },
  },
];

/** The requirements a declared code falls under for a destination, in table order. */
export function agencyRequirements(digits: string, destination: Destination): AgencyRequirement[] {
  if (digits.length < 4) return [];
  return AGENCY_REQUIREMENTS.filter(
    (r) => r.destination === destination && r.prefixes.some((p) => digits.startsWith(p)) && !r.exclude?.some((p) => digits.startsWith(p)),
  );
}
