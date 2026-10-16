import type { Destination } from '@doccheck/schemas';
import type { AgencySource } from './agencies';

/**
 * Dual-use hints: goods whose HS code or description suggests a category of the Wassenaar dual-use
 * list, which both the US Commerce Control List (EAR Part 774) and Canada's Export Control List
 * (Group 1) follow. Informational only: whether an item is controlled depends on its technical
 * parameters, which an invoice does not show. The point is to ask the seller for its export
 * classification (ECCN) before the goods ship, and to know they may need a licence to re-export.
 */
export interface ExportControlHint {
  id: string;
  /** Wassenaar / CCL category number: 3 electronics, 4 computers, 5 telecommunications and information security, 6 sensors and lasers, 9 aerospace. */
  category: 3 | 4 | 5 | 6 | 9;
  label: string;
  /** Matching HS prefixes; alone they are enough only when `needsKeyword` is false. */
  prefixes: string[];
  /** Words in the description that suggest the controlled kind of item. */
  keywords: RegExp;
  /** The HS code alone is too broad (every laptop is 8471): also require a keyword. */
  needsKeyword: boolean;
}

export const EXPORT_CONTROL_HINTS: ExportControlHint[] = [
  {
    id: 'EC-3-ELECTRONICS',
    category: 3,
    label: 'Category 3, electronics (integrated circuits, FPGAs, high-speed converters, test equipment)',
    prefixes: ['8542', '854140', '9030', '854320'],
    keywords: /\b(fpga|asic|radiation[- ]hard(ened)?|rad[- ]hard|analog[- ]to[- ]digital|adc|dac|oscilloscope|signal generator|spectrum analy[sz]er|network analy[sz]er|microwave (amplifier|transistor|mmic)|gan transistor|mmic)\b/i,
    needsKeyword: true,
  },
  {
    id: 'EC-4-COMPUTERS',
    category: 4,
    label: 'Category 4, computers (high-performance computers, AI accelerators)',
    prefixes: ['8471', '847330', '854231'],
    keywords: /\b(server|supercomputer|high[- ]performance comput\w*|hpc|gpu|graphics processing unit|ai accelerator|tensor processing|neural processing)\b/i,
    needsKeyword: true,
  },
  {
    id: 'EC-5-TELECOM',
    category: 5,
    label: 'Category 5 Part 1, telecommunications (base stations, satellite, radio equipment)',
    prefixes: ['8517', '8525', '8526', '8529'],
    keywords: /\b(base station|5g|lte|satellite|radio relay|microwave link|software[- ]defined radio|sdr|jamm(er|ing)|interception|ip network monitoring)\b/i,
    needsKeyword: true,
  },
  {
    id: 'EC-5-CRYPTO',
    category: 5,
    label: 'Category 5 Part 2, information security (encryption)',
    prefixes: [],
    keywords: /\b(encrypt\w*|cryptograph\w*|aes[- ]?(128|192|256)|hardware security module|hsm|vpn|firewall|secure (router|gateway)|quantum key)\b/i,
    needsKeyword: true,
  },
  {
    id: 'EC-6-SENSORS',
    category: 6,
    label: 'Category 6, sensors and lasers (thermal imaging, night vision, radar, lasers)',
    prefixes: ['901320', '9013', '8526'],
    keywords: /\b(thermal (camera|imag\w*)|infrared camera|night vision|image intensifier|focal plane array|radar|lidar|laser)\b/i,
    needsKeyword: true,
  },
  {
    id: 'EC-9-UAV',
    category: 9,
    label: 'Category 9, aerospace (unmanned aircraft, gas turbine engines)',
    prefixes: ['8806', '8807', '8411'],
    keywords: /\b(drone|uav|unmanned aerial|unmanned aircraft|turbojet|turbofan)\b/i,
    needsKeyword: false,
  },
];

export const EXPORT_CONTROL_SOURCE: Record<Destination, AgencySource> = {
  US: {
    title: '15 CFR Part 774: The Commerce Control List',
    url: 'https://www.ecfr.gov/current/title-15/part-774',
    excerpt: 'Summary: the Commerce Control List (Supplement No. 1 to Part 774) lists dual-use items by category (3 electronics, 4 computers, 5 telecommunications and information security, 6 sensors and lasers, 9 aerospace); an item it lists may need a licence to be exported or re-exported from the United States.',
  },
  CA: {
    title: 'Export Control List (SOR/89-202), Group 1: dual-use list',
    url: 'https://laws-lois.justice.gc.ca/eng/regulations/SOR-89-202/index.html',
    excerpt: 'Group 1 of the Guide, the export of which Canada has agreed to control in accordance with the Wassenaar Arrangement.',
  },
};

export interface ExportControlMatch {
  hint: ExportControlHint;
  /** What matched: "HS 8542.31" or the keyword found in the description. */
  reason: string;
}

/** Hints for one invoice line, from its code and description. */
export function exportControlHints(digits: string | undefined, description: string): ExportControlMatch[] {
  const out: ExportControlMatch[] = [];
  for (const hint of EXPORT_CONTROL_HINTS) {
    const byCode = !!digits && hint.prefixes.some((p) => digits.startsWith(p));
    const word = description.match(hint.keywords)?.[0];
    if (hint.needsKeyword ? (hint.prefixes.length === 0 || byCode) && !!word : byCode || !!word) {
      out.push({ hint, reason: word ? `"${word}" in the description` : `HS ${digits}` });
    }
  }
  return out;
}
