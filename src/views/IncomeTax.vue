<script setup lang="ts">
// Income tax through the year. Australia: PAYG instalments, either the
// amount on the ATO's notice or the instalment rate times each quarter's
// instalment income, paid with the BAS. New Zealand: provisional tax, the
// standard method (last year's residual income tax plus 5%) or an estimate,
// in three instalments, less the tax clients withheld. Payments are the
// transactions in the category marked for income tax instalments.
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Banner, Button, Card, CardSection, Page, SegmentedControl, Select, TextField, toast } from '@octans/ui';
import { api, errorMessage, type PaygReport, type ProvisionalReport } from '../lib/api';
import { formatDay, today } from '../lib/dates';
import { newEntry } from '../lib/entryEditor';
import { onBooksChanged } from '../lib/live';
import { formatMoney, parseMoney, toInput } from '../lib/money';
import { printElement } from '../lib/print';
import { session } from '../lib/session';
import { incomeYearLabel, incomeYearOf } from '../shared/incomeYear';

const router = useRouter();
const books = computed(() => session.books!);
const au = computed(() => books.value.country === 'AU');
const money = (v: number) => formatMoney(v, books.value.currency);
const ys = computed(() => books.value.fiscalYearStart);

const thisYear = incomeYearOf(today(), ys.value);
const year = ref(thisYear);
const yearOptions = computed(() => [1, 0, -1, -2].map((i) => ({ label: incomeYearLabel(thisYear + i, ys.value), value: thisYear + i })));
const payg = ref<PaygReport | null>(null);
const prov = ref<ProvisionalReport | null>(null);
const report = computed(() => (au.value ? payg.value : prov.value));
const loading = ref(false);
const sheet = ref<HTMLElement | null>(null);
const typed = ref({ amount: '', rate: '', prior: '', twoYears: '', estimate: '' });

async function load() {
  loading.value = true;
  try {
    if (au.value) {
      const r = (payg.value = await api.paygReport({ year: year.value, today: today() }));
      typed.value.amount = r.inputs.paygAmount != null ? toInput(r.inputs.paygAmount, books.value.currency) : '';
      typed.value.rate = r.inputs.paygRatePct != null ? String(r.inputs.paygRatePct) : '';
    } else {
      const r = (prov.value = await api.provisionalReport({ year: year.value, today: today() }));
      typed.value.prior = r.inputs.priorYearTax != null ? toInput(r.inputs.priorYearTax, books.value.currency) : '';
      typed.value.twoYears = r.inputs.twoYearsAgoTax != null ? toInput(r.inputs.twoYearsAgoTax, books.value.currency) : '';
      typed.value.estimate = r.inputs.estimate != null ? toInput(r.inputs.estimate, books.value.currency) : '';
    }
  } finally {
    loading.value = false;
  }
}
watch(year, load, { immediate: true });
onBooksChanged(load);

const cents = (v: string) => (v.trim() ? parseMoney(v, books.value.currency) : null);
async function save(p: Omit<Parameters<typeof api.setYearInputs>[0], 'year'>) {
  try {
    await api.setYearInputs({ year: year.value, ...p });
    await load();
  } catch (e) {
    toast({ title: "Couldn't save", content: errorMessage(e), tone: 'error' });
  }
}
const savePayg = () => save({ paygAmount: cents(typed.value.amount), paygRatePct: typed.value.rate.trim() ? Number(typed.value.rate) : null });
const saveProv = () => save({ priorYearTax: cents(typed.value.prior), twoYearsAgoTax: cents(typed.value.twoYears), estimate: cents(typed.value.estimate) });

const STATE_TEXT = { paid: 'Paid', upcoming: 'Due', overdue: 'Overdue' } as const;
const word = computed(() => (au.value ? 'PAYG instalment' : 'Provisional tax'));

async function recordPayment() {
  const next = report.value?.next;
  const category = (await api.listCategories()).find((c) => c.reportLine === 'estimated-tax' && !c.archived);
  newEntry('expense', null, null, {
    amount: next?.short || undefined,
    memo: `${word.value} ${incomeYearLabel(year.value, ys.value)}${next ? `, ${au.value ? 'quarter' : 'instalment'} ${next.number}` : ''}`,
    ...(category ? { categoryId: category.id } : {}),
  });
}
</script>

<template>
  <Page
    :title="au ? 'PAYG instalments' : 'Provisional tax'"
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }]"
    size="wide"
    :primary-action="{ label: 'Record a payment', icon: 'mdi:plus', onAction: recordPayment }"
    :secondary-actions="[{ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: () => printElement(sheet) }]"
  >
    <div class="Controls">
      <Select v-model="year" label="Income year" :options="yearOptions" />
      <div v-if="au && payg">
        <div class="Label">You pay</div>
        <SegmentedControl
          :model-value="payg.option"
          :options="[{ label: 'The ATO’s amount', value: 'amount' }, { label: 'Rate × income', value: 'rate' }]"
          @update:model-value="(v: 'amount' | 'rate') => save({ paygOption: v })"
        />
      </div>
      <div v-if="!au && prov">
        <div class="Label">Method</div>
        <SegmentedControl
          :model-value="prov.method"
          :options="[{ label: 'Standard', value: 'standard' }, { label: 'Estimation', value: 'estimation' }]"
          @update:model-value="(v: 'standard' | 'estimation') => save({ provisionalMethod: v })"
        />
      </div>
    </div>

    <Banner v-if="report && !report.hasCategory" status="warning" title="No category for income tax payments" class="Gap">
      <p>Mark a tax payment category as where {{ au ? 'PAYG instalments' : 'provisional tax payments' }} go, so they're counted here.</p>
      <Button @click="router.push('/categories')">Categories</Button>
    </Banner>
    <Banner v-if="prov && prov.method === 'standard' && prov.basis === 'none'" status="info" title="Enter last year's residual income tax" class="Gap">
      <p>The standard method is last year's residual income tax plus 5%. It's on last year's assessment (IR3 Box 36A, or myIR).</p>
    </Banner>
    <Banner v-if="prov && prov.basis !== 'none' && !prov.provisional" status="success" title="No provisional tax this year" class="Gap">
      <p>Residual income tax of {{ money(prov.threshold) }} or less means no provisional tax: pay any tax owing as terminal tax by {{ formatDay(prov.terminalDue) }}.</p>
    </Banner>

    <Card>
      <CardSection>
        <div ref="sheet" :class="{ Loading: loading }">
          <div class="ReportHead">
            <h2>{{ books.name }}: {{ au ? 'PAYG instalments' : 'Provisional tax' }}, {{ incomeYearLabel(year, ys) }}</h2>
            <p>{{ report ? `${formatDay(report.from)} – ${formatDay(report.to)}` : '' }}</p>
          </div>

          <table v-if="payg && au" class="Report">
            <thead><tr><th>Quarter</th><th>Due</th><th class="num">Instalment income</th><th class="num">Instalment</th></tr></thead>
            <tbody>
              <tr v-for="(q, i) in payg.quarters" :key="q.from">
                <td>Q{{ i + 1 }} <span class="subdued Small">{{ formatDay(q.from) }} – {{ formatDay(q.to) }}</span></td>
                <td>{{ formatDay(q.due) }}</td>
                <td class="num">{{ payg.option === 'rate' ? money(q.income) : '' }}</td>
                <td class="num">{{ money(q.amount) }}</td>
              </tr>
              <tr class="Report__total"><td colspan="3">For the year so far</td><td class="num">{{ money(payg.total) }}</td></tr>
            </tbody>
          </table>

          <table v-if="prov && !au" class="Report">
            <tbody>
              <tr>
                <td>Profit {{ prov.projected ? `to ${formatDay(prov.through)}` : 'for the year' }}</td>
                <td class="num">{{ money(prov.profitSoFar) }}</td>
              </tr>
              <tr v-if="prov.projected"><td>For the whole year, at that pace</td><td class="num">{{ money(prov.profit) }}</td></tr>
              <tr><td>Income tax on that<div class="subdued Small">At the individual rates, with no other income</div></td><td class="num">{{ money(prov.incomeTax) }}</td></tr>
              <tr><td>Less tax withheld by clients<div class="subdued Small">{{ prov.withheld.byClient.map((c) => `${c.name ?? 'Unknown'} ${money(c.amount)}`).join(', ') || 'None recorded' }}</div></td><td class="num">{{ money(prov.withheld.total) }}</td></tr>
              <tr class="Report__total"><td>Residual income tax, roughly</td><td class="num">{{ money(prov.residual) }}</td></tr>
              <tr class="Report__grand">
                <td>
                  Provisional tax for the year
                  <div class="subdued Small">
                    {{ prov.basis === 'last-year' ? "Last year's residual income tax plus 5%"
                      : prov.basis === 'two-years' ? 'Two years ago plus 10%, until last year’s return is filed'
                      : prov.basis === 'estimate' ? 'Your estimate' : 'Enter last year’s figure below' }}
                  </div>
                </td>
                <td class="num">{{ money(prov.provisional) }}</td>
              </tr>
            </tbody>
          </table>

          <table v-if="report" class="Report Installments">
            <thead>
              <tr><th>{{ au ? 'Quarter' : 'Instalment' }}</th><th>Due</th><th class="num">Should have paid by then</th><th class="num">Paid by then</th><th class="num">Still to pay</th><th /></tr>
            </thead>
            <tbody>
              <tr v-for="i in report.installments" :key="i.number">
                <td>{{ i.number }}</td>
                <td>{{ formatDay(i.due) }}</td>
                <td class="num">{{ money(i.cumulativeTarget) }}</td>
                <td class="num">{{ money(i.paidByDue) }}</td>
                <td class="num">{{ i.short ? money(i.short) : '' }}</td>
                <td :class="{ negative: i.state === 'overdue' }">{{ STATE_TEXT[i.state] }}</td>
              </tr>
            </tbody>
          </table>

          <p v-if="payg && au" class="subdued Note">
            Instalment income is your business income before GST, on the {{ books.taxBasis }} basis. Report each quarter's
            instalment at T7 on your BAS (with the income at T1 and the rate at T2 if you use the rate). A rough idea of the
            year's tax on this profit, at resident rates with the Medicare levy and no offsets: {{ money(payg.estimatedTax) }}.
            If your instalments will be well over or under, you can vary them.
          </p>
          <p v-if="prov && !au" class="subdued Note">
            Due dates are for a 31 March balance date. Paying the standard method in full and on time keeps you clear of
            interest until terminal tax is due ({{ formatDay(prov.terminalDue) }}, or later with a tax agent) when residual
            income tax is under $60,000. The income tax here is rough: it doesn't know about other income or credits.
          </p>
        </div>
      </CardSection>
    </Card>

    <div class="Columns">
      <Card title="Your figures">
        <CardSection>
          <div v-if="au" class="Inputs">
            <TextField
              v-model="typed.amount"
              label="Instalment amount on your notice"
              :prefix="books.currency"
              align="right"
              help-text="Each quarter, from the ATO (option 1)."
              @blur="savePayg"
              @keydown.enter="savePayg"
            />
            <TextField
              v-model="typed.rate"
              label="Instalment rate"
              suffix="%"
              inputmode="decimal"
              help-text="From the ATO (option 2), times each quarter's instalment income."
              @blur="savePayg"
              @keydown.enter="savePayg"
            />
          </div>
          <div v-else class="Inputs">
            <TextField
              v-model="typed.prior"
              label="Last year's residual income tax"
              :prefix="books.currency"
              align="right"
              help-text="IR3 Box 36A on last year's assessment."
              @blur="saveProv"
              @keydown.enter="saveProv"
            />
            <TextField
              v-model="typed.twoYears"
              label="Two years ago, if last year's return isn't filed"
              :prefix="books.currency"
              align="right"
              @blur="saveProv"
              @keydown.enter="saveProv"
            />
            <TextField
              v-if="prov?.method === 'estimation'"
              v-model="typed.estimate"
              label="Your estimate of this year's residual income tax"
              :prefix="books.currency"
              align="right"
              :placeholder="prov ? toInput(prov.residual, books.currency) : ''"
              help-text="An estimate that turns out low is charged interest from each instalment date."
              @blur="saveProv"
              @keydown.enter="saveProv"
            />
          </div>
        </CardSection>
      </Card>

      <Card title="Payments counted">
        <CardSection>
          <p v-if="!report?.payments.length" class="subdued Note First">None yet for {{ incomeYearLabel(year, ys) }}.</p>
          <table v-else class="Report">
            <tbody>
              <tr v-for="p in report.payments" :key="p.id">
                <td>{{ formatDay(p.date) }}</td>
                <td class="subdued">{{ p.memo }}</td>
                <td class="num">{{ money(p.amount) }}</td>
              </tr>
              <tr class="Report__total"><td colspan="2">Paid</td><td class="num">{{ money(report.totalPaid) }}</td></tr>
            </tbody>
          </table>
        </CardSection>
      </Card>
    </div>
  </Page>
</template>

<style scoped>
.Controls {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 16px;
}

.Controls > :first-child {
  min-width: 160px;
}

.Label {
  font-size: 13px;
  margin-bottom: 6px;
}

.Gap {
  margin-bottom: 16px;
}

.Gap p {
  margin: 0 0 8px;
}

.Loading {
  opacity: 0.6;
  transition: opacity 0.15s;
}

.Small {
  font-size: 12px;
}

.Installments {
  margin-top: 24px;
}

.negative {
  color: var(--octans-text-error);
}

.Note {
  margin: 16px 0 0;
  font-size: 12px;
}

.First {
  margin-top: 0;
}

.Columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
  margin-top: 16px;
  align-items: start;
}

.Inputs {
  display: grid;
  gap: 16px;
}
</style>
