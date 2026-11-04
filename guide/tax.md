# Tax returns

Tiny Tally works out your return from the tax codes on your transactions, invoices and bills. Check the figures, then copy them into your tax office's site or send them to your accountant. **Tiny Tally doesn't lodge anything for you.**

Find it in **Reports**. Only your own country's return is shown.

::: tabs
== Australia
**BAS & GST** shows the BAS for a quarter, a month or a year, depending on how you report (set in Settings). Quarterly is Simpler BAS: G1, 1A and 1B. Monthly reporters get the full set of labels.

![A BAS worked out from the demo books](/shots/tax-return.webp)

Fill in wages (W1, W2) and any PAYG instalment (T7) if they apply. Switch between **Cash** and **Accrual** accounting. Add **GST adjustments** for anything that needs one.

**Business schedule** sets out your Profit & Loss by the labels on item P8 of your tax return (business and professional items). Each category maps to a label (new books start mapped; change it on the category). Type your stock on hand if you sell goods, and the hours you worked from home for the fixed rate method. Depreciation comes from the [asset register](./assets).

![The business schedule from the demo books](/shots/income-tax-return.webp)

- **Car trips**: log business trips in km. With **cents per km**, motor vehicle expenses are your km at the ATO rate (up to 5,000 km) and the car's running costs are left out. With a **logbook**, enter the year's total km and your business-use percentage, and it claims that share of the car's costs. Give each trip a vehicle name if you have more than one car: each gets its own 5,000 km, total km and logbook percentage.

![Car trips, each at the year's cents per km](/shots/car-trips.webp)

**PAYG instalments** works out each quarter's instalment, either the amount on the ATO's notice or your instalment rate times the quarter's income before GST, and checks it against the payments in your Income Tax Payment category. The dashboard reminds you as each BAS and instalment comes due.

**Taxable payments (TPAR)**: if you're in building and construction, cleaning, courier or road freight, IT, or security, turn on **On my TPAR** for each contractor (with their ABN). The report totals what you paid each one in the year, with GST, for 28 August. It also flags payments to contractors with no ABN, which may have needed 47% withheld.

**No-ABN withholding**: when a contractor on your TPAR has no ABN, enter their invoice as a bill. Recording the payment fills in **No-ABN tax withheld** at 47%: the bill is paid in full, the whole cost counts, and the 47% goes to a **No-ABN tax withheld** account. It shows at W4 on your BAS (added to 8A) and in the TPAR's tax withheld column.

**PAYG on the BAS**: T7 is filled in from the PAYG instalments page for the quarter. Change it if your instalment notice says something different.

**Due dates** move past weekends and national public holidays (not state ones). If you lodge your quarterly BAS online yourself, turn on **I lodge my BAS online myself** in Settings: quarters 1, 3 and 4 then fall due two weeks later (11 November, 12 May, 11 August), and so do the PAYG instalments paid with them.

**Year-end pack** puts the year together for your tax agent: print it, or save the CSV files into one folder. Assets bought are marked for the instant asset write-off (under $20,000 each) or depreciation.

Not registered for GST? The dashboard warns you as your sales near $75,000 a year.
== New Zealand
**GST return** shows boxes 5 to 15 for your period: 2-monthly, monthly or 6-monthly (set in Settings), on a cash or accrual basis. Add **GST adjustments** for anything that needs one.

**IR10 summary** sets out your Profit & Loss by the IR10 boxes, to go with your IR3. Each category maps to a box (new books start mapped; change it on the category). Type your stock on hand if you sell goods, and your home office area for the square metre method.

- **Vehicle trips**: log business trips in km and pick the fuel. With **kilometre rates**, Tier 1 covers the business share of the first 14,000 km the vehicle travels in the year (enter the year's total km from the odometer) and Tier 2 the rest, and the running costs are left out. With a **logbook**, enter your business-use percentage and it claims that share of the costs. With more than one vehicle, name each on its trips: each has its own 14,000 km, total km, fuel and percentage.

**Tax withheld by clients**: if a client deducts withholding tax from what they pay you (schedular payments), put their rate on the contact. When you record their payment, the tax withheld is filled in: the invoice is paid in full, all of the income counts, and the tax goes to a **Tax withheld by clients** account as a credit for your IR3.

**Provisional tax** works out your three instalments (28 August, 15 January, 7 May) with the standard method, last year's residual income tax plus 5%, or your own estimate, and checks them against the payments in your Income Tax Payment category. It also shows roughly what you'll owe for the year, less tax withheld. The dashboard reminds you as each GST return and instalment comes due. Due dates move past weekends and national public holidays, Matariki and Labour Day included.

**Year-end pack** puts the year together for your accountant: print it, or save the CSV files into one folder. Assets bought are marked as low-value ($1,000 or less, expensed) or to depreciate.

Not registered for GST? The dashboard warns you as your sales near $60,000 a year.
== United States
**Sales tax** totals your taxable and non-taxable sales and the sales tax you collected, for the period you file. There's nothing to lodge or lock.

**Schedule C** fills in Parts I, II and V from your categories, for the last or current tax year. If a category isn't mapped to a line yet, a **Map categories** warning takes you there. When you pick a category's line, each line says what belongs on it.

- **Returns and allowances** (line 2) are the credit notes on your sales.
- **Cost of goods sold** (Part III): map your stock purchases to lines 36 to 39 (new books start with a **Cost of Goods Sold** category), then type your inventory on hand at the start and end of the year. Each year's closing inventory becomes the next year's opening.
- **Other expenses** (line 27) are listed by category in Part V.
- **Car and truck expenses** (line 9): log business trips under **Mileage**. With the standard mileage rate, line 9 is your miles at the IRS rate for the day you drove (plus parking and tolls), and actual car costs are left out. Switch to actual costs on the Mileage page.
- **Business use of home** (line 30): type the square feet you use only for the business, for the simplified method ($5 a square foot, up to 300).

**Estimated tax** works out what to pay each quarter (Form 1040-ES): self-employment tax on your profit, plus income tax at a rate you set. Add last year's tax for the safe harbor. Payments go to the category marked for estimated tax (Income Tax Payment, to start with), and the dashboard reminds you as each due date gets close.

**1099-NEC** lists the vendors you marked as getting a 1099 (on the contact, with their W-9 details) and what you paid them in the year. Payments by credit card are left out, since the card company reports them. It also suggests others you paid enough for services.

**Sales by state** totals your sales into each state against its economic nexus threshold, so you know when you have to register there. It uses the state on each customer. Set your own state in Settings. If you charge different rates, add them in Settings under **Other sales tax rates**: give a customer their usual rate, and the Sales tax report totals each rate separately. A customer with a resale or exemption certificate starts with no sales tax.

**Year-end tax pack** puts the year together for your tax preparer: print it, or save the CSV files into one folder.

The IRS figures these use (the 1099 threshold, mileage rates, the Social Security wage base, due dates) are kept for each tax year. For a year Tiny Tally doesn't have yet, it uses the latest figures and says so. The same goes for the ATO and IRD figures in Australia and New Zealand.

Your own health insurance and retirement plan contributions go on Schedule 1, not Schedule C, so record them in an owner's money category. Equipment is either **Small Equipment** (up to $2,500 an item, expensed as supplies) or **Equipment & Assets**, which stays off the Profit & Loss for your preparer to depreciate.
:::

## India: GST rates

GST in India depends on what you sell, so each invoice line, bill line, product and transaction has its own **GST rate**, starting at 18%. Pick the rate for the item's HSN or SAC code. An invoice can mix rates, and its totals show CGST and SGST, or IGST, for each one. A credit note keeps the rates of the invoice it came from.

The GST summary shows sales, tax and credits at each rate. Food and drink and other purchases you can't claim credit on aren't blocked automatically: use a code that claims nothing, such as *Not reportable*. Check your rates with your CA.

## Canada: GST/HST

The **GST/HST return** shows lines 101 and 103 to 115 for a year, a quarter or a month. Line 103 counts every invoice in the period, paid or not, so there's no cash basis to choose. Line 101 includes zero-rated and exempt sales. Type any adjustments (lines 104 and 107), instalments (110) and rebates (111) that apply to you.

The rate follows the customer's province:

| Where | Tax |
|---|---|
| Alberta, BC, Manitoba, Quebec, Saskatchewan, the territories | GST 5% |
| Ontario | HST 13% |
| New Brunswick, Newfoundland and Labrador, PEI | HST 15% |
| Nova Scotia | HST 14% (15% before 1 April 2025) |

Set the province on the contact, or on the invoice. An invoice can't be approved without one. Bills and transactions start at your own province's rate: change it on the line if the bill shows something else. A credit note keeps the rate of the invoice it came from.

A customer outside Canada starts with no province and a zero-rated line. **Check that's right**: only some services to non-residents are zero-rated, so a line may need tax. A service done wholly outside Canada isn't charged GST/HST at all.

Some things aren't worked out for you:

- **Meals and entertainment**: you can usually claim half the tax. Enter that half as the tax on the transaction.
- **PST, RST and QST** are separate taxes with their own returns. Tiny Tally doesn't track them.
- **The Quick Method** isn't worked out.
- **Income tax**: there's no T2125 or instalment planner.

Tiny Tally doesn't file. Type the figures into GST/HST NETFILE or My Business Account, or send them to your accountant.

## United Kingdom: VAT

The **VAT return** shows the nine boxes for a quarter or a month. Tell Tiny Tally which months your quarters end in, under **Your VAT quarters end in** in Settings: they're on your registration certificate. Boxes 2, 8 and 9 only matter if you move goods between Northern Ireland and the EU. Boxes 6 to 9 are in whole pounds with the pence dropped; Box 5 keeps its pence.

Each invoice line, bill line, product and transaction has its own rate:

| Choose | For |
|---|---|
| VAT at 20% or 5% | Standard and reduced rate |
| Zero-rated | Zero-rated, for example printed books and brochures |
| Exempt or no VAT to reclaim | Exempt, for example most insurance |
| Outside the scope | Sales outside UK VAT, for example some services to customers abroad. Counted in Box 6 |
| Not reportable | Wages, drawings, VAT payments and anything else that stays off the return |

Business entertainment starts as *Exempt or no VAT to reclaim*, so it stays out of Box 4. **Check these defaults with your accountant**: what applies depends on what you sell and who to.

**Making Tax Digital.** VAT returns have to go to HMRC through compatible software unless you're exempt. Typing or copying the figures across doesn't count. Tiny Tally doesn't connect to HMRC. Instead, **Export VAT figures** saves a CSV of the nine boxes, which you import into bridging software to submit, or give to your accountant.

Accrual is the usual basis. Switch to Cash only if you're on HMRC's Cash Accounting Scheme. Reverse charge, the Flat Rate Scheme and partial exemption aren't worked out.

Making Tax Digital for Income Tax is separate, and Tiny Tally doesn't send those updates either. There's no self-assessment return or payments on account planner.

## Drafts, lodging and locking

For a BAS, GST, GST/HST or VAT return:

1. **Save draft** keeps the figures you've entered while you check.
2. After the period has ended, **Mark as lodged…** once you've lodged, filed or submitted it. This locks every transaction and invoice up to the end of the period, so the figures you reported can't change.
3. **Record payment** (or **Record the refund**) when the money moves.

Found a mistake? **Reopen to amend** unlocks it.

**Transactions in this period** lists everything behind the figures, and **History** shows past returns.

::: tip The rules change
Tiny Tally's tax figures are checked against the tax office's published guidance, and each return says when it was last checked. If you're unsure about anything, ask your accountant.
:::
