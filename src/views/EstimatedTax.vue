<script setup lang="ts">
// Quarterly estimated tax (Form 1040-ES, US): a rough worksheet from the
// business's own Schedule C profit. Self-employment tax is worked out
// exactly; income tax at a rate the person sets, since it depends on
// everything else on their return. Payments are the transactions in the
// category marked for estimated tax.
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Banner, Button, Card, CardSection, Page, Select, TextField, ToggleSwitch, toast } from '@octans/ui';
import { api, errorMessage, type EstimatedTaxReport } from '../lib/api';
import { formatDay, today } from '../lib/dates';
import { newEntry } from '../lib/entryEditor';
import { onBooksChanged } from '../lib/live';
import { formatMoney, parseMoney, toInput } from '../lib/money';
import { printElement } from '../lib/print';
import { session } from '../lib/session';

const router = useRouter();
const books = computed(() => session.books!);
const money = (v: number) => formatMoney(v, books.value.currency);

const now = new Date();
// The last payment for a year is due in mid-January of the next.
const year = ref(now.getMonth() === 0 && now.getDate() <= 15 ? now.getFullYear() - 1 : now.getFullYear());
const yearOptions = [1, 0, -1, -2].map((i) => ({ label: String(now.getFullYear() + i), value: now.getFullYear() + i }));
const project = ref(true);
const report = ref<EstimatedTaxReport | null>(null);
const loading = ref(false);
const sheet = ref<HTMLElement | null>(null);

const typed = ref({ incomeTaxPct: '', priorYearTax: '', wages: '' });
const highIncome = ref(false);

async function load() {
  loading.value = true;
  try {
    const r = (report.value = await api.estimatedTaxReport({ year: year.value, today: today(), project: project.value }));
    typed.value = {
      incomeTaxPct: String(r.incomeTaxPct),
      priorYearTax: r.inputs.priorYearTax != null ? toInput(r.inputs.priorYearTax, books.value.currency) : '',
      wages: r.inputs.wages != null ? toInput(r.inputs.wages, books.value.currency) : '',
    };
    highIncome.value = !!r.inputs.priorYearHighIncome;
  } finally {
    loading.value = false;
  }
}
watch([year, project], load, { immediate: true });
onBooksChanged(load);

async function saveInputs() {
  const r = report.value;
  if (!r) return;
  const pct = typed.value.incomeTaxPct.trim() === '' ? null : Number(typed.value.incomeTaxPct);
  const prior = typed.value.priorYearTax.trim() ? parseMoney(typed.value.priorYearTax, books.value.currency) : null;
  const wages = typed.value.wages.trim() ? parseMoney(typed.value.wages, books.value.currency) : null;
  const same = (pct ?? 12) === r.incomeTaxPct && (prior ?? null) === (r.inputs.priorYearTax ?? null)
    && (wages ?? null) === (r.inputs.wages ?? null) && highIncome.value === !!r.inputs.priorYearHighIncome;
  if (same) return;
  try {
    await api.setYearInputs({
      year: year.value,
      incomeTaxPct: pct as number,
      priorYearTax: prior as number,
      wages: wages as number,
      priorYearHighIncome: highIncome.value,
    });
    await load();
  } catch (e) {
    toast({ title: "Couldn't save", content: errorMessage(e), tone: 'error' });
  }
}

const STATE_TEXT = { paid: 'Paid', upcoming: 'Due', overdue: 'Overdue' } as const;

async function recordPayment() {
  const next = report.value?.next;
  const category = (await api.listCategories()).find((c) => c.reportLine === 'estimated-tax' && !c.archived);
  newEntry('expense', null, null, {
    amount: next?.short || undefined,
    memo: next ? `Estimated tax ${year.value}, payment ${next.number}` : `Estimated tax ${year.value}`,
    ...(category ? { categoryId: category.id } : {}),
  });
}
</script>

<template>
  <Page
    title="Estimated tax"
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }]"
    size="wide"
    :primary-action="{ label: 'Record a payment', icon: 'mdi:plus', onAction: recordPayment }"
    :secondary-actions="[{ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: () => printElement(sheet) }]"
  >
    <div class="Controls">
      <Select v-model="year" label="Tax year" :options="yearOptions" />
      <ToggleSwitch v-if="report && (report.projected || report.through < `${year}-12-31`)" v-model="project" label="Project the full year from profit so far" />
    </div>

    <Banner v-if="report && report.status !== 'checked'" status="warning" title="This year's figures haven't been checked" class="Gap">
      <p>
        Tiny Tally doesn't have the IRS figures for {{ year }} yet, so it's using the latest it has (the Social Security
        wage base) with the usual due dates. Update the app when the IRS publishes them.
      </p>
    </Banner>
    <Banner v-if="report && !report.hasCategory" status="warning" title="No category for estimated tax payments" class="Gap">
      <p>Mark a tax payment category (like Income Tax Payment) as where estimated tax payments go, so they're counted here.</p>
      <Button @click="router.push('/categories')">Categories</Button>
    </Banner>

    <Card>
      <CardSection>
        <div ref="sheet" :class="{ Loading: loading }">
          <div class="ReportHead">
            <h2>{{ books.name }}: Estimated tax, {{ year }}</h2>
            <p v-if="report">
              {{ report.projected ? `Projected from profit up to ${formatDay(report.through)}` : `Profit up to ${formatDay(report.through)}` }}
            </p>
          </div>

          <table v-if="report" class="Report">
            <tbody>
              <tr>
                <td>Net profit (Schedule C line 31){{ report.projected ? ', so far' : '' }}</td>
                <td class="num">{{ money(report.profitSoFar) }}</td>
              </tr>
              <tr v-if="report.projected">
                <td>Projected for the year</td>
                <td class="num">{{ money(report.profit) }}</td>
              </tr>
              <tr>
                <td>
                  Self-employment tax
                  <div class="subdued Small">15.3% of 92.35% of profit; Social Security stops at {{ money(report.selfEmployment.wageBase) }}</div>
                </td>
                <td class="num">{{ money(report.selfEmployment.tax) }}</td>
              </tr>
              <tr>
                <td>
                  Income tax at {{ report.incomeTaxPct }}%
                  <div class="subdued Small">On profit less half the self-employment tax ({{ money(report.selfEmployment.halfDeduction) }})</div>
                </td>
                <td class="num">{{ money(report.incomeTax) }}</td>
              </tr>
              <tr class="Report__total"><td>Estimated tax for the year</td><td class="num">{{ money(report.projectedTax) }}</td></tr>
              <tr v-if="report.safeHarbor !== null">
                <td>
                  Safe harbor: {{ report.inputs.priorYearHighIncome ? '110%' : '100%' }} of last year's tax
                  <div class="subdued Small">Paying the smaller of the two on time avoids the underpayment penalty</div>
                </td>
                <td class="num">{{ money(report.safeHarbor) }}</td>
              </tr>
              <tr class="Report__grand"><td>To pay over four installments</td><td class="num">{{ money(report.target) }}</td></tr>
            </tbody>
          </table>

          <table v-if="report" class="Report Installments">
            <thead>
              <tr><th>Installment</th><th>Due</th><th class="num">Should have paid by then</th><th class="num">Paid by then</th><th class="num">Still to pay</th><th /></tr>
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

          <p class="subdued Note">
            A guide, not your tax bill. It counts only this business: not other income, deductions, credits or the
            standard deduction, so set the income tax rate to what you expect to pay overall (federal and state).
            Pay at irs.gov/payments (IRS Direct Pay is free), then record the payment here.
          </p>
          <p v-if="report" class="subdued Note">Figures and due dates checked {{ formatDay(report.checked) }}.</p>
        </div>
      </CardSection>
    </Card>

    <div class="Columns">
      <Card title="Your figures">
        <CardSection>
          <div class="Inputs">
            <TextField
              v-model="typed.incomeTaxPct"
              label="Income tax rate"
              suffix="%"
              inputmode="decimal"
              help-text="Federal plus state, as a share of profit. 10–25% is common."
              @blur="saveInputs"
              @keydown.enter="saveInputs"
            />
            <TextField
              v-model="typed.wages"
              label="Wages from a job this year"
              :prefix="books.currency"
              align="right"
              help-text="They use up the Social Security wage base first."
              @blur="saveInputs"
              @keydown.enter="saveInputs"
            />
            <TextField
              v-model="typed.priorYearTax"
              label="Last year's total tax"
              :prefix="books.currency"
              align="right"
              help-text="From last year's Form 1040 (total tax). Leave empty to skip the safe harbor."
              @blur="saveInputs"
              @keydown.enter="saveInputs"
            />
            <ToggleSwitch v-model="highIncome" label="Last year's AGI was over $150,000" @update:model-value="saveInputs" />
          </div>
        </CardSection>
      </Card>

      <Card title="Payments counted">
        <CardSection>
          <p v-if="!report?.payments.length" class="subdued Note First">None yet for {{ year }}.</p>
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
