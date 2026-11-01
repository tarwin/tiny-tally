<script setup lang="ts">
// A budget per income and expense category per month, for one financial
// year. The Profit & Loss compares against it.
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Card, CardSection, Page, Select, toast } from '@octans/ui';
import { api, errorMessage, type Category } from '../lib/api';
import { formatMoney, parseMoney, toInput } from '../lib/money';
import { toIso, yearStartFor } from '../lib/periods';
import { session } from '../lib/session';

const router = useRouter();
const books = computed(() => session.books!);
const currency = computed(() => books.value.currency);
const money = (v: number) => formatMoney(v, currency.value);

// ---- which year -------------------------------------------------------------------

const thisYear = yearStartFor(new Date(), books.value.fiscalYearStart);
const yearOptions = [-1, 0, 1].map((n) => {
  const start = new Date(thisYear.getFullYear() + n, thisYear.getMonth(), thisYear.getDate());
  const end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1);
  const label = start.getFullYear() === end.getFullYear() ? String(start.getFullYear()) : `${start.getFullYear()}–${String(end.getFullYear()).slice(2)}`;
  return { label: n === 0 ? `${label} (this year)` : label, value: toIso(start).slice(0, 7) };
});
const firstMonth = ref(yearOptions[1].value);

// ---- the grid -----------------------------------------------------------------------

const categories = ref<Category[]>([]);
const months = ref<string[]>([]);
/** categoryId → 12 amounts in cents, as saved. */
const saved = ref(new Map<number, number[]>());
/** categoryId → 12 input strings, as typed. */
const cells = ref(new Map<number, string[]>());
const loading = ref(true);
const saving = ref(false);

const blank = () => Array<string>(12).fill('');

async function load() {
  loading.value = true;
  try {
    const [cats, budget] = await Promise.all([api.listCategories(), api.getBudget(firstMonth.value)]);
    categories.value = cats;
    months.value = budget.months;
    saved.value = new Map(budget.rows.map((r) => [r.categoryId, r.amounts]));
    cells.value = new Map(budget.rows.map((r) => [r.categoryId, r.amounts.map((a) => (a ? toInput(a, currency.value) : ''))]));
  } finally {
    loading.value = false;
  }
}
watch(firstMonth, load);
onMounted(load);

/** Income and expense categories, plus archived ones that still have a budget here. */
const sections = computed(() =>
  (['income', 'expense'] as const).map((kind) => ({
    kind,
    title: kind === 'income' ? 'Income' : 'Expenses',
    rows: categories.value.filter((c) => c.kind === kind && c.class === 'pnl' && (!c.archived || saved.value.has(c.id))),
  })),
);

function row(id: number) {
  return cells.value.get(id) ?? blank();
}

function setCell(id: number, i: number, v: string) {
  const r = [...row(id)];
  r[i] = v;
  cells.value.set(id, r);
}

const cents = (s: string) => (s.trim() ? parseMoney(s, currency.value) : 0);

function rowTotal(id: number) {
  return row(id).reduce((t, s) => t + (cents(s) ?? 0), 0);
}

function columnTotal(kind: 'income' | 'expense', i: number) {
  return sections.value.find((s) => s.kind === kind)!.rows.reduce((t, c) => t + (cents(row(c.id)[i]) ?? 0), 0);
}
const sectionTotal = (kind: 'income' | 'expense') => months.value.reduce((t, _, i) => t + columnTotal(kind, i), 0);

/** The first filled month, copied into every month. */
function fillAcross(id: number) {
  const first = row(id).find((s) => s.trim());
  if (first) cells.value.set(id, Array(12).fill(first));
}

const bad = computed(() => [...cells.value].some(([, r]) => r.some((s) => cents(s) === null || (cents(s) ?? 0) < 0)));

/** Cells that differ from what's saved. */
const changes = computed(() => {
  const out: { categoryId: number; month: string; amount: number }[] = [];
  for (const [id, r] of cells.value) {
    r.forEach((s, i) => {
      const amount = cents(s);
      if (amount !== null && amount !== (saved.value.get(id)?.[i] ?? 0)) out.push({ categoryId: id, month: months.value[i], amount });
    });
  }
  return out;
});

async function save() {
  if (bad.value) {
    toast({ title: 'Check the highlighted amounts', content: 'Budgets are numbers of zero or more.', tone: 'error' });
    return;
  }
  saving.value = true;
  try {
    await api.saveBudget(changes.value);
    toast({ title: 'Budget saved', tone: 'success' });
    await load();
  } catch (e) {
    toast({ title: "Couldn't save the budget", content: errorMessage(e), tone: 'error' });
  } finally {
    saving.value = false;
  }
}

/** Last year's actual income and expenses, month by month, as a starting point. */
async function fromLastYear() {
  loading.value = true;
  try {
    const lastYear = months.value.map((m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`);
    const results = await Promise.all(
      lastYear.map((m) => {
        const [y, mo] = m.split('-').map(Number);
        return api.profitAndLoss({ from: `${m}-01`, to: toIso(new Date(y, mo, 0)), basis: books.value.taxBasis });
      }),
    );
    const next = new Map<number, string[]>();
    results.forEach((r, i) => {
      for (const c of [...r.income, ...r.expense]) {
        if (!c.id || c.total <= 0) continue;
        const cur = next.get(c.id) ?? blank();
        cur[i] = toInput(c.total, currency.value);
        next.set(c.id, cur);
      }
    });
    if (!next.size) {
      toast({ title: 'Nothing to copy', content: 'There was no income or spending in those months last year.' });
      return;
    }
    cells.value = next;
    toast({ title: "Filled in from last year's actuals", content: 'Adjust anything you expect to change, then save.' });
  } finally {
    loading.value = false;
  }
}

const monthLabel = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString(undefined, { month: 'short' });
</script>

<template>
  <Page
    title="Budget"
    subtitle="What you expect to earn and spend each month. Compare against it on the Profit & Loss."
    size="fullWidth"
    :primary-action="{ label: changes.length ? `Save (${changes.length})` : 'Saved', onAction: save, disabled: !changes.length, loading: saving }"
    :secondary-actions="[
      { label: 'Start from last year', icon: 'mdi:history', onAction: fromLastYear },
      { label: 'Compare on Profit & Loss', icon: 'mdi:chart-line', onAction: () => router.push({ path: '/reports/profit-and-loss', query: { compare: 'budget' } }) },
    ]"
  >
    <div class="Controls">
      <Select v-model="firstMonth" label="Financial year" :options="yearOptions" />
    </div>

    <Card>
      <CardSection>
        <div class="Wrap" :class="{ Loading: loading }">
          <table class="Grid">
            <thead>
              <tr>
                <th class="Grid__name">Category</th>
                <th v-for="m in months" :key="m" class="num">{{ monthLabel(m) }}</th>
                <th class="num">Year</th>
                <th />
              </tr>
            </thead>
            <tbody v-for="s in sections" :key="s.kind">
              <tr class="Grid__section"><td :colspan="15">{{ s.title }}</td></tr>
              <tr v-for="c in s.rows" :key="c.id">
                <td class="Grid__name" :title="c.name">{{ c.name }}</td>
                <td v-for="(_, i) in months" :key="i">
                  <input
                    class="Cell"
                    :class="{ 'Cell--bad': cents(row(c.id)[i]) === null || (cents(row(c.id)[i]) ?? 0) < 0 }"
                    :value="row(c.id)[i]"
                    inputmode="decimal"
                    :aria-label="`${c.name}, ${monthLabel(months[i])}`"
                    @input="setCell(c.id, i, ($event.target as HTMLInputElement).value)"
                  />
                </td>
                <td class="num money Grid__total">{{ rowTotal(c.id) ? money(rowTotal(c.id)) : '' }}</td>
                <td>
                  <Button type="plain" size="small" icon="mdi:arrow-collapse-right" tooltip="Same every month (copies the first month you filled in)" @click="fillAcross(c.id)" />
                </td>
              </tr>
              <tr class="Grid__sum">
                <td>Total {{ s.title.toLowerCase() }}</td>
                <td v-for="(_, i) in months" :key="i" class="num money">{{ money(columnTotal(s.kind, i)) }}</td>
                <td class="num money">{{ money(sectionTotal(s.kind)) }}</td>
                <td />
              </tr>
            </tbody>
            <tfoot>
              <tr class="Grid__net">
                <td>Net profit</td>
                <td v-for="(_, i) in months" :key="i" class="num money" :class="{ negative: columnTotal('income', i) - columnTotal('expense', i) < 0 }">
                  {{ money(columnTotal('income', i) - columnTotal('expense', i)) }}
                </td>
                <td class="num money" :class="{ negative: sectionTotal('income') - sectionTotal('expense') < 0 }">
                  {{ money(sectionTotal('income') - sectionTotal('expense')) }}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p class="subdued Note">Amounts are before {{ books.taxEnabled ? 'tax' : 'any tax' }}, like the Profit &amp; Loss. Leave a month blank for no budget.</p>
      </CardSection>
    </Card>
  </Page>
</template>

<style scoped>
.Controls {
  margin-bottom: 16px;
  max-width: 260px;
}

.Wrap {
  overflow-x: auto;
}

.Loading {
  opacity: 0.6;
  transition: opacity 0.15s;
}

.Grid {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}

.Grid th {
  font-weight: 500;
  color: var(--octans-text-subdued);
  padding: 4px;
  white-space: nowrap;
}

.Grid td {
  padding: 2px;
}

.Grid__name {
  text-align: left;
  min-width: 150px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 8px !important;
}

.Grid__section td {
  padding-top: 14px;
  font-weight: 600;
}

.Grid__sum td,
.Grid__net td {
  padding: 6px 4px;
  font-weight: 600;
  border-top: 1px solid var(--octans-border);
  white-space: nowrap;
}

.Grid__net td {
  border-top-width: 2px;
}

.Grid__total {
  padding: 0 6px !important;
  white-space: nowrap;
}

.num {
  text-align: right;
}

.Cell {
  width: 76px;
  box-sizing: border-box;
  padding: 4px 6px;
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--octans-text);
  background: var(--octans-surface);
  border: 1px solid var(--octans-border);
  border-radius: 6px;
}

.Cell:focus {
  outline: 2px solid var(--octans-primary);
  outline-offset: -1px;
}

.Cell--bad {
  border-color: var(--octans-text-error);
}

.Note {
  margin: 12px 0 0;
  font-size: 12px;
}
</style>
