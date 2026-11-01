// Ordered migrations. Index + 1 is the schema_version it produces.
// Never edit a shipped migration — append a new one.
//
// Single-entry model: every money movement is one `entries` row naming the
// money account it hits and the category it belongs to. Both sides are
// recorded, so a double-entry ledger can be derived later without data loss.
// Amounts are integer minor units (cents), always positive; `kind` says which
// way the money went.
export const migrations: string[] = [
  `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('bank', 'credit_card', 'cash')),
    opening_balance INTEGER NOT NULL DEFAULT 0,
    opening_date TEXT NOT NULL,
    is_archived INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
    is_archived INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    UNIQUE (kind, name)
  );

  CREATE TABLE contacts (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('customer', 'vendor')),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    notes TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE entries (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    to_account_id INTEGER REFERENCES accounts(id),
    category_id INTEGER REFERENCES categories(id),
    contact_id INTEGER REFERENCES contacts(id),
    memo TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (
      (kind = 'transfer' AND to_account_id IS NOT NULL AND category_id IS NULL)
      OR (kind <> 'transfer' AND to_account_id IS NULL)
    )
  );
  CREATE INDEX entries_account_date ON entries (account_id, date);
  CREATE INDEX entries_to_account ON entries (to_account_id);
  CREATE INDEX entries_category ON entries (category_id);
  `,
  `
  CREATE INDEX entries_date ON entries (date, id);
  CREATE INDEX entries_contact ON entries (contact_id);
  `,
  // v3: GST, invoices, invoice templates, BAS returns.
  // Invoice payments are income entries with invoice_id set and no category;
  // the ledger views spread each one across its invoice's lines so reports
  // see real categories and GST.
  `
  ALTER TABLE categories ADD COLUMN tax_code TEXT;

  CREATE TABLE invoice_templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    style TEXT NOT NULL DEFAULT 'classic' CHECK (style IN ('classic', 'modern', 'minimal')),
    accent TEXT NOT NULL DEFAULT '#2f6fde',
    logo TEXT,
    title TEXT NOT NULL DEFAULT 'Invoice',
    payment_details TEXT,
    footer TEXT,
    show_tax_column INTEGER NOT NULL DEFAULT 1,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    contact_id INTEGER NOT NULL REFERENCES contacts(id),
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'void')),
    reference TEXT,
    notes TEXT,
    template_id INTEGER REFERENCES invoice_templates(id),
    prices_include_tax INTEGER NOT NULL DEFAULT 1,
    net INTEGER NOT NULL DEFAULT 0,
    tax INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX invoices_contact ON invoices (contact_id);
  CREATE INDEX invoices_issue ON invoices (issue_date);

  CREATE TABLE invoice_lines (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    qty_milli INTEGER NOT NULL DEFAULT 1000,
    unit_price INTEGER NOT NULL DEFAULT 0,
    category_id INTEGER REFERENCES categories(id),
    tax_code TEXT,
    net INTEGER NOT NULL DEFAULT 0,
    tax INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX invoice_lines_invoice ON invoice_lines (invoice_id);

  ALTER TABLE entries ADD COLUMN tax_code TEXT;
  ALTER TABLE entries ADD COLUMN tax_amount INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE entries ADD COLUMN invoice_id INTEGER REFERENCES invoices(id);
  CREATE INDEX entries_invoice ON entries (invoice_id);

  CREATE TABLE bas_returns (
    id INTEGER PRIMARY KEY,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    basis TEXT NOT NULL CHECK (basis IN ('cash', 'accrual')),
    figures TEXT NOT NULL,
    w1 INTEGER NOT NULL DEFAULT 0,
    w2 INTEGER NOT NULL DEFAULT 0,
    t7 INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'lodged')),
    lodged_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (period_start, period_end)
  );

  -- One row per reportable amount. gross is GST-inclusive.
  CREATE VIEW ledger_cash AS
    SELECT e.id AS entry_id, NULL AS invoice_id, e.date, e.kind, e.category_id, e.contact_id,
           e.amount AS gross, e.tax_amount AS tax, e.tax_code, e.memo
    FROM entries e
    WHERE e.kind <> 'transfer' AND e.invoice_id IS NULL
    UNION ALL
    SELECT e.id, i.id, e.date, 'income', l.category_id, i.contact_id,
           CAST(ROUND(1.0 * e.amount * (l.net + l.tax) / i.total) AS INTEGER),
           CAST(ROUND(1.0 * e.amount * l.tax / i.total) AS INTEGER),
           l.tax_code, 'Payment for ' || i.number
    FROM entries e
    JOIN invoices i ON i.id = e.invoice_id
    JOIN invoice_lines l ON l.invoice_id = i.id
    WHERE i.total > 0;

  CREATE VIEW ledger_accrual AS
    SELECT e.id AS entry_id, NULL AS invoice_id, e.date, e.kind, e.category_id, e.contact_id,
           e.amount AS gross, e.tax_amount AS tax, e.tax_code, e.memo
    FROM entries e
    WHERE e.kind <> 'transfer' AND e.invoice_id IS NULL
    UNION ALL
    SELECT NULL, i.id, i.issue_date, 'income', l.category_id, i.contact_id,
           l.net + l.tax, l.tax, l.tax_code, i.number || CASE WHEN l.description <> '' THEN ': ' || l.description ELSE '' END
    FROM invoices i
    JOIN invoice_lines l ON l.invoice_id = i.id
    WHERE i.status = 'sent';

  UPDATE categories SET tax_code = 'GST';
  UPDATE categories SET tax_code = 'INP' WHERE name = 'Interest Income';
  UPDATE categories SET tax_code = 'FRE' WHERE name IN ('Bank Fees', 'Taxes & Licences');
  UPDATE categories SET tax_code = 'CAP' WHERE name = 'Equipment';

  INSERT INTO invoice_templates (name, is_default) VALUES ('Standard', 1);
  `,
  // v4: imports remember where each entry came from, so re-importing skips duplicates.
  `
  ALTER TABLE entries ADD COLUMN import_ref TEXT;
  CREATE UNIQUE INDEX entries_import_ref ON entries(account_id, import_ref) WHERE import_ref IS NOT NULL;
  `,
  // v5: money that isn't profit or loss, bills/quotes/credit notes, bank
  // reconciliation, recurring schedules, import rules.
  //
  // categories.class keeps balance-sheet movements (GST paid to the ATO,
  // owner drawings, loans, asset purchases) out of Profit & Loss.
  //
  // Bills, quotes and credit notes share the invoices table (doc_type) and its
  // lines, payments and templates. Each type numbers itself with its own
  // prefix, so the table-wide UNIQUE(number) still holds; a bill's supplier
  // number goes in `reference`.
  //
  // The ledger views now give each document line its share of a payment by
  // cumulative rounding, so the shares always add up to the payment exactly.
  `
  ALTER TABLE categories ADD COLUMN class TEXT NOT NULL DEFAULT 'pnl'
    CHECK (class IN ('pnl', 'tax', 'owner', 'loan', 'asset'));

  ALTER TABLE invoices ADD COLUMN doc_type TEXT NOT NULL DEFAULT 'invoice'
    CHECK (doc_type IN ('invoice', 'bill', 'quote', 'credit'));
  ALTER TABLE invoices ADD COLUMN source_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL;
  ALTER TABLE invoices ADD COLUMN schedule_id INTEGER;
  CREATE INDEX invoices_type ON invoices (doc_type, issue_date);
  CREATE INDEX invoices_source ON invoices (source_id);

  -- A credit note used against an invoice. No money moves; the invoice owes less.
  CREATE TABLE credit_allocations (
    id INTEGER PRIMARY KEY,
    credit_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX credit_allocations_credit ON credit_allocations (credit_id);
  CREATE INDEX credit_allocations_invoice ON credit_allocations (invoice_id);

  CREATE TABLE reconciliations (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    statement_date TEXT NOT NULL,
    statement_balance INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX reconciliations_account ON reconciliations (account_id, statement_date);
  -- A transfer touches two accounts, so each side is ticked off separately.
  ALTER TABLE entries ADD COLUMN rec_id INTEGER REFERENCES reconciliations(id);
  ALTER TABLE entries ADD COLUMN to_rec_id INTEGER REFERENCES reconciliations(id);

  CREATE TABLE schedules (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('entry', 'invoice', 'bill')),
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly')),
    -- Occurrence n falls on start_date + n periods (so the 31st stays month-end).
    start_date TEXT NOT NULL,
    occurrences INTEGER NOT NULL DEFAULT 0,
    next_date TEXT NOT NULL,
    end_date TEXT,
    auto_approve INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_created TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ALTER TABLE entries ADD COLUMN schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL;

  -- "Description contains X" -> category (and contact). Used by imports and bank feeds.
  CREATE TABLE rules (
    id INTEGER PRIMARY KEY,
    pattern TEXT NOT NULL,
    kind TEXT CHECK (kind IN ('income', 'expense')),
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  DROP VIEW ledger_cash;
  DROP VIEW ledger_accrual;

  -- Document lines with running totals, for exact payment shares.
  CREATE VIEW doc_lines AS
    SELECT l.id AS line_id, l.invoice_id, l.category_id, l.tax_code, l.net, l.tax, l.description,
           d.doc_type, d.status AS doc_status, d.number, d.issue_date, d.contact_id, d.total AS doc_total,
           CASE d.doc_type WHEN 'bill' THEN 'expense' ELSE 'income' END AS kind,
           CASE d.doc_type WHEN 'credit' THEN -1 ELSE 1 END AS sign,
           SUM(l.net + l.tax) OVER w AS cum_gross,
           SUM(l.tax) OVER w AS cum_tax
    FROM invoice_lines l JOIN invoices d ON d.id = l.invoice_id
    WHERE d.doc_type IN ('invoice', 'bill', 'credit')
    WINDOW w AS (PARTITION BY l.invoice_id ORDER BY l.sort, l.id ROWS UNBOUNDED PRECEDING);

  -- One row per reportable amount. gross is GST-inclusive; credit notes are negative.
  CREATE VIEW ledger_cash AS
    SELECT e.id AS entry_id, NULL AS invoice_id, e.date, e.kind, e.category_id, e.contact_id,
           e.amount AS gross, e.tax_amount AS tax, e.tax_code, e.memo
    FROM entries e
    WHERE e.kind <> 'transfer' AND e.invoice_id IS NULL
    UNION ALL
    SELECT e.id, l.invoice_id, e.date, l.kind, l.category_id, l.contact_id,
           l.sign * (CAST(ROUND(1.0 * e.amount * l.cum_gross / l.doc_total) AS INTEGER)
                   - CAST(ROUND(1.0 * e.amount * (l.cum_gross - l.net - l.tax) / l.doc_total) AS INTEGER)),
           l.sign * (CAST(ROUND(1.0 * e.amount * l.cum_tax / l.doc_total) AS INTEGER)
                   - CAST(ROUND(1.0 * e.amount * (l.cum_tax - l.tax) / l.doc_total) AS INTEGER)),
           l.tax_code,
           CASE l.doc_type WHEN 'bill' THEN 'Bill payment ' WHEN 'credit' THEN 'Refund for ' ELSE 'Payment for ' END || l.number
    FROM entries e
    JOIN doc_lines l ON l.invoice_id = e.invoice_id
    WHERE l.doc_total > 0;

  CREATE VIEW ledger_accrual AS
    SELECT e.id AS entry_id, NULL AS invoice_id, e.date, e.kind, e.category_id, e.contact_id,
           e.amount AS gross, e.tax_amount AS tax, e.tax_code, e.memo
    FROM entries e
    WHERE e.kind <> 'transfer' AND e.invoice_id IS NULL
    UNION ALL
    SELECT NULL, l.invoice_id, l.issue_date, l.kind, l.category_id, l.contact_id,
           l.sign * (l.net + l.tax), l.sign * l.tax, l.tax_code,
           l.number || CASE WHEN l.description <> '' THEN ': ' || l.description ELSE '' END
    FROM doc_lines l
    WHERE l.doc_status = 'sent';
  `,

  // v6: editable template wording, details and section layout (JSON, see
  // src/shared/templateLayout.ts). NULL means the defaults.
  `
  ALTER TABLE invoice_templates ADD COLUMN layout TEXT;
  `,

  // v7: manual journal entries (depreciation, accruals, corrections).
  //
  // Each line hits one category, or one of the ledger's own accounts
  // (journal_lines.system: gst, opening, accruals, prepayments, accumdep).
  // Money accounts, receivables and payables are left out on purpose: their
  // balances come from entries and documents, and a journal would put them
  // out of step with registers, reconciliations and aged balances.
  //
  // amount is signed: debit positive, credit negative. Lines total zero.
  // Category lines also reach the P&L through the ledger views, as NTR so
  // they stay off the BAS.
  `
  CREATE TABLE journals (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    reference TEXT,
    memo TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX journals_date ON journals (date, id);

  CREATE TABLE journal_lines (
    id INTEGER PRIMARY KEY,
    journal_id INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL DEFAULT 0,
    category_id INTEGER REFERENCES categories(id),
    system TEXT CHECK (system IN ('gst', 'opening', 'accruals', 'prepayments', 'accumdep')),
    amount INTEGER NOT NULL CHECK (amount <> 0),
    memo TEXT,
    CHECK ((category_id IS NULL) <> (system IS NULL))
  );
  CREATE INDEX journal_lines_journal ON journal_lines (journal_id);
  CREATE INDEX journal_lines_category ON journal_lines (category_id);

  DROP VIEW ledger_cash;
  DROP VIEW ledger_accrual;

  -- Journal lines on categories, signed the way the category's kind grows
  -- (a debit adds to an expense, a credit to income).
  CREATE VIEW journal_amounts AS
    SELECT j.id AS journal_id, j.date, c.kind, c.id AS category_id,
           CASE c.kind WHEN 'expense' THEN l.amount ELSE -l.amount END AS gross,
           COALESCE(l.memo, j.memo, 'Journal entry') AS memo
    FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN categories c ON c.id = l.category_id;

  CREATE VIEW ledger_cash AS
    SELECT e.id AS entry_id, NULL AS invoice_id, e.date, e.kind, e.category_id, e.contact_id,
           e.amount AS gross, e.tax_amount AS tax, e.tax_code, e.memo
    FROM entries e
    WHERE e.kind <> 'transfer' AND e.invoice_id IS NULL
    UNION ALL
    SELECT e.id, l.invoice_id, e.date, l.kind, l.category_id, l.contact_id,
           l.sign * (CAST(ROUND(1.0 * e.amount * l.cum_gross / l.doc_total) AS INTEGER)
                   - CAST(ROUND(1.0 * e.amount * (l.cum_gross - l.net - l.tax) / l.doc_total) AS INTEGER)),
           l.sign * (CAST(ROUND(1.0 * e.amount * l.cum_tax / l.doc_total) AS INTEGER)
                   - CAST(ROUND(1.0 * e.amount * (l.cum_tax - l.tax) / l.doc_total) AS INTEGER)),
           l.tax_code,
           CASE l.doc_type WHEN 'bill' THEN 'Bill payment ' WHEN 'credit' THEN 'Refund for ' ELSE 'Payment for ' END || l.number
    FROM entries e
    JOIN doc_lines l ON l.invoice_id = e.invoice_id
    WHERE l.doc_total > 0
    UNION ALL
    SELECT NULL, NULL, date, kind, category_id, NULL, gross, 0, 'NTR', memo FROM journal_amounts;

  CREATE VIEW ledger_accrual AS
    SELECT e.id AS entry_id, NULL AS invoice_id, e.date, e.kind, e.category_id, e.contact_id,
           e.amount AS gross, e.tax_amount AS tax, e.tax_code, e.memo
    FROM entries e
    WHERE e.kind <> 'transfer' AND e.invoice_id IS NULL
    UNION ALL
    SELECT NULL, l.invoice_id, l.issue_date, l.kind, l.category_id, l.contact_id,
           l.sign * (l.net + l.tax), l.sign * l.tax, l.tax_code,
           l.number || CASE WHEN l.description <> '' THEN ': ' || l.description ELSE '' END
    FROM doc_lines l
    WHERE l.doc_status = 'sent'
    UNION ALL
    SELECT NULL, NULL, date, kind, category_id, NULL, gross, 0, 'NTR', memo FROM journal_amounts;
  `,

  // v8: change log. Triggers (installed on every open by changelog.ts, from
  // the live column lists) record each insert, update and delete as JSON.
  // A batch is one action in the app: an edit, an import, a recurring run.
  // change_context holds the batch the triggers stamp rows with; it's one
  // row, set and cleared around each call (main.ts).
  `
  CREATE TABLE change_batches (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    action TEXT NOT NULL,
    host TEXT,
    summary TEXT,
    count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX change_batches_at ON change_batches (at);

  CREATE TABLE change_log (
    id INTEGER PRIMARY KEY,
    batch_id INTEGER,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    table_name TEXT NOT NULL,
    row_id INTEGER,
    row_key TEXT,
    action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
    before TEXT,
    after TEXT
  );
  CREATE INDEX change_log_batch ON change_log (batch_id);
  CREATE INDEX change_log_row ON change_log (table_name, row_id);

  CREATE TABLE change_context (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    batch_id INTEGER
  );
  INSERT INTO change_context (id, batch_id) VALUES (1, NULL);
  `,
  // v9: trading names. One person, several business names: each invoice,
  // quote and credit note says which one it's from (bills don't). A sent
  // document keeps a copy of the sender's details in from_snapshot, so later
  // edits to a trading name don't rewrite it. Business contact details and
  // payment details moved here from settings and templates.
  `
  CREATE TABLE trading_names (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    logo TEXT,
    address TEXT,
    email TEXT,
    phone TEXT,
    payment_details TEXT,
    template_id INTEGER REFERENCES invoice_templates(id),
    is_default INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ALTER TABLE invoices ADD COLUMN trading_name_id INTEGER REFERENCES trading_names(id);
  ALTER TABLE invoices ADD COLUMN from_snapshot TEXT;
  CREATE INDEX invoices_trading_name ON invoices (trading_name_id);
  ALTER TABLE contacts ADD COLUMN trading_name_id INTEGER REFERENCES trading_names(id);

  -- Books made before this: one trading name from the old business details.
  INSERT INTO trading_names (name, address, email, phone, payment_details, is_default)
    SELECT (SELECT value FROM meta WHERE key = 'books_name'),
           (SELECT value FROM meta WHERE key = 'business_address'),
           (SELECT value FROM meta WHERE key = 'business_email'),
           (SELECT value FROM meta WHERE key = 'business_phone'),
           (SELECT payment_details FROM invoice_templates
            ORDER BY COALESCE(payment_details, '') = '', is_default DESC, id LIMIT 1),
           1
    WHERE EXISTS (SELECT 1 FROM meta WHERE key = 'books_name');
  UPDATE invoices SET trading_name_id = (SELECT id FROM trading_names WHERE is_default = 1)
    WHERE doc_type <> 'bill';
  DELETE FROM meta WHERE key IN ('business_address', 'business_email', 'business_phone');
  -- The change log's triggers name every column; they're rebuilt after migrating.
  DROP TRIGGER IF EXISTS log_invoice_templates_insert;
  DROP TRIGGER IF EXISTS log_invoice_templates_update;
  DROP TRIGGER IF EXISTS log_invoice_templates_delete;
  ALTER TABLE invoice_templates DROP COLUMN payment_details;
  `,
  // v10: US support. Categories map onto a tax form line (Schedule C for
  // the US). The tax rate moves to parts per million, for rates like 8.875%.
  `
  ALTER TABLE categories ADD COLUMN report_line TEXT;
  INSERT OR REPLACE INTO meta (key, value)
    SELECT 'tax_rate_ppm', CAST(value AS INTEGER) * 100 FROM meta WHERE key = 'tax_rate_bp';
  DELETE FROM meta WHERE key = 'tax_rate_bp';
  `,
  // v11: New Zealand. BAS returns become tax returns, shared by the BAS and
  // the NZ GST return; the boxes typed in by hand (W1, W2, T7 or Boxes 9
  // and 13) move into one JSON column. The BAS frequency becomes the tax
  // period.
  `
  CREATE TABLE tax_returns (
    id INTEGER PRIMARY KEY,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    basis TEXT NOT NULL CHECK (basis IN ('cash', 'accrual')),
    figures TEXT NOT NULL,
    inputs TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'lodged')),
    lodged_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (period_start, period_end)
  );
  INSERT INTO tax_returns (id, period_start, period_end, basis, figures, inputs, status, lodged_at, created_at)
    SELECT id, period_start, period_end, basis, figures, json_object('w1', w1, 'w2', w2, 't7', t7), status, lodged_at, created_at
    FROM bas_returns;
  DROP TRIGGER IF EXISTS log_bas_returns_insert;
  DROP TRIGGER IF EXISTS log_bas_returns_update;
  DROP TRIGGER IF EXISTS log_bas_returns_delete;
  DROP TABLE bas_returns;
  UPDATE meta SET key = 'tax_period' WHERE key = 'bas_frequency';
  `,
  // v12: NZ GST adjustments (IR372) behind Boxes 9 and 13, kept with the return.
  `
  ALTER TABLE tax_returns ADD COLUMN adjustments TEXT NOT NULL DEFAULT '[]';
  `,
  // v13: tax rules by year. A return records the rule set it was worked out
  // with. Schedule C categories keep a stable key instead of a line number,
  // since the IRS renumbers lines (2025 moved other expenses to 27b).
  `
  ALTER TABLE tax_returns ADD COLUMN rules TEXT;
  UPDATE categories SET report_line = CASE report_line
    WHEN '1' THEN 'gross-receipts' WHEN '6' THEN 'other-income' WHEN '8' THEN 'advertising'
    WHEN '9' THEN 'car-truck' WHEN '10' THEN 'commissions' WHEN '11' THEN 'contract-labor'
    WHEN '13' THEN 'depreciation' WHEN '14' THEN 'employee-benefits' WHEN '15' THEN 'insurance'
    WHEN '16a' THEN 'mortgage-interest' WHEN '16b' THEN 'other-interest' WHEN '17' THEN 'legal-professional'
    WHEN '18' THEN 'office' WHEN '19' THEN 'pension' WHEN '20a' THEN 'rent-vehicles'
    WHEN '20b' THEN 'rent-property' WHEN '21' THEN 'repairs' WHEN '22' THEN 'supplies'
    WHEN '23' THEN 'taxes-licenses' WHEN '24a' THEN 'travel' WHEN '24b' THEN 'meals'
    WHEN '25' THEN 'utilities' WHEN '26' THEN 'wages' WHEN '27a' THEN 'other-expenses'
    ELSE NULL END
  WHERE report_line IS NOT NULL;
  `,
  // v14: a trading name can number its invoices, quotes and credit notes on
  // its own (prefix + counter). A NULL prefix shares the books' numbering.
  `
  ALTER TABLE trading_names ADD COLUMN invoice_prefix TEXT;
  ALTER TABLE trading_names ADD COLUMN invoice_next INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE trading_names ADD COLUMN quote_prefix TEXT;
  ALTER TABLE trading_names ADD COLUMN quote_next INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE trading_names ADD COLUMN credit_prefix TEXT;
  ALTER TABLE trading_names ADD COLUMN credit_next INTEGER NOT NULL DEFAULT 1;
  `,
  // v15: products and services. A saved line for invoices or bills: the
  // text, price and category it brings. Lines copy what they use, so editing
  // or deleting an item never changes a document.
  `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
    name TEXT NOT NULL,
    description TEXT,
    unit_price INTEGER NOT NULL DEFAULT 0,
    price_includes_tax INTEGER NOT NULL DEFAULT 0,
    category_id INTEGER REFERENCES categories(id),
    tax_code TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // v16: attachments (receipts, supplier invoices) kept inside the books
  // file, so there's still only one file to back up. Each belongs to one
  // transaction or one document and goes when it does.
  `
  CREATE TABLE attachments (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((entry_id IS NULL) <> (invoice_id IS NULL))
  );
  CREATE INDEX attachments_entry ON attachments (entry_id);
  CREATE INDEX attachments_invoice ON attachments (invoice_id);
  `,
  // v17: budgets. An amount per income or expense category per calendar
  // month; reports pro-rate a month by days when a range covers part of it.
  `
  CREATE TABLE budgets (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount >= 0),
    UNIQUE (category_id, month)
  );
  `,
  // v18: sub-categories, one level deep. A parent's reports total include
  // its children; tax returns still map each category on its own.
  `
  ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id);
  CREATE INDEX categories_parent ON categories (parent_id);
  `,
];
