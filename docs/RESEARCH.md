# Tiny Tally: starting-point research

Goal: a local-first desktop take on the simple end of QuickBooks (roughly
QuickBooks Online *Simple Start*), built on tinyjs + Vue 3 + Octans UI, with
one SQLite file per company.

> **Decision (2026-10-29): single-entry, cash basis first.** Users aren't
> asked to choose. Each `entries` row records its money account *and* its
> category, so a double-entry ledger can be derived later without data loss.
> That will arrive as an optional "Advanced accounting" mode. Section 3 below
> describes that eventual double-entry model; the live v1 schema is in
> `backend/schema.ts`.

---

## 1. What "simple QuickBooks" actually is

QuickBooks Simple Start (the entry tier) gives you: invoicing and payments,
expense tracking and categorisation, bank feeds, sales tax, estimates,
receipt capture, mileage, contractors, and the core reports (P&L, Balance
Sheet, expenses). It notably **leaves out bills / accounts payable**. Bills
arrive in the next tier up.

Everything is built on a **double-entry general ledger**, though the UI
mostly hides it. You never type debits and credits. You fill in an invoice
or an expense, and the app posts the journal lines for you.

### Feature checklist, by tier for us

| Area | MVP (v0.1) | Next (v0.2) | Later / out of scope |
|---|---|---|---|
| **Company** | Name, address, currency, fiscal-year start, logo | Closing date (lock books), multiple companies | Multi-user, audit log UI |
| **Chart of accounts** | Seeded default list, add/edit/archive accounts, account types | Sub-accounts | Classes / locations |
| **Contacts** | Customers, vendors (name, email, address, terms) | Notes, per-contact statement | Employees / payroll |
| **Products & services** | Name, rate, income account, taxable flag | Expense account (for purchases), SKU | Inventory quantity tracking |
| **Sales** | Invoices, receive payment, sales receipts | Estimates → invoice, credit memos, recurring invoices | Online payment links |
| **Expenses** | Expense (paid now, from a bank/card account) | Bills + pay bills (AP), vendor credits | Receipt OCR, mileage |
| **Banking** | Bank and credit-card accounts, register view, transfers | **CSV/OFX import + categorise rules**, reconcile | Live bank feeds (needs Plaid etc.; not local-first) |
| **Sales tax** | Tax rates, tax per invoice line | Sales-tax liability report, record tax payment | Combined/agency rates, auto-calc by address |
| **Accounting** | Journal entries (manual) | Trial balance | Budgets, multicurrency |
| **Reports** | P&L, Balance Sheet, AR aging, General Ledger; date range + **cash/accrual toggle** | AP aging, Sales by customer, Expenses by vendor, CSV export | Custom report builder |
| **Output** | Invoice print / save PDF | Email invoice (mailto or SMTP) | Customisable invoice templates |
| **Dashboard** | Bank balances, income vs expense this period, open/overdue invoices | Charts over time | — |

Notes on the choices:

- **Bank feeds** are QuickBooks' headline feature, but they need an
  aggregator (Plaid, Yodlee) and a server. Locally, CSV/OFX import plus
  "categorise the uncategorised" rules gets about 90% of the value.
- **Cash vs accrual** comes almost free once the ledger is right, and it's
  the toggle small businesses actually use, so it belongs in the MVP reports.
- **Bills/AP** sit in v0.2 to match Simple Start. Most freelancers just record
  expenses when they pay them.

---

## 2. First run and storage

### Flow

```
┌──────────────────────────────────────────────┐
│  Welcome to Tiny Tally                       │
│                                              │
│  ( ) Store in a folder I choose…   [Choose]  │
│      ~/Dropbox/Books                         │
│  (•) Store internally (app data folder)      │
│                                              │
│  Company name  [ Acme Pty Ltd           ]    │
│  Currency      [ AUD ▾ ]  Fiscal year [Jul▾] │
│  Start from    [ Default chart of accounts ▾]│
│                                              │
│        [ Open existing file… ]   [ Create ]  │
└──────────────────────────────────────────────┘
```

- **Choose folder** → `tiny.dialog.pickFolder()`. The DB is created as
  `<folder>/<Company Name>.tally` (a plain SQLite file with a custom
  extension, so it can be double-clicked to open later via
  `fileExtensions: ["tally"]` in tinyjs.json).
- **Store internally** → `(await app.paths()).data + '/companies/<slug>.tally'`.
- **Open existing file** → `tiny.dialog.openFile({ types: ['tally'] })`.
- The app remembers *where the companies are* (not the data) with
  `app.store`: `{ recent: [{ path, name, lastOpened }], lastPath }`. On
  launch it opens `lastPath`. If that file is gone (a drive got unmounted or
  the file moved), it shows the picker with a "can't find …" banner.
- Settings → "Move company file…" and "Back up now" (backup = `VACUUM INTO`
  a timestamped copy).

### SQLite specifics (tinyjs)

- `import { Database } from 'tjs:sqlite'` works **only in the backend**,
  and it's **sync**: no `await`, no `.get()` (use `.all()[0]`), `run()` returns
  void (use `INSERT … RETURNING id`). `tjs.makeDir` *is* async, so await it
  before opening.
- `PRAGMA foreign_keys = ON` on every open.
- **Journal mode:** WAL is faster, but it leaves `-wal`/`-shm` sidecar files.
  In a user-chosen folder that might be Dropbox or iCloud, that's a
  corruption risk. Use `journal_mode = DELETE` for user folders and WAL for
  internal storage.
- **Single-writer lock:** write a `<file>.lock` (hostname + pid + time) on
  open and warn if one exists and is fresh. That stops two machines from
  editing the same synced file.
- A `meta` table holds `schema_version`, so migrations run in order on open.

---

## 3. Data model (double-entry core)

Rules:

- **Money is integer minor units** (cents) everywhere. Never floats.
- Every financial event is a **transaction** with **lines** whose
  debits = credits. Reports only ever read `journal_lines`.
- Documents (invoice, expense, payment…) keep their own human-facing rows,
  and saving one **regenerates** its journal lines in the same SQL
  transaction. Edits and deletes stay consistent that way.
- Rows are archived rather than deleted when anything references them.

```sql
meta(key PK, value)                          -- schema_version, company settings JSON
accounts(id, code, name, type, subtype, parent_id, is_archived, is_system)
  -- type: asset | liability | equity | income | expense
  -- subtype: bank, credit_card, accounts_receivable, accounts_payable,
  --          current_asset, fixed_asset, current_liability, cogs, …
contacts(id, kind /*customer|vendor*/, name, company, email, phone,
         billing_address, terms_days, is_archived)
items(id, name, description, rate, income_account_id, expense_account_id,
      tax_rate_id, is_archived)
tax_rates(id, name, rate_bp /*basis points*/, liability_account_id)

transactions(id, kind, date, number, contact_id, memo, status,
             due_date, created_at, updated_at)
  -- kind: invoice | payment | sales_receipt | expense | bill | bill_payment
  --       | transfer | journal | deposit
doc_lines(id, transaction_id, item_id, description, qty, rate, amount,
          account_id, tax_rate_id, sort)
journal_lines(id, transaction_id, account_id, contact_id, debit, credit, memo)
payment_applications(payment_id, invoice_id, amount)   -- which invoices a payment closes
bank_imports(id, account_id, date, amount, description, fitid, matched_transaction_id)
reconciliations(id, account_id, statement_date, statement_balance, completed_at)
```

Example postings:

| Event | Debit | Credit |
|---|---|---|
| Invoice $110 (incl. $10 tax) | Accounts Receivable 110 | Sales 100, Sales Tax Payable 10 |
| Receive payment | Bank 110 | Accounts Receivable 110 |
| Sales receipt (paid on the spot) | Bank | Sales (+ tax) |
| Expense from card | Expense account | Credit card |
| Transfer | Destination bank | Source bank |

**Cash-basis reports:** income and expense are recognised on the payment
date. They're derived by allocating each payment across the lines of the
invoices it pays (`payment_applications`), so no second ledger is needed.

**Seeded chart of accounts** (sensible small-business default): Checking,
Savings, Undeposited Funds, Accounts Receivable, Accounts Payable, Credit
Card, Sales Tax Payable, Owner's Equity, Owner's Draw, Retained Earnings,
Opening Balance Equity, Sales, Services, Other Income, Cost of Goods Sold,
then the usual expense set (Advertising, Bank Fees, Insurance, Meals,
Office Supplies, Rent, Software, Travel, Utilities, Contractors, Uncategorised
Expense).

---

## 4. UX with Octans UI

Octans is a good fit. It already has the admin-app shell QuickBooks-style UIs
need.

| QuickBooks pattern | Octans piece |
|---|---|
| Left sidebar (Dashboard, Sales, Expenses, Banking, Reports, Accounting) | `AppFrame` + `Navigation` (needs `vue-router`) |
| Global **"+ New"** menu (invoice, expense, payment, customer…) | `Button` + `ActionList` popover in the frame header; also bound to ⌘N |
| List screens (invoices, customers, transactions) | `Page` + `DataTable` / `ResourceList` + `Filters` + `Pagination` |
| Status pills (Draft · Sent · Overdue · Paid) | `Badge` |
| Invoice / expense editor | `Page` + `Card` + `FormLayout`, line items in an editable table, `SaveBar` for unsaved changes |
| Quick-add customer from inside an invoice | `Sheet` |
| Destructive confirm (void / delete) | `$ui.confirm` (Octans modal, not a native dialog) |
| Money / dates in tables | `Formatter`: **format in the page**, since the txiki backend has no `Intl` |
| Dashboard tiles | `StatGroup`, `Card` |
| Report period picker | `DatePicker` (range) + `SegmentedControl` (Cash / Accrual) |
| Saved / error feedback | `$ui.toast`, `Banner` |

Setup notes from the Octans docs:

- Import `@octans/ui/style.css` **and** `@octans/ui/reset.css`, because
  Octans owns the whole window here.
- **Run `octans-icons` before builds.** It's a desktop app, so icons must not
  resolve over the network on first paint.
- Link the Octans agent skill into `.claude/skills/` so future work follows
  its token rules (semantic `--octans-*` tokens only, `UIElement` on
  teleported content).
- Light/dark: `setTheme('system')`.

Desktop niceties tinyjs gives us: native menu (File → New Company / Open /
Back Up / Recent), ⌘-shortcuts, a document-style window title
(`Acme Pty Ltd — Tiny Tally`), and double-click-to-open `.tally` files.

---

## 5. Architecture

```
src/            Vue 3 + Octans (page): routing, forms, formatting, report rendering
src/shared/     types + pure accounting logic (posting rules, totals, tax calc)
backend/        tjs:sqlite access, migrations, company-file lifecycle, api.*
```

- The page calls `tiny.api.call('invoices.save', {...})` and the backend
  validates, writes the doc + journal lines in one `BEGIN … COMMIT`, and
  returns the saved row.
- Posting rules live in `src/shared/`, so they're pure and unit-testable. The
  backend calls them, and the page uses the same code for live invoice totals.
- Reports are SQL aggregates over `journal_lines` in the backend, which
  returns plain numbers. The page formats them.

---

## 6. Build order

1. **Shell + storage:** Octans frame, first-run picker, create/open/recent,
   migrations, seeded chart of accounts, company settings.
2. **Ledger core:** accounts list, journal entries, register view,
   trial-balance sanity check (debits = credits always).
3. **Contacts + items.**
4. **Sales:** invoices (with tax), receive payment, sales receipts, AR aging,
   invoice print to PDF.
5. **Expenses + transfers.**
6. **Reports:** P&L, Balance Sheet, GL with cash/accrual, and the dashboard.
7. **v0.2:** CSV/OFX import + rules, reconcile, bills/AP, estimates, backups.

---

## 7. Open questions

- **Region / sales tax:** US-style sales tax, or GST/VAT (tax-inclusive
  pricing, tax on purchases claimable)? GST/VAT changes the expense posting
  and the tax report.
- **One company per window**, or a company switcher inside one window?
- **Cash or accrual by default** for the dashboard?
- Should the `.tally` file support **attachments** (receipt images as BLOBs),
  or should those sit in a sibling folder?

Sources: [QuickBooks Online Simple Start](https://quickbooks.intuit.com/oa/online/simple-start/),
[Wise: QuickBooks Simple Start review](https://wise.com/us/blog/quickbooks-simple-start),
[Cleverence: Simple Start guide](https://www.cleverence.com/articles/quickbooks/quickbooks-simple-start-a-starter-s-guide/),
[Octans UI docs](https://octans.dev/llms.txt).


## GST, tax invoices and BAS (Australia)

- **Tax codes on every line:** GST (10%), FRE (GST-free), EXP (export, GST-free), INP (input-taxed, e.g. interest), CAP (capital purchase), NTR (not reportable). Categories carry a default code and each transaction can override it.
- **BAS labels:**
  - G1: total sales including GST, GST-free and export.
  - G2: exports.
  - G3: other GST-free sales.
  - G4: input-taxed sales.
  - G10: capital purchases.
  - G11: non-capital purchases.
  - 1A: GST on sales.
  - 1B: GST on purchases.
  - W1, W2 and T7 (wages, withholding, PAYG instalment) are entered by hand.
  - Totals: 8A = 1A + W2 + T7, 8B = 1B, 9 = net.
- **Simpler BAS** (GST turnover under $10M, quarterly) only needs G1, 1A and 1B. Monthly reporting shows the full set.
- **Whole dollars:** BAS amounts are reported with the cents dropped.
- **Lodging:** marking a BAS lodged snapshots its figures and sets a lock date, so the books can't drift from what was lodged. Reopening clears the lock.
- **Tax invoices:** must say "Tax invoice" and show the seller's ABN, the date, item descriptions and the GST. Invoices of $1,000 or more also need the buyer's identity or ABN.

Sources:
- [ATO Simpler BAS bookkeeping guide](https://www.ato.gov.au/Business/Business-activity-statements-(BAS)/Goods-and-services-tax-(GST)/Simpler-BAS-GST-bookkeeping-guide/)
- [ATO software developers: Simpler BAS](https://softwaredevelopers.ato.gov.au/SimplerBAS)
- [ATO monthly GST reporting](https://www.ato.gov.au/business/gst/lodging-your-bas-or-annual-gst-return/options-for-reporting-and-paying-gst/monthly-gst-reporting/)
- [Xero: tax invoice requirements](https://www.xero.com/au/guides/tax-invoice-requirements/)
- [TAC: GST compliance](https://www.tac.vic.gov.au/providers/resources/gst-compliance)

## Getting data out of QuickBooks

- **QuickBooks Desktop .QBW** is a proprietary, encrypted database. Nothing outside Intuit reads it reliably, so we don't try.
- **IIF** (Intuit Interchange Format) is tab-separated text with `!HEADER` rows. Desktop exports lists to it: `!ACCNT` (chart of accounts), `!CUST`, `!VEND`. Transactions come as `!TRNS` / `!SPL` / `!ENDTRNS` blocks, and each block balances to zero. [Intuit: IIF overview](https://quickbooks.intuit.com/learn-support/en-us/help-articles/iif-overview-import-kit-sample-files-and-headers/00/262115)
- **Turning double-entry into single-entry** (`src/lib/import/split.ts`, shared by IIF and QuickBooks Online reports): money moving between two of your own accounts becomes a transfer, paired greedily when several are involved. Every other line becomes an entry on the money side, categorised by its account. When several money accounts pay the same lines, the lines are shared out across them in order. If they're on the same side but the lines go both ways, the transaction is counted and skipped. Blocks with no bank side (invoices, bills, journals) are skipped: on the cash basis, their payments are the income and spending.
- **Non-profit accounts:** QuickBooks equity becomes an "Owner's money" category; loans and other liabilities become "Loan" (or "Tax payment" if the name mentions GST/BAS/tax); assets become "Asset purchase". None of them count on Profit & Loss. Receivables and payables lines (customer and supplier payments) map to Sales and the fallback expense category. Undeposited Funds is imported as a money account, so payments land there and deposits become transfers to the bank.
- **.QBO "Web Connect"** files are OFX bank statements. Banks offer them alongside OFX/QFX. The FITID on each line makes re-imports safe.
- **QuickBooks Online:** Settings → Export data gives a zip of Excel reports and lists. Customers and Suppliers export as CSV directly. [Intuit: export reports, lists and more](https://quickbooks.intuit.com/learn-support/en-ca/manage-lists/export-reports-lists-and-more/00/261915)
- **QuickBooks Online reports** (`src/lib/import/qboReport.ts`), as CSV or Excel. The parser skips the title rows and finds the header row:
  - The **Journal** report has Debit/Credit columns, one row per line. A transaction's first row carries the date. This is the best source.
  - The **Transaction List by Date** has one row per transaction (Account, Split, Amount). Rows whose split is `-Split-` can't be broken down, so they're skipped with a pointer to the Journal.
  - The reports don't give account types, so money accounts are learned from transaction types: the credit on an Expense, the debit on a Deposit, both sides of a Transfer. The account name is the fallback.
- **Excel** (`src/lib/import/xlsx.ts`): just the first sheet. The page unzips it with `DecompressionStream('deflate-raw')` and reads the shared strings. Cells with date formats become YYYY-MM-DD. The backend sends the bytes as base64.
