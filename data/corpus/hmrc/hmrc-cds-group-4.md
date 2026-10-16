---
id: "hmrc-cds-group-4"
title: "CDS import declaration completion guide (UK Tariff volume 3): Group 4, Valuation information and taxes"
authority: "HMRC"
language: "en"
url: "https://www.gov.uk/government/publications/cds-uk-trade-tariff-volume-3-import-declaration-completion-guide/group-4-valuation-information-and-taxes"
effectiveDate: "2026-10-07"
retrievedAt: "2026-10-16"
---

## DE 4/1 Delivery Terms

DE 4/1 Delivery Terms.

Declaration Categories — Field format — No. of occurrences at header level — No. of occurrences at item level

H1, H3, H4, H5, I1 C&F and I1 B&E — Coded version: INCOTERM code: a3 + UN/LOCODE: an..17 OR Free text description: INCOTERM code: a3 + Country code: a2 + Location name: an..35 — 1x — NA

Declaration Category H4:

Delivery terms must be completed for importations to Inward Processing when the declarant opts to use the Article 86 (3) customs debt rules as laid down in EU Reg. No. 952/2013. In such cases Additional Procedure Code F44 should be declared in Data Element (DE) 1/11 and GEN86 completed in DE 2/2 (Additional Information). Please refer to Appendix 1: DE 1/10: Requested and Previous Procedure Codes and Appendix 2A: DE 1/11: Additional Procedure Codes: Union Codes for more details.

Declaration Category I1 C&F:

This data element is only required on a simplified declaration where a claim to a tariff quota is being made on the simplified declaration.

Additional Procedure Code (DE 1/11) Codes E01, E02 or 1SV:

This data element must not be completed for goods which have been entered under Simplified Procedure Value (SPV) or Standard Import Value (SIV). It cannot therefore be used in conjunction with Additional Procedure Code E01, E02 or 1SV in DE 1/11. (See Appendix 2A: DE 1/11: Additional Procedure Codes: Union Codes for details.)

All Declaration Categories:

Delivery terms code must be provided for declarations using valuation method 1 (transaction value of imported goods).

Using the relevant Union codes and headings, specify the terms of the commercial contract.

The code to be declared shall be made up of two components:

- First Component: INCOTERM code

- Second Component: Location up to which the INCOTERMs apply.

Details of the delivery terms which may be used, and their completion instructions may be found in Appendix 7: DE 4/1: Delivery Terms.

First Component: INCOTERM (a3)

Enter the INCOTERM using the appropriate code from Appendix 7.

Second Component: Location name (an..17 coded version or an..37 free text version)

Enter the location up to which the INCOTERMs apply, in the following format:

- UN/LOCODE an..17.

The UN/LOCODE must be used where an appropriate code exists.

A list of GB UN/LOCODES may be found in Appendix 16I: DE 5/23: Goods Location Codes. Codes from Appendix 16I declared in DE 4/1 should be prefaced with the country code GB.

You can check Non-GB UN/LOCODES.

- A plain language description for the location may only be declared in DE 4/1, where no UN/LOCODE exists for the location.

- Where no UN/LOCODE exists, enter the location details in the following format: The appropriate country code (a2) followed by plain text location (an..35). A list of country codes may be found in Appendix 13: Country Codes.

For example:

Using UN/LOCODE:

- CIFGBTIL (Cost Insurance and Freight paid to Tilbury)

- FOBHKKWN (Free on Board at docks in Hong Kong)

Using plain language description:

- CIFGBCanewdon

Notes:

The delivery terms are part of the contractual agreements between seller and buyer. In principle the parties are free to agree whatever they might consider as necessary in order to pursue their commercial interests.

The terms of delivery have to be declared in a customs declaration for release for free circulation in order to allow for the correct determination of the customs value of the imported goods which is also used as the basis for the determination of statistical value/ value for VAT.

In international trade, parties usually base their contractual agreements on the INCOTERMS which are international sales terms, published by the International Chamber of Commerce (ICC). The INCOTERMS which may be used are listed in Appendix 7: DE 4/1: Delivery Terms.

Where the delivery terms agreed between the parties are not covered by one of the 11 codes, the code ‘XXX’ shall be used. When using code ‘XXX’, the data element is to be completed as follows:

- First component: ‘XXX’

- Second component: Country Code (a2) to which the delivery terms apply (for example, freight paid to France) followed by a narrative description of the delivery terms given in the contract. A list of the country codes which may be used can be found in Appendix 13: Country Codes

Where delivery terms are declared in DE 4/1 that require an addition or deduction to the customs value, the corresponding addition or deduction code must be declared in DE 4/9 to prevent the declaration being rejected. For example, delivery terms EXW would require, as a minimum a freight charge to be declared as an addition in DE 4/9.

When using Delivery Term DDP, see DE 4/14 Item Price completion instructions for further guidance.

## DE 4/10 Invoice Currency

DE 4/10 Invoice Currency.

DE 4/10 (invoice currency) is not declared to CDS as a data element in its own right.

Wherever a monetary amount is declared, a currency code must also be provided for that same data element, for example USD500 in DE 4/14 (Item price).

The currency declared must relate to each specific monetary amount being declared.

For example:

- Goods are invoiced in US dollars, the currency declared in DE 4/14 (item price) would therefore be USD

- Freight charges are invoiced in Euros, the currency declared in DE 4/9 for freight costs would therefore be EUR

- Statistical value must be declared in Sterling, therefore the currency declared in DE 8/6 would be GBP

Please refer to Appendix 11: DE 4/10: Currency Codes for the list of codes to be used for each currency accepted by CDS.

## DE 4/11 Total Amount Invoiced

DE 4/11 Total Amount Invoiced.

Declaration Categories — Field format — No. of occurrences at header level — No. of occurrences at item level

H1, H3, H4, H5, I1 C&F and I1 B&E — n..16,2 — 1x — NA

This data element is optional on all GB declarations, other than those using Additional Procedure Code E01, E02 or E03 for which the data element is not permitted.

Additional Procedure Code (DE 1/11) Codes E01, E02 or 1SV:

This data element must not be completed for goods which have been entered under Simplified Procedure Value (SPV) or Standard Import Value (SIV). It cannot therefore be used in conjunction with Additional Procedure Code E01, E02 or 1SV in DE 1/11. (See Appendix 2: DE 1/11: Additional Procedure Codes for details.)

All Declaration Categories:

Completion of this data element is optional and may be left blank.

When this data element is completed, it must correspond to the sum of the item price/ amount for all items (DE 4/14 Item Price/ Amount).

Enter the total invoiced price/ amount for all goods declared in the declaration, expressed in the currency unit declared in DE 4/14 (Item price).

Enter either:

- The total invoice price (or the total adjusted invoice price (see DE 4/14 Item Price/ Amount), or;

- The total customs value of all goods items on the declaration.

Notes:

Wherever a monetary amount is declared, a currency code must also be provided for that same data element, for example USD500 in DE 4/14 (Item price).

The currency declared must relate to each specific monetary amount being declared.

For example:

- Goods are invoiced in US dollars, the currency declared in DE 4/14 (item price) would therefore be USD (if DE 4/11 Total Amount Invoiced is declared then the currency would also have to be USD, because it must always be the same as the currency code in DE 4/14)

- Freight charges are invoiced in Euros, the currency declared in DE 4/9 for freight costs would therefore be EUR

- Statistical value must be declared in Sterling, therefore the currency declared in DE 8/6 would be GBP

Please refer to Appendix 11: DE 4/10: Currency Codes for the list of codes to be used for each currency accepted by CDS.

Any decimal places declared (up to a maximum of 2 places) must be deducted from the total number of characters used in the data element. For example, if 2 decimal places are used, then only 14 whole numbers may be used in front of the decimal place.

CDS converts foreign currency amounts into Sterling using stored rates of exchange. The rate of exchange used for this purpose is the rate in force on the day the declaration is accepted.

Rates of exchange for most foreign currencies used for customs purposes are published by HM Revenue and Customs (HMRC) monthly and apply from midnight on the last day of the month for use during the following month. You can read about rates of exchange to be used for customs purposes, including:

- monthly currency exchange rates

- average currency exchange rates

- spot currency exchange rates

Where the goods are invoiced in multiple currencies, please follow the instructions below.

Multiple Invoice Currencies:

Where the goods have been invoiced in more than one currency, the invoice value must be converted and entered in Sterling (GBP).

Where the goods have been invoiced in more than one currency Document Code ‘9WKS’ must be declared in DE 2/3 (Document Codes). A copy of the worksheet or valuation declaration showing how the conversion was made, must be held and made available to Customs on request.

Fixed Rates of Exchange:

Where a fixed rate of exchange is stipulated in the contract of sale and is being used:

- Enter the fixed rate of exchange used for the currency conversion, for evidence purposes in DE 4/15 (Fixed Rate of Exchange)

- Where declared, enter the Total Invoice Amount (DE 4/11) in Sterling (GBP) and

- The item price/ amount (DE 4/14) in Sterling (GBP).

Where a fixed rate of exchange is applied, Document Code ‘9WKS’ must be declared in DE 2/3 (Document Codes). A copy of the worksheet or valuation declaration showing how the conversion was made, must be held and made available to Customs on request.

Evidence to support the use of fixed rates of exchange must be held and made available to Customs on request.

Delivery Terms DDP (Delivered Duty Paid)

When delivery terms DDP is declared in DE 4/1, any amounts included in the invoice value which represent import duties or other charges payable in the UK for reason of the import or sale of the goods, must be deducted so that these are excluded from the total amount invoiced declared in DE 4/11. Document code 9WKS must be included for the worksheet showing how the declared value has been arrived at.

When DDP is used with consignments which are not anticipated to incur UK import duties but the seller has undertaken to reimburse the buyer for any duties which are charged, no deduction should be made. If duty is charged and the seller reimburses the buyer for this amount, then an application can be submitted for a post clearance adjustment.

## DE 4/14 Item Price/ Amount

DE 4/14 Item Price/ Amount.

Declaration Categories — Field format — No. of occurrences at header level — No. of occurrences at item level

H1, H3, H4, H5, I1 C&F and I1 B&E — n..16,2 — NA — 1x

Declaration Category I1 C&F:

This data element is only required on a simplified declaration where:

- Controlled goods are being entered on a simplified declaration or

- A claim to a tariff quota is being made on the simplified declaration.

Valuation method 4:

This data element must not be completed for goods which have been entered under Simplified Procedure Value (SPV) or Standard Import Value (SIV). It cannot therefore be used in conjunction with Additional Procedure Code E01, E02 or 1SV in DE 1/11. (See Appendix 2A: DE 1/11: Additional Procedure Codes: Union Codes for details).

When the value is to be determined by the selling price after import, or where evidence to support to sale of equivalent goods is not available at the time of import, a provisional value must be declared in DE 4/14 and Additional procedure Code 1FV must be declared in DE 1/11. Document code 9WKS must be declared in DE 2/3 for the worksheet used to calculate the provisional value, which must be based on a realistic estimate of the expected selling price. All charges due will be taken on deposit and will be subject to post-clearance adjustment once the selling price has been established.

When the value is to be determined by the selling price of similar/identical goods, and supporting evidence is available at the time of import, a final value must be declared in DE 4/14 and none of the valuation specific Additional Procedure Codes (E01, E02, 1SV or 1FV) declared in DE 1/11. Document code 9WKS must be declared in DE 2/3 for the worksheet used to calculate the value, and appropriate evidence must be held to prove the details of the previous sale. The value declared in this case will be considered the final value and charges will be collected outright based on this value.

All Declaration Categories:

Enter the item invoice price/amount for the goods described in the relevant DE 6/8 (Description of Goods) and the currency used to invoice the goods.

Please refer to Appendix 11: DE 4/10: Currency Codes for the list of codes to be used for each currency accepted by CDS.

The item price must be the invoice price for each goods item, excluding any additions which need to be declared under DE 4/9, but including any amounts which are to be deducted under DE 4/9.

- Where Valuation the invoice price per item must be adjusted to include any addition or deduction allowable from a purchase price which is not shown in another data element (for example, not included in DE 4/9 (Additions and Deductions).

The item value must be calculated manually and the net amount entered in this data element (evidence to support any addition/ deduction is to be provided on request.

Code 9WKS must be declared in DE 2/3 (Document Codes) to support the valuation calculation.

Customs value

The customs value of goods is defined in Working out the customs value of your imported goods.

It must be declared when:

- The valuation method used to determine the customs value is Method 2, 3, 4 without Additional procedure codes E01, E02, 1SV or 1FV or 5;

- The customs value using Method 4 with Additional Procedure Code 1FV is used for security purposes;

- The declaration is a Simplified Declaration for controlled goods on which a full licensing declaration at the border is required.

When importers or agents/ representatives use their own valuation methods the customs value must also be declared in this data element.

When Additional Procedure Codes (DE 1/11) E01, E02 or 1SV are used this data element must be left blank.

Notes:

Wherever a monetary amount is declared, a currency code must also be provided for that same data element, for example USD500 in DE 4/14 (Item price).

The currency declared must relate to each specific monetary amount being declared.

For example:

- Goods are invoiced in US dollars, the currency declared in DE 4/14 (item price) would therefore be USD (if DE 4/11 Total Amount Invoiced is declared then the currency would also have to be USD, because it must always be the same as the currency code in DE 4/14)

- Freight charges are invoiced in Euros, the currency declared in DE 4/9 for freight costs would therefore be EUR

- Statistical value must be declared in Sterling, therefore the currency declared in DE 8/6 would be GBP

Any decimal places declared (up to a maximum of 2 places) must be deducted from the total number of characters used in the data element. For example, if 2 decimal places are used, then only 14 whole numbers may be used in front of the decimal place.

The sum of the amount filled in for DE 4/14 (Item price/ amount) of all items in a customs declaration must be equal to the total amount filled in for DE 4/11 (Total Amount Invoiced) where declared.

The CDS system will convert any amounts declared in foreign currencies to Sterling, using the rate of exchange current at the time the declaration is accepted by customs. If the current rate is not being used (for example because a fixed rate has been stipulated in the contract for sale of the goods or if the goods have been invoiced in more than one currency (see DE 4/11 Total Amount Invoiced) the amount shown in this data element must be in Sterling.

Multiple Invoice Currencies:

Where the goods have been invoiced in more than one currency, the invoice value must be converted and entered in Sterling (GBP).

Where the goods have been invoiced in more than one currency Document Code ‘9WKS’ must be declared in DE 2/3 (Document Codes). A copy of the worksheet or valuation declaration showing how the conversion was made, must be held and made available to Customs on request.

Fixed Rates of Exchange:

Where a fixed rate of exchange is stipulated in the contract of sale and is being used:

- Enter the fixed rate of exchange used for the currency conversion, for evidence purposes in DE 4/15 (Fixed Rate of Exchange)

- Where declared, enter the Total Invoice Amount (DE 4/11) in Sterling (GBP) and

- The item price/ amount (DE 4/14) in Sterling (GBP).

Where a fixed rate of exchange is applied, Document Code ‘9WKS’ must be declared in DE 2/3 (Document Codes). A copy of the worksheet or valuation declaration showing how the conversion was made, must be held and made available to Customs on request.

Evidence to support the use of fixed rates of exchange must be held and made available to Customs on request.

Delivery Terms DDP (Delivered Duty Paid)

When delivery terms DDP is declared in DE 4/1, any amounts included in the invoice value which represent import duties or other charges payable in the UK for reason of the import or sale of the goods, must be deducted so that these are excluded from the item price declared in DE 4/14. Document code 9WKS must be included for the worksheet showing how the declared item price has been arrived at.

When DDP is used with consignments which are not anticipated to incur UK import duties but the seller has undertaken to reimburse the buyer for any duties which are charged, no deduction should be made. If duty is charged and the seller reimburses the buyer for this amount, then an application can be submitted for a post clearance adjustment.
