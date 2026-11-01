# Plan: countries, trading names, "Books"

Tiny Tally is for sole traders: one person, one tax ID, several bank
accounts, and possibly several business names. This plan covers four
changes:

1. Call the file **Books**, not "Company", in both the UI and the code.
2. Store the financial year start as a **month and day**, not just a month.
3. Ask for the **country** at setup (Australia, New Zealand, USA). It sets
   the currency, financial year, tax rules, tax report and invoice wording.
4. Let the owner have several **trading names**. Each invoice says which
   one it's from.

Nothing is in real use yet, so there are **no data migrations**. Schema
changes go straight into `backend/schema.ts`. Dev files get recreated.
Write proper upgrade migrations once there are real users.

## 1. "Company" becomes "Books"

Rename it everywhere (about 500 occurrences). Avoid "account" for the file,
because it already means money accounts.

**Code:**

| Now | After |
|---|---|
| `OpenCompany`, `getCompany()`, `hasCompany()` | `OpenBooks`, `getBooks()`, `hasBooks()` |
| `openCompany`, `createCompany`, `closeCompany`, `backupCompany` | `openBooks`, `createBooks`, `closeBooks`, `backupBooks` |
| `CompanySettings`, `CompanySetup`, `seedCompany` | `BooksSettings`, `BooksSetup`, `seedBooks` |
| `src/lib/company.ts` (`openCompanyAt`, `pickAndOpenCompany`) | `src/lib/books.ts` (`openBooksAt`, `pickAndOpenBooks`) |
| `session.company`, the `company` computed in views | `session.books`, `books` |
| `Company` type in `src/lib/api.ts` | `Books` |
| API names like `company.create` | `books.create` |
| meta `company_name`, `company_logo` | `books_name`, `books_logo` |
| CSS like `.Doc__company` | `.Doc__from` (it shows the trading name now) |

The `.tally` extension stays.

**UI:** Welcome ("Create books", "Open existing books…", "Try demo books
with sample data", "Where should your books live?"), menus, the window
title, Open Recent, the lock dialog ("These books are open on …"), and
errors in `backend/db.ts` ("No books are open.", "Books already exist at
…").

Settings gets a **You** section: your legal name and tax ID. Trading names
are listed under it (section 4).

Do the rename as its own commit, before anything else, and make it change
no behaviour.

## 2. Financial year start as month and day

`fiscal_year_start` becomes `'MM-DD'` (`'07-01'`, `'04-01'`, `'01-01'`). The
day is limited to 1–28, so every year has that date, including February.

The places that use it now and assume the first of the month:

- `src/lib/periods.ts`: `periodRange` ("this year" / "last year") and
  `taxPeriods`. Monthly and quarterly tax periods count from the year
  start date, so a 6 April start gives 6 Apr–5 May, and so on.
- `src/views/BalanceSheet.vue`: `yearStart()`.
- `src/views/Reports.vue`, `ProfitLoss.vue`, `Transactions.vue`,
  `Register.vue`, `Bas.vue`: pass the new value through.
- `backend/settings.ts` (`int(1, 1, 12)` becomes an `MM-DD` field),
  `backend/seed.ts`, `backend/main.ts` (`books.create`).
- Settings and Welcome: a month select plus a day field (default 1),
  filled in from the country.

Year labels: if the year starts 1 January, the label is the calendar year
("2026"). Otherwise it's "FY27" for the year that ends in 2027, as now.

Add a short test file for `periods.ts`, since there are no tests yet. Cover
1 Jan, 1 Jul, 1 Apr and 6 Apr starts, and the days either side of each
boundary.

## 3. Country profiles

### Profile

Add `src/shared/countries.ts`. Like `tax.ts`, it ships to both the backend
and the page, so no `tjs:*` imports and no `Intl`.

```ts
type Country = 'AU' | 'NZ' | 'US';

interface CountryProfile {
  code: Country;
  name: string;
  currency: string;              // AUD / NZD / USD
  fiscalYearStart: string;       // '07-01' / '04-01' / '01-01'
  dateOrder: 'dmy' | 'mdy';      // for imports
  taxIdLabel: string;            // 'ABN' / 'GST number' / 'EIN'
  validateTaxId(v: string): string | null;
  tax: {
    name: string;                // 'GST' / 'GST' / 'Sales tax'
    defaultRateBp: number;       // 1000 / 1500 / 0
    rateEditable: boolean;       // false / false / true
    pricesIncludeTax: boolean;   // default: true / true / false
    claimableOnPurchases: boolean; // true / true / false
    codes: TaxCodeInfo[];
    periods: ('monthly' | 'two-monthly' | 'quarterly' | 'six-monthly' | 'annual')[];
    report: 'bas' | 'nz-gst' | 'us-sales-tax';
  };
  invoiceTitle(taxRegistered: boolean): string; // 'Tax invoice' / 'Invoice'
  categories: { income: SeedCategory[]; expense: SeedCategory[] };
}
```

The books store `country` in `meta`. Country and currency are fixed when
the books are made (Settings shows them read-only). The profile lives in
`src/shared/countries.ts`; NZ and US have `tax: null` until steps 5 and 6.

### Replacing the AUD checks

Everything that checks `currency === 'AUD'` should look up the profile
instead:

- `src/views/Welcome.vue` (`isAud`, the financial year watcher, the GST and
  ABN fields)
- `backend/seed.ts` (the `tax_enabled` default, category tax codes)
- `backend/main.ts` demo books: make them `country: 'AU'`
- `src/lib/import/parse.ts` (`DAY_FIRST`): use `profile.dateOrder` and keep
  the currency set as the fallback
- `src/views/Settings.vue`, `src/views/Templates.vue`: the ABN label and
  validation, the "Registered for GST" wording, the BAS frequency options
- `src/shared/tax.ts`: `taxFromInclusive` / `lineTotals` already take a
  rate. Look up codes from the profile instead of the AU-only `TAX_CODES`,
  and widen `TaxCode` to a string checked against the profile.
- The `invoice_templates.title` default `'Tax Invoice'` and the fallback in
  `backend/invoices.ts`: use `profile.invoiceTitle()`.

### Setup

The first field is the country, with no default: the webview's locale is
often en-US even in Australia, and the country decides the tax rules. Picking it fills in the currency,
year start, tax toggle wording ("Registered for GST" or "Collect sales
tax") and the tax ID field. Currency is read-only and shows the country's
currency.

### Australia

No change in behaviour. The current codes (GST, FRE, EXP, CAP, INP, NTR),
the BAS and the "Tax invoice" title move into the AU profile. Check the
demo books by hand before and after: the BAS figures and P&L should come
out the same.

### New Zealand

- NZD, year starts 1 April, day-first dates.
- GST at 15%, prices include tax by default, claimable on purchases.
- Codes: GST (15%), ZER (zero-rated: exports), EXE (exempt: financial
  services, residential rent), NTR (not reportable).
- Return periods: monthly, two-monthly, six-monthly.
- Tax ID: GST number (the IRD number, 8–9 digits with a check digit).
- Report: a GST return in the shape of the IRD form. It reuses the
  lodge-and-lock flow from `Bas.vue` (`bas_returns`, `lockDate`).
  **Check the box numbers and their rules against current IRD guidance
  before building. Don't work them out from the BAS.**
- Invoice title: "Tax invoice" when GST registered.

Splitting `Bas.vue` into a shared return shell plus a per-country figures
panel is the main refactor here. Rename `bas_returns` to `tax_returns` and
`bas_frequency` to `tax_period` while the schema is still open.

### USA (simplest version)

- USD, year starts 1 January, month-first dates.
- **Sales tax: off, or one flat rate the user enters.** Prices exclude tax
  by default. Sales tax on purchases isn't claimable, so expense entries
  carry no tax amount. The tax is part of the cost.
- Codes: TAX (charged at the flat rate), NON (not taxable), NTR.
- Report: **Sales tax collected** for a period (taxable sales, non-taxable
  sales, tax collected). No lodging, no lock.
- Tax ID: EIN, optional, format `XX-XXXXXXX`. Never ask for or print an
  SSN.
- Invoice title: "Invoice".
- **Schedule C.** Add a `report_line` column to categories, and seed the US
  categories already mapped:

  | Category | Line |
  |---|---|
  | Sales, Services | 1 Gross receipts |
  | Other Income, Interest Income | 6 Other income |
  | Advertising & Marketing | 8 Advertising |
  | Car & Truck | 9 Car and truck expenses |
  | Contractors | 11 Contract labor |
  | Insurance | 15 Insurance |
  | Professional Fees | 17 Legal and professional services |
  | Office Supplies, Software & Subscriptions | 18 Office expense |
  | Rent | 20b Rent: other business property |
  | Supplies | 22 Supplies |
  | Taxes & Licences | 23 Taxes and licenses |
  | Travel | 24a Travel |
  | Meals & Entertainment | 24b Deductible meals (shows the 50%) |
  | Utilities | 25 Utilities |
  | Bank Fees, Equipment, Uncategorised Expense | 27a Other expenses |

  A **Schedule C summary** report groups the P&L by line for the tax year,
  and categories with no line get a "not mapped" warning. Equipment is
  shown under 27a with a note that depreciation and section 179 are worked
  out separately. Estimated quarterly tax is out of scope.

### NZ as built

- Checked against IRD's guide IR375 (March 2026) and the GST101A layout:
  Box 5 is all sales including GST and zero-rated sales; Box 6 the
  zero-rated part; Boxes 8 and 12 are 3/23 of Boxes 7 and 11; Box 11
  excludes imported goods; exempt supplies are left off the return.
  Boxes 9 and 13 (adjustments, GST paid to Customs) are typed in.
- Only GST-coded purchases go in Box 11. Zero-rated, exempt and
  not-reportable purchases have no GST to claim, so they stay out.
- NZ amounts stay in dollars and cents; the BAS still drops cents.
- `bas_returns` is now `tax_returns`, with the hand-typed boxes in a JSON
  `inputs` column. `bas_frequency` is now `tax_period`, with 2-monthly and
  6-monthly added. NZ books start on 2-monthly, IRD's default.
- The box layouts live in `src/shared/taxReturns.ts` as data, and
  `TaxReturn.vue` shows either form. There's no separate figures panel
  component.
- Odd or even 2-monthly periods aren't offered: periods always start with
  the financial year.
- "Tax invoice" isn't required since April 2023 (taxable supply
  information), but it's kept as the default title.

### US as built

- The tax rate is stored in parts per million (`tax_rate_ppm`), not basis
  points, so rates like 8.875% fit. Australia's 10% is 100000.
- US purchases use NTR only: no tax amount, and the tax code picker and
  "inc./ex. tax" switch are hidden on expenses and bills.
- A "Sales Tax Payment" category is seeded so paying the state clears the
  "Sales tax payable" account.
- "Car & Truck" and "Supplies" are extra US expense categories, as in the
  table above.
- The sales tax filing frequency reuses `bas_frequency` until NZ renames it
  to `tax_period`.
- Sales tax is off by default for new US books (most sole traders sell
  services); turning it on asks for the rate.

## 4. Trading names

### Schema

```sql
CREATE TABLE trading_names (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  logo TEXT,
  address TEXT,
  email TEXT,
  phone TEXT,
  payment_details TEXT,      -- bank details printed on invoices
  pay_into_account_id INTEGER REFERENCES accounts(id),
  template_id INTEGER REFERENCES invoice_templates(id),
  is_default INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- invoices:  trading_name_id INTEGER NOT NULL REFERENCES trading_names(id)
--            from_snapshot TEXT   -- JSON, set when sent
-- contacts:  trading_name_id INTEGER REFERENCES trading_names(id)
-- schedules: trading_name_id INTEGER REFERENCES trading_names(id)
```

Seeding creates one default trading name from the name entered at setup.
The `business_address`, `business_email` and `business_phone` meta keys
are removed, since they now live on the trading name. `books_name` is the
owner's legal name.

The change log triggers are built from live column lists
(`changelog.ts`), so the new table and columns should be picked up
automatically. Check this by hand: edit a trading name and look at
Activity.

### As built

- `pay_into_account_id` was left out: the payment details text carries the
  bank details. Add it if payments should default to that account.
- Bills have no trading name (`trading_name_id` is null on them).
- The snapshot leaves out the logo (a data URL per invoice is too big), so
  old documents show the trading name's current logo.
- The "Legal name t/as Trading name" line isn't built yet. Every template
  show option defaults to on, so it needs a default-off option first.
- Existing files are migrated: one trading name from the old business
  details and the template that had payment details.

### Trading names and templates

`invoice_templates` already has `logo` and `payment_details`. Who someone
is belongs to the trading name, and how the document looks belongs to the
template. Move `payment_details` to the trading name and drop it from
templates. Keep the template logo as an optional override (empty means
the trading name's logo is used).

### Rules

- A new invoice or quote uses the customer's trading name, or the default
  one if the customer has none.
- A quote turned into an invoice keeps its trading name. A credit note uses
  the trading name of the invoice it's applied to.
- Recurring schedules store the trading name they were made with.
- **Statements:** one statement per trading name. A customer with invoices
  under two names gets two statements, or picks one.
- **Snapshot:** when a document is marked sent, its name, address, contact
  and payment details are saved in `from_snapshot`. Sent documents render
  from the snapshot, so later edits to a trading name don't rewrite old
  invoices. Drafts render the live details.
- Remittance advice (bill payments) uses the default trading name.
- Numbering stays one shared sequence.
- Archiving a trading name hides it from new documents. Deleting is only
  allowed when nothing uses it.

### UI

- Settings → You: legal name, tax ID, and a list of trading names
  (add, edit, archive, set default).
- Invoice editor: a "From" select. Hidden when there's only one trading
  name.
- Customer editor: "Invoice as" default.
- `InvoiceDocument.vue`: read the sender from the snapshot or the trading
  name instead of `company.name` / `company.business*`, with an optional
  "Legal name t/as Trading name" line.
- Demo books: add a second trading name and a few invoices under it.

## Order of work

1. **Books rename** (code and UI). A commit of its own.
2. **Financial year as month and day**, plus `periods.ts` tests.
3. **Country profile + AU.** The profile, setup and settings, the AUD
   checks replaced. AU behaviour stays exactly the same.
4. **Trading names.**
5. **USA.** Profile, flat or no sales tax, exclusive pricing,
   `report_line` + seeded categories, the sales tax and Schedule C
   reports.
6. **New Zealand.** Profile, codes, the GST return built on the shared
   return shell.

Each step leaves the app building (`pnpm build`) and the demo books
working.

## 7. Tax rules by year

Forms, line numbers and rates change, so the app shouldn't quietly apply
today's rules to every period.

- `RETURN_RULES` (taxReturns.ts) holds dated rule sets per return: a name
  ("GST101A (April 2023)"), the guidance it was checked against, `from`
  (periods ending on or after) and `checkedUntil`. Each owns its form, so a
  changed form is a new rule set and old returns keep theirs.
- `tax_returns.rules` (v13) records the rule set a return was worked out with;
  history and lodged returns use it.
- A period past `checkedUntil` (or before the first rule set) shows a warning.
  Lodging it needs an explicit "I've checked them"; the backend refuses
  without `acknowledged`. Not a hard block: rules usually don't change.
- Schedule C: categories keep a stable key ('other-expenses'), and
  `SCHEDULE_C_YEARS` numbers the keys per tax year. 2025 moved other
  expenses to 27b (27a is now the energy efficient buildings deduction).
- The BAS is always Simpler BAS (G1, 1A, 1B): the ATO default for GST
  turnover under $10 million at any frequency. Monthly no longer adds the
  full labels.
- RELEASING.md step 0: re-check guidance and move `checkedUntil` on.

## Out of scope for now

- Upgrade migrations for existing files.
- US sales tax by state, county or address, and filing.
- US estimated quarterly tax, 1099s, depreciation.
- Other countries, multi-currency invoices.
- 52–53 week financial years.
- Separate number sequences per trading name.
- Profit & Loss by trading name.
