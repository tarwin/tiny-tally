# Importing and rules

**Import** in the sidebar (or File → **Import…**, or drop a file on the window) brings in:

- bank and card statements: **OFX**, **QBO**, **QFX**, **CSV** and **Excel**
- exports from other software: **IIF** and a **QuickBooks Online** export (.zip)
- lists of customers or suppliers, from CSV

Nothing is saved until you've looked over a preview and confirmed it. If anything goes wrong, nothing is changed.

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

## Rules {#rules}

A rule says *when the description contains this, it's that category* (and optionally, that contact), for money out or money in. For example, "contains Officeworks → Office Supplies".

Rules are made by ticking **Remember** during an import, or by hand with **Add rule** on the Import rules page. Get there with **See rules** after an import, or by searching "rules" with <kbd>⌘K</kbd>.

The newest rule is checked first and the first match wins. Rules also fill in the category when you enter a transaction yourself.
