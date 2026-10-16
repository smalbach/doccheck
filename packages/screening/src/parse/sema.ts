import type { ListEntry } from '../types';
import { isoDate, uniq, xmlElements, xmlText, xmlTexts } from './formats';

/**
 * Canada's Consolidated Special Economic Measures Act (SEMA) list, XML: one <record> per person,
 * entity or ship. The country field is the sanctions regime ("Russia / Russie"), not where the
 * party is, so it goes into the programs and not into the entry's countries.
 */
export function parseSema(xml: string): ListEntry[] {
  return xmlElements(xml, 'record').flatMap((rec): ListEntry[] => {
    const entity = xmlText(rec, 'EntityOrShip-EntiteOuNavire');
    const person = [xmlText(rec, 'GivenName-Prenom'), xmlText(rec, 'LastName-NomDeFamille')].filter(Boolean).join(' ');
    const name = entity ?? person;
    if (!name) return [];
    const regime = xmlText(rec, 'Country-Pays') ?? '';
    const schedule = xmlText(rec, 'Schedule-Annexe') ?? '';
    const item = xmlText(rec, 'Item-NumeroDarticle') ?? '';
    const ship = xmlText(rec, 'ShipIMONumber-NumeroOMIDuNavire');
    const aliases = xmlTexts(rec, 'Aliases-Alias').flatMap((a) => a.split(/\s*;\s*/)).filter((a) => a && a !== name);
    const listed = isoDate(xmlText(rec, 'DateOfListing-DateDinscription'));
    return [
      {
        id: `${regime.split('/')[0].trim()}|${schedule}|${item}`,
        list: 'ca-sema',
        name,
        aliases: uniq(aliases),
        type: ship ? 'vessel' : entity ? 'entity' : 'individual',
        countries: [],
        addresses: [],
        programs: [`SEMA ${regime.split('/')[0].trim()}, Schedule ${schedule}`.trim()],
        ...(ship ? { remarks: `IMO ${ship}` } : {}),
        url: 'https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx?lang=eng',
        ...(listed ? { listedOn: listed } : {}),
      },
    ];
  });
}
