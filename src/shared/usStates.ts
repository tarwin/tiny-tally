// US states (and DC) for customer addresses, sales tax rates and the
// economic nexus check. A remote seller has to register for a state's sales
// tax once sales into it pass its threshold. Thresholds change: each entry
// says where it was checked, and NEXUS_CHECKED says when. Re-check them each
// year against the state's own page (source). States with no sales tax have
// sales 0; Alaska has only local taxes, through the ARSSTC.

export interface UsState {
  code: string;
  name: string;
  /** Economic nexus: sales in whole dollars, or 0 where there's no statewide sales tax. */
  sales: number;
  /** A transaction count that also creates nexus, or null. */
  transactions: number | null;
  /** Both tests must be met (CT, NY), rather than either. */
  both: boolean;
  /** The period the threshold is measured over. */
  measured: string;
  source: string;
  /** What else to know: which sales count, recent changes. */
  note?: string;
}

export const NEXUS_CHECKED = '2026-11-03';

export const US_STATES: UsState[] = [
  { code: 'AL', name: 'Alabama', sales: 250_000, transactions: null, both: false, measured: 'previous calendar year', source: 'https://www.revenue.alabama.gov/wp-content/uploads/2021/12/810-6-2-.90.03.pdf', note: 'Counts retail sales' },
  { code: 'AK', name: 'Alaska', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://arsstc.org/business-sellers/', note: 'Local sales taxes only, through the ARSSTC' },
  { code: 'AZ', name: 'Arizona', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://azdor.gov/business/transaction-privilege-tax/retail-sales-subject-tpt/out-state-sellers/economic-threshold' },
  { code: 'AR', name: 'Arkansas', sales: 100_000, transactions: 200, both: false, measured: 'previous or current calendar year', source: 'https://www.dfa.arkansas.gov/office/taxes/excise-tax-administration/sales-use-tax/remote-sellers/' },
  { code: 'CA', name: 'California', sales: 500_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://www.cdtfa.ca.gov/industry/wayfair.htm' },
  { code: 'CO', name: 'Colorado', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://tax.colorado.gov/out-of-state-businesses' },
  { code: 'CT', name: 'Connecticut', sales: 100_000, transactions: 200, both: true, measured: '12 months to the previous September 30', source: 'https://portal.ct.gov/DRS/Nexus/Sales-and-Use-Taxes---Nexus' },
  { code: 'DE', name: 'Delaware', sales: 0, transactions: null, both: false, measured: '', source: 'https://revenue.delaware.gov/', note: 'No sales tax' },
  { code: 'DC', name: 'District of Columbia', sales: 100_000, transactions: 200, both: false, measured: 'previous or current calendar year', source: 'https://otr.cfo.dc.gov/page/sales-and-use-tax-faqs' },
  { code: 'FL', name: 'Florida', sales: 100_000, transactions: null, both: false, measured: 'previous calendar year', source: 'https://floridarevenue.com/taxes/taxesfees/Pages/sales_tax.aspx', note: 'Counts taxable sales' },
  { code: 'GA', name: 'Georgia', sales: 100_000, transactions: 200, both: false, measured: 'previous or current calendar year', source: 'https://dor.georgia.gov/taxes/sales-use-tax/out-state-sellers' },
  { code: 'HI', name: 'Hawaii', sales: 100_000, transactions: 200, both: false, measured: 'previous or current calendar year', source: 'https://tax.hawaii.gov/geninfo/get/', note: 'General excise tax' },
  { code: 'ID', name: 'Idaho', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://tax.idaho.gov/taxes/sales-use/guides-for-certain-groups/online-sellers/online-guide/' },
  { code: 'IL', name: 'Illinois', sales: 100_000, transactions: null, both: false, measured: 'previous 12 months, checked each quarter', source: 'https://tax.illinois.gov/research/publications/bulletins/fy-2026-12.html', note: 'Transaction test dropped 2026-01-01' },
  { code: 'IN', name: 'Indiana', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://www.in.gov/dor/i-am-a/business-corp/business-faq/remote-seller-faqs/' },
  { code: 'IA', name: 'Iowa', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://revenue.iowa.gov/taxes/tax-guidance/sales-use-excise-tax/remote-sellers-marketplace-facilitators' },
  { code: 'KS', name: 'Kansas', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://www.ksrevenue.gov/taxnotices/notice21-17.pdf' },
  { code: 'KY', name: 'Kentucky', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://apps.legislature.ky.gov/law/acts/26RS/documents/0161.pdf', note: 'Transaction test dropped 2026-08-01' },
  { code: 'LA', name: 'Louisiana', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://legis.la.gov/legis/ViewDocument.aspx?d=1328128' },
  { code: 'ME', name: 'Maine', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://www.maine.gov/revenue/taxes/sales-use-service-provider-tax/guidance-documents/remote-sellers' },
  { code: 'MD', name: 'Maryland', sales: 100_000, transactions: 200, both: false, measured: 'previous or current calendar year', source: 'https://www.marylandtaxes.gov/faq/sales-use.php' },
  { code: 'MA', name: 'Massachusetts', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://www.mass.gov/info-details/remote-seller-and-marketplace-facilitator-faqs' },
  { code: 'MI', name: 'Michigan', sales: 100_000, transactions: 200, both: false, measured: 'previous calendar year', source: 'https://www.michigan.gov/taxes/business-taxes/sales-use-tax/information/remote-seller-faq' },
  { code: 'MN', name: 'Minnesota', sales: 100_000, transactions: 200, both: false, measured: 'previous 12 months, checked each quarter', source: 'https://www.revenue.state.mn.us/sales-tax-faqs-remote-sellers' },
  { code: 'MS', name: 'Mississippi', sales: 250_000, transactions: null, both: false, measured: 'previous 12 months', source: 'https://dor.ms.gov/pages/salestax-faqs.aspx' },
  { code: 'MO', name: 'Missouri', sales: 100_000, transactions: null, both: false, measured: 'previous 12 months, checked each quarter', source: 'https://dor.mo.gov/faq/taxation/business/remote-seller-and-marketplace-facilitator.html', note: 'Counts taxable sales' },
  { code: 'MT', name: 'Montana', sales: 0, transactions: null, both: false, measured: '', source: 'https://mtrevenue.gov/', note: 'No sales tax' },
  { code: 'NE', name: 'Nebraska', sales: 100_000, transactions: 200, both: false, measured: 'previous or current calendar year', source: 'https://revenue.nebraska.gov/about/frequently-asked-questions/remote-seller-and-marketplace-facilitator-faqs' },
  { code: 'NV', name: 'Nevada', sales: 100_000, transactions: 200, both: false, measured: 'previous or current calendar year', source: 'https://tax.nv.gov/faqs/remote-retail-sellers-faqs/' },
  { code: 'NH', name: 'New Hampshire', sales: 0, transactions: null, both: false, measured: '', source: 'https://www.revenue.nh.gov/', note: 'No sales tax' },
  { code: 'NJ', name: 'New Jersey', sales: 100_000, transactions: 200, both: false, measured: 'previous or current calendar year', source: 'https://www.nj.gov/treasury/taxation/remotesellers.shtml' },
  { code: 'NM', name: 'New Mexico', sales: 100_000, transactions: null, both: false, measured: 'previous calendar year', source: 'https://www.tax.newmexico.gov/businesses/determining-nexus/', note: 'Counts taxable sales' },
  { code: 'NY', name: 'New York', sales: 500_000, transactions: 100, both: true, measured: 'previous four sales tax quarters', source: 'https://www.tax.ny.gov/pubs_and_bulls/publications/sales/nexus.htm' },
  { code: 'NC', name: 'North Carolina', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://www.ncdor.gov/taxes-forms/sales-and-use-tax/other-sales-and-use-tax-resources/sales-and-use-tax-division-directives/sales-and-use-tax-directive-24-1' },
  { code: 'ND', name: 'North Dakota', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://www.tax.nd.gov/sales-and-use-tax' },
  { code: 'OH', name: 'Ohio', sales: 100_000, transactions: 200, both: false, measured: 'previous or current calendar year', source: 'https://tax.ohio.gov/help-center/faqs/sales-and-use-tax-substantial-nexus-and-marketplace-facilitator/sales-and-use-tax-substantial-nexus' },
  { code: 'OK', name: 'Oklahoma', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://oklahoma.gov/tax/helpcenter/businesses.html', note: 'Counts taxable sales' },
  { code: 'OR', name: 'Oregon', sales: 0, transactions: null, both: false, measured: '', source: 'https://www.oregon.gov/dor/', note: 'No sales tax' },
  { code: 'PA', name: 'Pennsylvania', sales: 100_000, transactions: null, both: false, measured: 'previous calendar year', source: 'https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/sales-use-and-hotel-occupancy-tax/online-retailers' },
  { code: 'RI', name: 'Rhode Island', sales: 100_000, transactions: 200, both: false, measured: 'previous calendar year', source: 'https://tax.ri.gov/tax-sections/sales-excise-taxes/remote-sellers' },
  { code: 'SC', name: 'South Carolina', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://dor.sc.gov/sales-use-tax-index/sales-tax/remote-sellers' },
  { code: 'SD', name: 'South Dakota', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://dor.sd.gov/businesses/taxes/sales-use-tax/2023-legislative-updates/' },
  { code: 'TN', name: 'Tennessee', sales: 100_000, transactions: null, both: false, measured: 'previous 12 months', source: 'https://www.tn.gov/revenue/taxes/sales-and-use-tax/out-of-state-dealers-marketplace-facilitators.html' },
  { code: 'TX', name: 'Texas', sales: 500_000, transactions: null, both: false, measured: 'previous 12 calendar months', source: 'https://comptroller.texas.gov/taxes/sales/remote-sellers.php' },
  { code: 'UT', name: 'Utah', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://le.utah.gov/xcode/Title59/Chapter12/C59-12-S107_2025070120250507.pdf' },
  { code: 'VT', name: 'Vermont', sales: 100_000, transactions: 200, both: false, measured: 'previous 12 months, checked each quarter', source: 'https://tax.vermont.gov/business-and-corp/sales-and-use-tax/wayfair/faqs' },
  { code: 'VA', name: 'Virginia', sales: 100_000, transactions: 200, both: false, measured: 'previous or current calendar year', source: 'https://www.tax.virginia.gov/remote-sellers-marketplace-facilitators-economic-nexus' },
  { code: 'WA', name: 'Washington', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://dor.wa.gov/taxes-rates/retail-sales-tax/marketplace-fairness-leveling-playing-field/remote-sellers', note: 'Counts all gross receipts in the state' },
  { code: 'WV', name: 'West Virginia', sales: 100_000, transactions: 200, both: false, measured: 'previous or current calendar year', source: 'https://tax.wv.gov/business/salesandusetax/ecommerce/remotesellers/Pages/RemoteSellersAndWestVirginiaTax.aspx' },
  { code: 'WI', name: 'Wisconsin', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://www.revenue.wi.gov/Pages/FAQS/ise-remote-sellers.aspx' },
  { code: 'WY', name: 'Wyoming', sales: 100_000, transactions: null, both: false, measured: 'previous or current calendar year', source: 'https://wyoleg.gov/2024/Enroll/HB0197.pdf' },
];

export const US_STATE_MAP: Record<string, UsState> = Object.fromEntries(US_STATES.map((s) => [s.code, s]));

export const US_STATE_OPTIONS = US_STATES.map((s) => ({ label: s.name, value: s.code }));
