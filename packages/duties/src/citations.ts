/**
 * Regulation passages behind the duty findings, quoted from the documents in data/corpus (same
 * title, URL and effective date as there). Fixed per finding, so citing needs no model.
 */
export interface Citation {
  title: string;
  url: string;
  effectiveDate?: string;
  excerpt: string;
}

const CFR_152 = { title: '19 CFR Part 152 Subpart E: Valuation of Merchandise', url: 'https://www.ecfr.gov/current/title-19/chapter-I/part-152/subpart-E', effectiveDate: '2026-10-08' };
const D13_4_7 = { title: 'Memorandum D13-4-7: Adjustments to the Price Paid or Payable (Customs Act, Section 48)', url: 'https://www.cbsa-asfc.gc.ca/publications/dm-md/d13/d13-4-7-eng.html', effectiveDate: '2023-03-08' };
const D11_4_2 = { title: 'Memorandum D11-4-2: Proof of Origin of Imported Goods', url: 'https://www.cbsa-asfc.gc.ca/publications/dm-md/d11/d11-4-2-eng.html', effectiveDate: '2023-01-31' };

export const CITATIONS = {
  usPricePaid: {
    ...CFR_152,
    excerpt:
      '(f) Price actually paid or payable. "Price actually paid or payable" means the total payment (whether direct or indirect, and exclusive of any charges, costs, or expenses incurred for transportation, insurance, and related services incident to the international shipment of the merchandise from the country of exportation to the place of importation in the United States) made, or to be made, for imported merchandise by the buyer to, or for the benefit of, the seller.',
  },
  usAdditions: {
    ...CFR_152,
    excerpt:
      '(b) Additions to price actually paid or payable. (1) The transaction value of imported merchandise is the price actually paid or payable for the merchandise when sold for exportation to the United States, plus amounts equal to: ... (iv) Any royalty or license fee related to the imported merchandise that the buyer is required to pay, directly or indirectly, as a condition of the sale of the imported merchandise for exportation to the United States',
  },
  usRelated: {
    ...CFR_152,
    excerpt:
      '(l) Related buyer and seller—(1) Validation of transaction. The Center director shall not disregard a transaction value solely because the buyer and seller are related. There will be related person transactions in which validation of the transaction value, using the procedures contained in § 152.103(j)(2), may not be necessary.',
  },
  caTransportAdded: {
    ...D13_4_7,
    excerpt:
      '14. Any of the costs referred to in subparagraph 48(5)(a)(vi), if they arise prior to and at the place from which the goods begin their direct and uninterrupted journey to Canada, are to be included in the transaction value of the goods (refer to Memorandum D13-3-3, Transportation and Associated Costs, and Memorandum D13-3-4, Place of Direct Shipment).',
  },
  caTransportDeducted: {
    ...D13_4_7,
    excerpt:
      '16. Any of the costs referred to in subparagraph 48(5)(b)(i), if they arise after the place from which the goods begin their direct and uninterrupted journey to Canada, would not be included in the transaction value of the goods.',
  },
  caAssistsRoyalties: {
    ...D13_4_7,
    excerpt:
      '10. In determining the transaction value under section 48, the value of any assist ... is to be included in the transaction value. 11. The amount of any payment for a royalty or licence fee in respect of the imported goods is to be included in the transaction value, provided this payment is a condition of the sale of the goods for export to Canada.',
  },
  cusmaCertification: {
    ...D11_4_2,
    excerpt:
      '43. For purposes of CPTPP and CUSMA, the certification of origin consists respectively of a set of minimum data requirements or minimum data elements which may be placed on an invoice or any other document and does not need to follow a prescribed format. ... the minimum data elements for CUSMA are set out in Annex 5-A of Chapter 5 of CUSMA.',
  },
  proofOfOrigin: {
    ...D11_4_2,
    excerpt:
      '24. ... For the purpose of certifying that a good exported to a free trade partner qualifies as an originating good under CPTPP or CUSMA, the certification of origin established under the relevant free trade agreement must be completed and signed by either the importer, the exporter, or the producer of the good.',
  },
} satisfies Record<string, Citation>;
