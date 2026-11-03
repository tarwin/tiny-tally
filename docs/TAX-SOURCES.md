# Tax figures: where they came from

What each figure in the per-year tables was checked against, and when. Every
link here was read on the date given. When a table is updated (see
RELEASING.md, "Tax figures, once a year"), update this too: change the
figure, the link and the date, and keep notes on anything that couldn't be
confirmed.

Third-party pages are marked as such; an official page is better when one can
be found.

## United States

Checked 2026-11-03. Tables: `src/shared/usTaxYears.ts`,
`src/shared/scheduleC.ts`, `src/shared/usStates.ts`.

| Figure | Value | Source |
|---|---|---|
| Standard mileage rate 2024 | 67¢ | [IRS: standard mileage rates](https://www.irs.gov/tax-professionals/standard-mileage-rates) |
| Standard mileage rate 2025 | 70¢ | [IRS: Instructions for Schedule C (2025)](https://www.irs.gov/instructions/i1040sc) |
| Standard mileage rate 2026, to June 30 | 72.5¢ | [IRS newsroom](https://www.irs.gov/newsroom/irs-sets-2026-business-standard-mileage-rate-at-725-cents-per-mile-up-25-cents) |
| Standard mileage rate 2026, from July 1 | 76¢ | [Internal Revenue Bulletin 2026-29, Announcement 2026-11](https://www.irs.gov/irb/2026-29_irb) |
| Social Security wage base 2026 | $184,500 | [Payroll.org](https://payroll.org/news-resources/news/news-detail/2025/10/24/social-security-wage-base-increases-to-%24184-500-for-2026) (third party, quoting SSA) |
| 1099-NEC threshold | $600 to 2025, $2,000 from 2026, indexed from 2027 | [CPA Practice Advisor](https://cpapracticeadvisor.com/2025/07/30/one-big-beautiful-bill-act-changes-1099-thresholds/165863/), [Patriot Software](https://www.patriotsoftware.com/blog/accounting/1099-reporting-threshold/) (third party, on the One Big Beautiful Bill Act) |
| 1040-ES due dates 2026 | Apr 15, Jun 15, Sep 15, Jan 15 2027 | [Kiplinger](https://www.kiplinger.com/taxes/tax-deadline/602538/when-estimated-tax-payments-due) (third party) |
| Simplified home office | $5 a sq ft, up to 300 sq ft | [IRS: simplified option](https://www.irs.gov/node/10336) |
| Schedule C line numbers (2025: other expenses on 27b) | | [IRS: Instructions for Schedule C](https://www.irs.gov/instructions/i1040sc) |
| State economic nexus thresholds | per state | Each state's own page, linked in `src/shared/usStates.ts` (`source`) |

Not confirmed: some states' own pages contradict themselves on nexus
thresholds (WV, ID, PA, MI and others); the state's own wording was used and
the app tells people to check with the state.

## Australia

Checked 2026-11-03. Tables: `src/shared/auTaxYears.ts`,
`src/shared/incomeReturnLines.ts` (P8), `src/shared/dueDates.ts`. ato.gov.au
refuses some automated fetches; pages were read in full with curl.

| Figure | Value | Source |
|---|---|---|
| Cents per km | 85c (2023-24), 88c (2024-25, 2025-26), 91c (2026-27); 5,000 km a car | [ATO: cents per kilometre method](https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/deductions-you-can-claim/work-related-deductions/cars-transport-and-travel/motor-vehicle-and-car-expenses/expenses-for-a-car-you-own-or-lease/cents-per-kilometre-method) |
| Logbook | 12 continuous weeks, valid 5 years | [ATO: logbook method](https://www.ato.gov.au/businesses-and-organisations/income-deductions-and-concessions/income-and-deductions-for-business/deductions/deductions-for-motor-vehicle-expenses/logbook-method) |
| Working from home, fixed rate | 67c (2022-23, 2023-24), 70c (2024-25, 2025-26); 2026-27 not set | [ATO: fixed rate method](https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/deductions-you-can-claim/work-related-deductions/working-from-home-expenses/fixed-rate-method) |
| Instant asset write-off | under $20,000 an asset, from 1 July 2023, made permanent (Act No. 71 of 2026) | [ATO: now law](https://www.ato.gov.au/about-ato/new-legislation/in-detail/businesses/20000-dollars-instant-asset-write-off), [ATO: instant asset write-off](https://www.ato.gov.au/businesses-and-organisations/income-deductions-and-concessions/depreciation-and-capital-expenses-and-allowances/simpler-depreciation-for-small-business/instant-asset-write-off), [Parliament: the bill](https://www.aph.gov.au/Parliamentary_Business/Bills_Legislation/Bills_Search_Results/Result?bId=r7502) |
| Small business pool | 15% first year, 30% after | [ATO: simpler depreciation](https://www.ato.gov.au/businesses-and-organisations/income-deductions-and-concessions/depreciation-and-capital-expenses-and-allowances/simpler-depreciation-for-small-business) |
| TPAR: industries, due 28 August, 10% test | | [ATO: work out if you need to lodge](https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/reports-and-returns/taxable-payments-annual-report/work-out-if-you-need-to-lodge-a-tpar) |
| TPAR: what's reported per contractor | ABN, name, address, gross paid with GST, GST, tax withheld; whole dollars | [ATO: contractor details](https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/reports-and-returns/taxable-payments-annual-report/lodge-your-tpar/tpar-contractor-details-to-report) |
| No-ABN withholding | 47%, payments over $75 before GST | [ATO: withholding if ABN not provided](https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/payg-withholding/payments-you-need-to-withhold-from/withholding-from-suppliers/withholding-if-abn-not-provided), [ATO: payments you don't withhold from](https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/payg-withholding/payments-you-need-to-withhold-from/withholding-from-suppliers/payments-you-don-t-withhold-from) |
| PAYG instalments: options, instalment income | | [ATO: calculate your PAYG instalments](https://www.ato.gov.au/businesses-and-organisations/income-deductions-and-concessions/payg-instalments/calculate-your-payg-instalments), [instalment income](https://www.ato.gov.au/businesses-and-organisations/income-deductions-and-concessions/payg-instalments/calculate-your-payg-instalments/instalment-income) |
| PAYG due dates | 28 Oct, 28 Feb, 28 Apr, 28 Jul | [ATO: when PAYG instalments are due](https://www.ato.gov.au/businesses-and-organisations/income-deductions-and-concessions/payg-instalments/when-are-payg-instalments-due) |
| BAS due dates | quarterly 28th (Oct–Dec: 28 Feb), monthly 21st, annual 31 Oct; weekends and holidays to the next business day | [ATO: BAS due dates](https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/business-activity-statements-bas/due-dates-for-lodging-and-paying-your-bas) |
| GST registration | $75,000 ($150,000 non-profits), 21 days | [ATO: registering for GST](https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/registering-for-gst) |
| Business schedule, item P8 labels | | [ATO: BPI schedule 2026 instructions](https://www.ato.gov.au/forms-and-instructions/business-and-professional-items-schedule-2026-instructions/instructions-to-complete-the-bpi-schedule-2026) |
| Resident tax rates 2026-27 (16% to 15%) | | [ATO: new tax cuts](https://ato.gov.au/about-ato/new-legislation/in-detail/individuals/personal-income-tax-new-tax-cuts-for-every-australian-taxpayer) |
| Resident tax rates 2024-25, 2025-26 | 0 / 16 / 30 / 37 / 45% at $18,200, $45,000, $135,000, $190,000 | [SuperGuide](https://www.superguide.com.au/how-super-works/income-tax-rates-brackets) (third party); official: [ATO tax rates](https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents) |

Not confirmed: the working from home rate for 2026-27 (the app uses 70c and
says it isn't set); the extra two weeks for lodging online (not used: the
app gives the standard dates); tax agent lodgment program dates; the P8 form
itself (labels are from the instructions, which give no letter for cost of
sales or total business income).

## New Zealand

Checked 2026-11-03. Tables: `src/shared/nzTaxYears.ts`,
`src/shared/incomeReturnLines.ts` (IR10), `src/shared/dueDates.ts`.
legislation.govt.nz refuses some automated fetches; the Income Tax Act 2007
and GST Act 1985 were read in full with curl.

| Figure | Value | Source |
|---|---|---|
| Kilometre rates 2023-24 | Tier 1 $1.04 all; Tier 2 petrol/diesel $0.35, hybrid $0.21, electric $0.12 | [IRD: 2023-2024](https://www.ird.govt.nz/income-tax/income-tax-for-businesses-and-organisations/types-of-business-expenses/claiming-vehicle-expenses/kilometre-rates-2023-2024) |
| Kilometre rates 2024-25 | petrol $1.17/$0.37, diesel $1.26/$0.35, hybrid $0.86/$0.21, electric $1.08/$0.19 | [IRD: 2024-2025](https://www.ird.govt.nz/income-tax/income-tax-for-businesses-and-organisations/types-of-business-expenses/claiming-vehicle-expenses/kilometre-rates-2024-2025) |
| Kilometre rates 2025-26 | petrol $1.20/$0.37, diesel $1.30/$0.38, hybrid $0.90/$0.24, electric $1.22/$0.23 | [IRD: 2025-2026](https://www.ird.govt.nz/income-tax/income-tax-for-businesses-and-organisations/types-of-business-expenses/claiming-vehicle-expenses/kilometre-rates-2025-2026) |
| Kilometre rates 2026-27 | not published; keep using 2025-26's | [IRD news, 8 Jul 2026](https://www.ird.govt.nz/updates/news-folder/2026/2025-2026-kilometre-rate-guidance) |
| Tier 1 | the business share of the first 14,000 km the vehicle travels, private km included | the 2025-2026 page above |
| Logbook, 25% rule | 90 days, 3 years; without one, at most 25% | Income Tax Act 2007 ss DE 4, DE 6–DE 10; [IRD: vehicle expenses](https://www.ird.govt.nz/vehicle-expenses), [IRD: use a logbook](https://www.ird.govt.nz/income-tax/income-tax-for-businesses-and-organisations/types-of-business-expenses/claiming-vehicle-expenses/use-a-logbook) |
| Home office square metre rate | $53.10 (2023-24), $55.60 (2024-25), $57.30 (2025-26) | [IRD: home office](https://www.ird.govt.nz/home-office-expenses), [IRD news, 15 Jun 2026](https://www.ird.govt.nz/updates/news-folder/2026/square-metre-rate-for-home-office-calculations-2026); method in Income Tax Act s DB 18AA |
| Provisional tax: who, standard method | RIT over $5,000; last year +5%, or two years ago +10% | Income Tax Act ss RC 3, RC 5; [IRD: standard option](https://www.ird.govt.nz/income-tax/provisional-tax/provisional-tax-options/standard-option) |
| Provisional tax due dates (31 March balance date) | 28 Aug, 15 Jan, 7 May | [IRD: payment dates](https://www.ird.govt.nz/income-tax/provisional-tax/paying-your-provisional-tax/payment-dates-for-provisional-tax) |
| Interest safe harbour | RIT under $60,000 | [IRD: interest on provisional tax](https://www.ird.govt.nz/income-tax/provisional-tax/interest-on-provisional-tax) |
| Weekends and holidays | next working day | [IRD: when to pay](https://www.ird.govt.nz/managing-my-tax/make-a-payment/when-to-pay) |
| Schedular payments: rates, worked on the amount before GST, IR3 Box 12A | | [IR330C](https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir300---ir399/ir330c/ir330c-2024.pdf), [IR335](https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir300---ir399/ir335/ir335.pdf), [IR3 2026](https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir1---ir99/ir3/ir3-2026.pdf) |
| Low-value assets | $1,000 or less, from 17 March 2021 | Income Tax Act s EE 38(2); [IRD: claiming depreciation](https://www.ird.govt.nz/income-tax/income-tax-for-businesses-and-organisations/types-of-business-expenses/depreciation/claiming-depreciation) |
| Investment Boost | 20% of new assets first used from 22 May 2025 | [IRD: Investment Boost](https://www.ird.govt.nz/income-tax/income-tax-for-businesses-and-organisations/types-of-business-expenses/new-assets---investment-boost), Taxation (Budget Measures) Act 2025 |
| GST registration | $60,000, last or next 12 months; 21 days | [IRD: registering for GST](https://www.ird.govt.nz/gst/registering-for-gst); GST Act 1985 s 51 |
| GST return due dates | 28th of the next month; March 7 May; November 15 January | [IRD: filing GST](https://www.ird.govt.nz/gst/filing-and-paying-gst-and-refunds/filing-gst), [IR375](https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir300---ir399/ir375/ir375.pdf) |
| IR10 box numbers | | [IR10 (March 2026)](https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir1---ir99/ir10/ir10.pdf), [IR10G](https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir1---ir99/ir10g/ir10g-2026.pdf) |
| Individual tax rates from 31 July 2024 | 10.5 / 17.5 / 30 / 33 / 39% at $15,600, $53,500, $78,100, $180,000 | [nztax.tools](https://nztax.tools/tax-insights/2025-26-nz-tax-rate-changes/) (third party; the $180,000 step wasn't confirmed there) |

Not confirmed: the 2026-27 kilometre and home office rates (not out yet; the
app uses 2025-26's and says so); the provisional tax dates for 6-monthly GST
filers (not used); the 2024-25 composite tax rates (the app uses the new
brackets for that year, so its estimate is a little high); the 21-day GST
registration rule is in the Act but not on IRD's current page.
