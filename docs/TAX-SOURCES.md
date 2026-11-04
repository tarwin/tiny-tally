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
| Online lodgment concession | 2 more weeks for quarterly BAS lodged online: Q1 11 Nov, Q3 12 May, Q4 11 Aug; none for Q2 or monthly (strictly for self-lodgers; agents have their own program) | same ATO page |
| National public holidays | New Year's Day, Australia Day, Good Friday, Easter Monday, Anzac Day, Christmas, Boxing Day; weekend Christmas/Boxing/New Year/Australia Day moved to the next weekdays (as most states do). State holidays not included | [Fair Work: public holidays](https://www.fairwork.gov.au/employment-conditions/public-holidays) |
| No-ABN withholding | 47% (top rate + Medicare levy) on supplies over $75 ex GST, reported at W4 and in the TPAR | [ATO: withholding if ABN not quoted](https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/payg-withholding/payments-you-need-to-withhold-from/payments-to-other-businesses/withholding-if-abn-not-quoted) |
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
| Public holidays | Holidays Act 2003: 1 & 2 Jan, Waitangi Day, Good Friday, Easter Monday, Anzac Day, King's Birthday (1st Mon June), Matariki, Labour Day (4th Mon Oct), Christmas, Boxing Day; Mondayised. Anniversary days not included | [Employment NZ: public holidays](https://www.employment.govt.nz/leave-and-holidays/public-holidays/public-holidays-and-anniversary-dates) |
| Matariki dates 2022–2034 | 24 Jun 22, 14 Jul 23, 28 Jun 24, 20 Jun 25, 10 Jul 26, 25 Jun 27, 14 Jul 28, 6 Jul 29, 21 Jun 30, 11 Jul 31, 2 Jul 32, 24 Jun 33, 7 Jul 34. After 2034 not in the app: add them to src/shared/holidays.ts | [Te Kāhui o Matariki Public Holiday Act 2022, Schedule 1](https://www.legislation.govt.nz/act/public/2022/0014/latest/whole.html); [MBIE](https://www.mbie.govt.nz/business-and-employment/employment-and-skills/employment-legislation-reviews/matariki) |
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

## Depreciation (the asset register)

Added 3 November 2026, from what's in the Acts and the authorities' published
guides. These rules rarely change; the limits are in the year tables above.

| What | Figure / rule | Source |
|---|---|---|
| AU small business pool | 15% the year an asset goes in, 30% a year after; balance under the instant asset write-off threshold at year end (before that year's depreciation) is deducted in full | [ATO: simpler depreciation for small business](https://www.ato.gov.au/businesses-and-organisations/income-deductions-and-concessions/depreciation-and-capital-expenses-and-allowances/simpler-depreciation-for-small-business); ITAA 1997 Subdiv 328-D |
| AU diminishing value / prime cost | DV: base value × days held ÷ 365 × 200% ÷ effective life. PC: cost × days held ÷ 365 × 100% ÷ effective life. Balancing adjustment on disposal | [ATO: general depreciation rules](https://www.ato.gov.au/businesses-and-organisations/income-deductions-and-concessions/depreciation-and-capital-expenses-and-allowances/general-depreciation-rules-capital-allowances); ITAA 1997 Div 40; effective lives in TR 2022/1 |
| NZ DV and SL | IRD's rate for the asset class, × months owned in the year ÷ 12 (the month bought counts); none in the year of disposal; depreciation recovered on sale is income, capped at the depreciation claimed | [IRD: claiming depreciation](https://www.ird.govt.nz/income-tax/income-tax-for-businesses-and-organisations/types-of-business-expenses/depreciation/claiming-depreciation); Income Tax Act 2007 subpart EE |
| US MACRS | Pub 946 Table A-1 (200% DB, half-year): 5-year 20, 32, 19.2, 11.52, 11.52, 5.76%; 7-year 14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46%. Half the year's percentage in the year sold | [IRS Publication 946](https://www.irs.gov/publications/p946) |
| US de minimis safe harbor | $2,500 an item (no applicable financial statement) | [IRS: tangible property regulations FAQ](https://www.irs.gov/businesses/small-businesses-self-employed/tangible-property-final-regulations) |
| US section 179 and bonus | Not limit-checked in the app: section 179's limit is far above a small business's purchases, and 100% bonus depreciation is back for property acquired after 19 January 2025 | [IRS Publication 946](https://www.irs.gov/publications/p946); One Big Beautiful Bill Act (2025) |
| US gain on sale | Form 4797, not Schedule C | [Instructions for Form 4797](https://www.irs.gov/instructions/i4797) |

Simplified: AU pool disposals are treated as a balancing adjustment on the
asset rather than reducing the pool; NZ's Investment Boost isn't applied (add
it to the cost basis by hand); AU low-cost asset pools and US mid-quarter
convention, listed property limits and luxury car caps aren't covered.

## India

Checked 2026-11-04. Tables and rules: `src/shared/india.ts`, `src/shared/taxReturns.ts`
(`IN_GST`). **Have an Indian CA review these before relying on them.** Official
pages were mostly unreachable when this was written, so much of this rests on
reproductions and third parties.

| Figure | Value | Source |
|---|---|---|
| Invoice number | up to 16 characters: letters, digits, `-`, `/`; unique per financial year | [CBIC: Rule 46](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html), seen in search extracts only |
| Invoice contents, export endorsement wording, country of destination | Rule 46, amended to 2023 | [GSTZen's reproduction](https://gstzen.in/a/tax-invoice-cgst-rule-46.html) (third party) |
| Invoice for services within 30 days of supply | Rule 47 | [ClearTax's reproduction](https://cleartax.in/s/cgst-rules-chapter-6-tax-invoice-credit-and-debit-notes) (third party) |
| Rounding tax to the nearest rupee | Section 170 | [CBIC: section 170](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter21/section170_v1.00.html), seen in search extracts only |
| E-invoicing above Rs 5 crore | not built: out of reach for sole traders | [TaxGuru, October 2026](https://taxguru.in/goods-and-service-tax/gst-invoice-october-2026-rs-5-crore-coverage-30-day-irn-reporting-rule.html) (third party) |
| 18% on most services, Rs 20 lakh registration | default rate only | [IncorpX](https://www.incorpx.io/blog/gst-for-freelancers-consultants-india) (third party) |
| TDS on professional fees: 10% over Rs 50,000 a year, on the amount before GST | a suggestion on the customer | [CA Dialogue](https://cadialogue.in/tds-professional-fees-section-393-tax-year-2026/) (third party) |
| State codes, GSTIN check character | | Several third-party lists agree; the GSTIN check was tested on one published sample number |

Not confirmed or not built: section 170 is not applied to invoices (they show
paise); HSN/SAC digit requirements by turnover; one GST rate per set of books;
input tax credit isn't split by head; no reverse-charge purchases, no income
tax return, trips or depreciation for India; statements stay in rupees for
foreign customers.

### GST rates (checked 2026-11-04)

A rate belongs to the goods or service, so Indian books set it per line
(`GST_RATES` in `src/shared/india.ts`).

| What | Value | Source |
|---|---|---|
| Goods rates from 22 Sep 2025 | 5, 18, 40, 3, 0.25, 1.5 and 28%, in Schedules I to VII | Gazette text of Notification 9/2025-Integrated Tax (Rate): the rate paragraph and the entries cited here were read, not all 56 pages: [PDF](https://a2ztaxcorp.net/wp-content/uploads/2025/09/N.-No.-9-2025-Integrated-Tax-Rate.pdf) |
| Gold (7108) 3%, rough diamonds (7102) 0.25%, brochures (4901) 5%, other printed matter (4911) 18% | | Same notification |
| Schedule VII (28%) is only pan masala and tobacco | | Same notification |
| Those goods move to 40% on 1 Feb 2026, except biris at 18%, and compensation cess ends | Press and a practitioner summary, not the gazette | [LiveLaw](https://www.livelaw.in/amp/tax-cases/new-rsp-based-valuation-mechanism-40-gst-rate-on-pan-masala-cigarettes-cigars-tobacco-products-from-february-01-516688), [Free Press Journal](https://www.freepressjournal.in/business/tobacco-products-face-additional-excise-duty-pan-masala-health-cess-from-february-1) |
| Two main slabs (5%, 18%) plus 40% from 22 Sep 2025; 12% isn't among the rates in the notification above | | [PIB: 56th GST Council](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2163555&reg=48&lang=2), from search results; the page refuses automated fetches |
| Tables report HSN and rate together | | [ClearTax: Table 12](https://news.cleartax.in/?p=5941) |
| A credit note keeps the original invoice's rate | Practitioner article, not a CBIC circular | [Tally](https://tallysolutions.com/smart-moves/expert-insights/gst-credit-debit-notes-rate-change-scenarios/) |

Not confirmed, and so not in the list: the services notification
(15/2025-Central Tax (Rate)) wasn't read in full, and the real estate rates (1%,
7.5%) and the 6% and 12% some sources give for construction materials weren't
confirmed. Whether anything is still at 28% today isn't stated outright. 12% and
28% stay on the list, marked older, for documents and credit notes from before
they ended.

Input tax credit isn't blocked automatically: goods with no credit are recorded
with a code that claims nothing. The demo does this for food and drink, from
memory of section 17(5), which wasn't checked here. Ask a CA.
