---
id: "hmrc-cds-group-3"
title: "CDS import declaration completion guide (UK Tariff volume 3): Group 3, Parties"
authority: "HMRC"
language: "en"
url: "https://www.gov.uk/government/publications/cds-uk-trade-tariff-volume-3-import-declaration-completion-guide/group-3-parties"
effectiveDate: "2026-10-07"
retrievedAt: "2026-10-16"
---

## DE 3/16 Importer Identification Number

DE 3/16 Importer Identification Number.

Declaration Categories — Field format — No. of occurrences at header level — No. of occurrences at item level

H1, H2, H3, H4, H5, H7, I1 C&F and I1 B&E — an..17 — 1x — NA

All Declaration Categories:

For imports into Great Britain (GB):

DE 3/15 may only be completed where a recognised GB EORI is not held. If a recognised GB EORI is held it must be declared in DE 3/16.

DE 3/15 must be left blank where a GB EORI is provided in DE 3/16.

For imports into Northern Ireland (NI):

If a recognised EORI is held it must be declared in DE 3/16. DE 3/15 must be left blank where an XI or EU EORI is declared in DE 3/16.

DE 3/15 is mandatory where:

- A GB EORI is declared in DE 3/16 or

- DE 3/16 is left blank

A GB EORI is permitted in DE 3/16 where the importer is:

- Utilising certain transit and special procedures authorisations where a specific legal exemption under Taxation (Cross-Border Trade) Act (TCTA) 2018 or Regulation (EU) No. 952/2013 (Article 170) and/or Regulation (EU) No. 2015/2446 (Articles 5 and 6) applies

- Entering goods using excise authorisations and approvals

- Submitting a supplementary declaration for which the tax point is prior to the introduction of XI or EU EORIs

- Using indirect representation by a representative with an XI or EU EORI who is established in NI or EU

- The UKIMS authorisation holder and the authorisation has been issued against a GB EORI

In no other circumstances may a GB EORI be declared in DE 3/16 for imports to NI.

When a UKIMS authorisation is used, the following details must be declared:

- DE 2/3: document code ‘1UKI’ followed by the UKIMS authorisation decision number

- DE 3/16: GB or XI EORI associated with the UKIMS authorisation

- DE 3/39: Authorisation type ‘UKIM’ followed by the GB or XI EORI of the UKIMS authorisation holder as declared in DE 3/16

Notes:

The importer can only be declared once at the header level.

When goods are being entered to a private customs warehouse, the GB, EU or XI EORI number of the warehouse authorisation holder declared against code CWP in DE 3/39 must be the same as the importer’s GB, EU or XI EORI number declared in DE 3/16.

When goods are declared for removal from a free zone/ freeport, enter the identity of the party removing the goods from the free zone/ freeport or placing them under the Requested Procedure (DE 1/10) as the importer (DE 3/15 or 3/16).

Where the goods are sold in warehouse as a retail sale, the buyer of the goods under the retail sale should be declared as the Buyer (DE 3/26 or 3/27). The depositor of the goods should be declared as the importer (DE 3/15 or 3/16).

When goods are declared for removal from Temporary Admission (TA), enter the identity of the party removing the goods from TA or placing them under the Requested Procedure (DE 1/10) as the importer (DE 3/15 or 3/16).

For commercial importations a GB, EU or XI EORI number must be used unless a specific legal exemption applies under Taxation (Cross-Border Trade) Act (TCTA) 2018 or Regulation (EU) No. 952/2013 (Article 170) and/or Regulation (EU) No. 2015/2446 (Articles 5 and 6). This applies to all commercial imports including ‘one off’ consignments. For those who do not require a GB, EU or XI EORI number, under Taxation (Cross-Border Trade) Act (TCTA) 2018 or Regulation (EU) No. 952/2013 (Article 170) and/or Regulation (EU) No. 2015/2446 (Articles 5 and 6), enter:

- ‘00500’ in DE 2/2 Additional Information

- ‘00500’ in the Name section of DE 3/15 (Importer’s Name and Address) prefaced by the GB country code of the importer followed by their name and

- Enter their address as normal in the remaining sections of DE 3/15.

Import VAT

An import VAT certificate C79 will only be issued when a recognised VAT registered importer’s GB, EU or XI EORI number is declared at the header level in DE 3/16 (Importer Identification number). In the absence of an import VAT certificate, a copy of the declaration will need to be kept as evidence of the importation.

When using IOSS a C79 certificate will not be issued and import VAT cannot be reclaimed through normal business rules on VAT returns.

Establishment rules for imports into Northern Ireland (NI):

- Except where an exemption applies under Taxation (Cross-Border Trade) Act (TCTA) 2018 or Regulation (EU) No. 952/2013 (Article 170) and/or EU Reg No. 2015/2446 (Articles 5 and 6), the Importer must be established in NI or the EU.

- Where the Importer is not established in NI or EU, irrespective of whether an XI or EU EORI is declared in DE 3/16, an Indirect Representative must be used and code ‘3’ must be declared in DE 3/21.

The instances in which a GB EORI is permitted does not affect the requirement to be established in NI or the EU. Where self-representation is used, the importer must be established in NI or EU, must declare an EORI in DE 3/16, and DE 3/15 must be left blank.

## DE 3/24 Seller Name and Address

DE 3/24 Seller Name and Address.

Declaration Categories — Field format — No. of occurrences at header level — No. of occurrences at item level

H1 — Name: an..70 + Street and number: an..70 + Country a2+ Postcode: an..9 + City: an..35 + Phone number: an..50 — 1x — 1x

For H1 declarations only:

The Seller details are only required where the Seller is a different party to the exporter declared in DE 3/1 or 3/2.

Where the Seller is a different party to the Exporter and holds a recognised GB, EU or XI EORI number, this should be declared in DE 3/25.

Where Seller details are required and no recognised GB, EU or XI EORI is held, enter the Seller’s Name and Address details in DE 3/24.

A contact phone number should be provided if available.

Name and address

Enter the full name and address of the Seller, including the postcode. Where a country does not use a postcode or equivalent code, (for example, US zip code), enter ‘NA’ in this section of the data element.

Notes:

The Seller is the last known entity by whom the goods are sold or agreed to be sold to the buyer. If the goods are to be imported other than in pursuit of a purchase, the details of the owner of the goods within the third country shall be provided.

If there is only one Seller, then the Seller details are to be supplied at header level.

If there is more than one Seller, then:

- Code 00200 must be entered in each of the Name, Street, City and Postcode fields. at header level in DE 3/24 — A valid country code is also required at header level as part of the seller address

- Additional Information Code 00200 is to be completed in DE 2/2 as per the instructions in Appendix 4: DE 2/2: Additional Information (AI) Statement Codes and

- The individual Seller’s details must be supplied at item level (one Seller per item)

## DE 3/26 Buyer Name and Address

DE 3/26 Buyer Name and Address.

Declaration Categories — Field format — No. of occurrences at header level — No. of occurrences at item level

H1 — Name: an..70 + Street and number: an..70 + Country: a2 + Postcode: an..9 + City an..35 + Phone number: an..50 — 1x — 1x

For H1 declarations only:

The Buyer details are only required where the Buyer is a different party to the importer declared in DE 3/15 or 3/16.

Where the Buyer is a different party to the Importer and holds a recognised GB, EU or XI EORI number, this should be declared in DE 3/27.

Where Buyer details are required and no recognised GB, EU or XI EORI is held, enter the Buyer’s Name and Address details in DE 3/26.

A contact phone number should be provided if available.

Onward Supply Relief (OSR in Northern Ireland only):

Where a tax representative is used for OSR, the Buyer details must be completed in DE 3/27.

Name and address

Enter the full name and address of the Buyer, including the postcode. Where a country does not use a postcode or equivalent code, (for example, US zip code), enter ‘NA’ in this section of the data element.

Notes:

‘Buyer’ is the last known entity to whom the goods are sold or agreed to be sold. If the goods are to be imported other than in pursuance of a purchase, the details of the owner of the goods within the Territory of the EU shall be provided.

Where the goods are sold in warehouse as a retail sale, the buyer of the goods under the retail sale should be declared in this data element. The depositor of the goods should be declared as the importer (DE 3/15 or 3/16).

This item can be declared once at header or item level.

Where the Buyer holds a GB, EU or XI EORI number this must be declared in DE 3/27.
