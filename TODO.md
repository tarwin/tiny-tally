# Tiny Tally: TODO

Open work only. Finished items are removed, not ticked.

## Import
Done: IIF, OFX/QBO/QFX, CSV, Excel, and the QuickBooks Online Journal / Transaction List reports. Also done: drag and drop onto the window, CSV column mappings remembered per header row, import rules ("contains X → category", with "Remember" while importing), and multi-account IIF splits.
- [ ] QuickBooks Online's full "Export data" zip (several Excel files): unzip it and pick out the Journal. Today each report has to be exported on its own.
- [ ] Rules only apply during imports. They could also suggest a category when you type a description in the transaction editor.

## Accounting
Done: non-P&L categories (tax, owner, loans, assets), bills, bank reconciliation, recurring transactions/invoices/bills, exact payment allocation, and a derived double-entry view (journal, trial balance, balance sheet).
- [ ] Manual journal entries (depreciation, accruals). The ledger is derived from entries and has nowhere to keep them.
- [ ] Reconciliation could auto-tick lines that match an imported statement (same date and amount).

## Invoices
Done: credit notes (applied to invoices or refunded), quotes that turn into invoices, customer statements.
- [ ] Email sending (it only uses mailto for now; the PDF has to be attached by hand).
- [ ] Supplier statements / remittance advice for bills.

## Polish
- [ ] Octans ships as one prebuilt 480 kB file. It's now its own chunk; it would get smaller only if the library tree-shakes per component.
