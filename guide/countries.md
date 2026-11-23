# Countries

The country you choose for your books sets the currency, the tax rules and the reports you get. Each country is at a stage, shown as a tag when you create books or try the demo:

- **Beta**: used with real books, and still being polished.
- **Alpha**: built from the tax office's published guidance, but not yet used to keep real books. Check the figures with your accountant before relying on them.

Tiny Tally never lodges anything for you, at any stage: it works out the figures for you or your accountant to check and file. See [Tax returns](./tax) for how each country's return works.

| Country | Stage | What's included |
|---|---|---|
| Australia | **Beta** | GST and BAS, PAYG instalments, taxable payments (TPAR), no-ABN withholding, car trips, an asset register and the business schedule |
| Canada | Alpha | GST/HST at the rate for each customer's province, with return figures |
| India | Alpha | GST at a rate per line, split into CGST, SGST and IGST, with a GSTR-1 and GSTR-3B summary |
| New Zealand | Alpha | GST returns, the IR10 summary, provisional tax, vehicle trips and an asset register |
| United Kingdom | Alpha | VAT at a rate per line, and the 9-box return to send through bridging software |
| United States | Alpha | Sales tax totals, Schedule C, estimated tax, 1099-NEC, mileage and an asset register |

## Australia: Beta

Australia has been used to keep real books, including books brought across from QuickBooks and Reckon with a [portable company file](./importing#quickbooks-desktop-and-reckon-accounts). The BAS has been checked against the same quarter in Reckon: where the two differed, the difference came down to tax codes in the original file, which the import now points out as **Tax codes to check**.

What's covered:

- **BAS**: Simpler BAS (G1, 1A and 1B), with the full labels (G2, G3, G4, G10, G11) for reference, PAYG withholding (W1, W2, W4) and the PAYG instalment (T7). Cash or accrual, quarterly, monthly or annual. It can be shown laid out like the ATO's statement, to print or save as PDF.
- **Income tax**: the business schedule (item P8), PAYG instalments, car trips (cents per km or logbook), working from home, and an asset register with the instant asset write-off.
- **Contractors**: TPAR and no-ABN withholding at 47%.

Not covered: payroll (Single Touch Payroll), fuel tax credits, wine equalisation tax and luxury car tax, and the full BAS for GST turnover of $10 million or more.

## Canada, India, New Zealand, the United Kingdom and the United States: Alpha

These follow each tax office's published guidance, named on the return page with the date it was checked against, and each has demo books to try. They haven't been used to keep real books yet, so expect rough edges, and check the figures with your accountant before lodging or filing.

- **Canada**: PST and QST aren't tracked, and there are no income tax tools.
- **India**: no income tax tools.
- **United Kingdom**: no self-assessment tools. The VAT figures export for bridging software, since HMRC doesn't accept figures typed in by hand.

If you keep real books in one of these countries, any figure that looks wrong is worth reporting: that's how a country moves to Beta.
