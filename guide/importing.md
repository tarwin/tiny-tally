# Importing and rules

**Import** in the sidebar (or File → **Import…**, or drop a file on the window) brings in:

- bank and card statements: **OFX**, **QBO**, **QFX**, **CSV** and **Excel**
- exports from other software: **IIF**, a **portable company file** (.QBM) and a **QuickBooks Online** export (.zip)
- lists of customers or suppliers, from CSV

Nothing is saved until you've looked over a preview and confirmed it. If anything goes wrong, nothing is changed.

## QuickBooks Desktop and Reckon Accounts

The easiest way is a **portable company file**: choose **File → Save Copy or Backup → Portable company file**, then import the .QBM. It brings your accounts, categories, contacts, full transaction history, journal entries, and invoices, bills and credit notes with their payments, using the GST recorded on every line. Sub-accounts come in as [sub-categories](./contacts#categories) inside their parent (one level deep, so *Travel:Air:Domestic* is *Air: Domestic* inside *Travel*), and money back on an expense account, such as a supplier's refund, comes in as a [refund](./transactions#refunds) on that expense. Before a file like this goes in, Tiny Tally offers to back up your books first. If books are locked, a portable file won't import until the lock date is cleared, because part of a company's history would leave its balances wrong; a new set of books has no lock. If an account you import into already has an opening balance, set it to zero first, or the history counts twice.

**Tax codes to check**: a portable file's review lists any line whose tax code is for the other side, such as a purchase coded *GST* (a sales code) instead of *NCG*. QuickBooks and Reckon leave those off their BAS, while Tiny Tally counts the GST on them, so the two BAS will differ for those periods. To make them match, fix the codes in QuickBooks or Reckon and import again.

.QBB backups and .QBW company files can't be read: open them in QuickBooks or Reckon and make a portable file instead.

**Lists to IIF Files** exports your accounts, categories and contacts, but no transactions. For those, use the portable file, export the **Journal** report to Excel or CSV and import that too, or import your bank's statement files.

When a file keeps tax on a separate line (IIF and Journal reports) and the amounts don't all fit one rate, the review shows real transactions from it, both ways, so you can pick the reading that matches what happened.

## CSV and Excel files

Tell Tiny Tally *What's in this file?* (bank transactions, customers or suppliers) and which columns hold what: the date (and whether dates are written day, month or year first), the description, and the amount, either in one column or split into *Money out* and *Money in*. **Flip signs** fixes a bank that writes spending as positive.

Tiny Tally remembers the columns for each layout it has seen, so next month's file from the same bank maps itself.

## Review

Before anything is saved, you choose:

- **Accounts**: which of your accounts each one in the file goes into, a new one, or *Don't import*.
- **Categorise**: transactions grouped by payee, so you can categorise a dozen Officeworks lines at once. Tick **Remember** to make a rule.
- **Anything left uncategorised goes to**: a catch-all you can sort out later.
- **Contacts**, and a **Summary** of what will be created.

Importing the same file twice is safe: transactions already brought in are skipped, and the result tells you how many.

An import records every row it brings in, in the books' [history](./your-books-file#history). After a big one, the last screen shows how big the books file is and offers **Make file smaller…**, which moves that history into a separate file beside your books.

### Clean import {#clean-import}

Importing usually adds to what's there. To start again from a QuickBooks or Reckon file instead, say after a trial import, turn on **Clean import** in the Summary. Tiny Tally first clears each list the file brings, such as your transactions, journal entries, invoices and bills, contacts, categories and money accounts, then imports the file's.

- Everything in those lists goes, not just what's in the file. You're asked to back up first.
- An account or category you've matched to one of yours is kept, and so is a category still used by something that stays.
- Settings, templates, numbering, trading names, items, assets and trips stay as they are. Rules and budgets for categories that are cleared go with them.
- It's all one step: if the import fails, nothing is cleared.
- It's only offered for whole-company files (portable company files, IIF and Journal reports), not bank statements.

## Rules {#rules}

A rule says *when the description contains this, it's that category* (and optionally, that contact), for money out or money in. For example, "contains Officeworks → Office Supplies".

Rules are made by ticking **Remember** during an import, or by hand with **Add rule** on the Import rules page. Get there with **See rules** after an import, or by searching "rules" with <kbd>⌘K</kbd>.

The newest rule is checked first and the first match wins. Rules also fill in the category when you enter a transaction yourself.
