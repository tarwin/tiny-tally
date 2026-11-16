# Templates and trading names

## Invoice templates

**Templates** on the Invoices page designs how your invoices, quotes, credit notes and statements look. The preview updates as you go, and clicking any part of it takes you to the field that sets it.

![Designing an invoice template](/shots/templates.webp)

::: tabs
== Style
Choose **Classic**, **Modern** or **Minimal**, an **Accent colour** and a **Logo**. You can also change the **Document title** (*Tax Invoice*, say), add a **Footer**, and choose whether to **Show GST on each line**.
== Wording
Set the **Intro text**, choose which fields appear, and rename labels to suit you.

**Your details layout** arranges your details at the top of the page. Leave it blank for the standard layout: your business name, then your name in bold with your post-nominals beside it, your address, phone, email, website and tax ID, each on its own line. To lay them out yourself, use `{business}`, `{name}`, `{postnominals}`, `{address}`, `{phone}`, `{email}`, `{website}` and `{tax_id}`, and put `**double asterisks**` around anything you want in bold:

```
**{name}** {postnominals}
{business}
{phone} · {email}
```

The first line prints larger. A line whose details are all empty is left out, so nothing leaves a gap. Your tax ID is added at the end if a tax invoice needs it and your layout leaves it out.
== Layout
Change the order, size and alignment of each part of the page, and pin parts to the bottom. **Reset order and sizes** puts it back.
== Details
Your business name, your own name and post-nominals, address, phone, email, website and payment details, as they appear on every template. They belong to your default trading name, so if you have several, edit the others in **Settings → Trading names**. Documents already sent keep the details they went out with.
:::

New Australian books start with the title *Tax Invoice*, which a GST-registered business has to use. If your books aren't registered for GST, documents print *Invoice* instead.

Have as many templates as you like. **Make default** sets the one new documents use; each invoice can pick another.

## Trading names {#trading-names}

If you invoice under more than one name, add each one in **Settings → Trading names**: its name, your name and post-nominals, address, phone, email, website, payment details, logo and template. Tick **Number its documents separately** if it needs its own invoice numbers.

When you make an invoice, **From** picks the trading name. A contact can be set to always be **invoiced as** one of them.

## Numbering

**Settings → Invoices** sets the prefix and next number for invoices, quotes, credit notes and bills.
