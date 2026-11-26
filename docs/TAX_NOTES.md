# Tax notes (Kiribati VAT) - NOT legal or tax advice

Written 2026-11-26 from public web search results. The text of the law itself could not be read from this working environment (the site that hosts it is blocked by the network policy), so **nothing below has been checked against the Act**. A Kiribati tax adviser or the Kiribati tax office must confirm it before the invoice wording is relied on.

## What the search results say (secondary sources, unverified)
| Point | What was found | Confidence |
|---|---|---|
| Name of the law | Value Added Tax Act **2013** (applies from 1 January 2014); some government forms say "VAT Act 2014" | medium |
| Standard rate | 12.5% on most goods and services | medium (several sources agree) |
| Registration | A turnover threshold decides who must register; AUD 100,000 is the figure most sources give, set in section 8 of the Act | **low: figure not confirmed against the Act** |
| Tax invoices | The Act defines "invoice" to include a tax invoice and recognises recipient-created tax invoices (section 18(3)); the list of required contents was **not found** | **not verified** |
| Exempt and zero-rated supplies | The Ministry of Finance publishes a list ("Exemption & 0-rated LIST"); contents not read | not verified |
| Rounding | Nothing found | not verified |

Sources: Kiribati VAT Act on PacLII (https://pacliirms.austlii.edu.au/ki/legis/num_act/vata2013132), Ministry of Finance forms (https://www.mfed.gov.ki), vatcalc.com Kiribati pages.

## What this app does today
- Wholesale invoices add 12.5% on the discounted taxable amount, rounded half up once per invoice, with a per-product "tax exempt" flag (`js/invoices.js`).
- Invoices show a number (INV-device-n), date, customer name, optional customer and seller tax numbers, lines, subtotal, discount, tax and total.
- Credit notes (refunds) are separate numbered documents (CN-device-n) that never change the original invoice.
- Retail and Counter receipts show no tax (the shop is assumed not to add VAT on those tills).

## Questions for a tax adviser
1. Is 12.5% right for the shop's goods, and which goods are exempt or zero-rated (so the "tax exempt" flag is set correctly)?
2. Must the shop register for VAT (turnover threshold)? Should Retail receipts show VAT too?
3. What must a tax invoice contain (seller's name, address and tax number, the words "tax invoice", date, description, quantity, tax amount, buyer details above a limit)? Are the current fields enough?
4. What must a credit note contain and how long must records be kept?
5. Is one rounding per invoice correct, and what about cash rounding to 5 cents (a recorded adjustment, never part of the tax)?
6. Do sales to Mwakete Marketplace buyers need different treatment?

Once answers arrive, change `js/invoices.js`, its tests (`tests/invoices.test.js`) and the invoice and credit-note wording together.
