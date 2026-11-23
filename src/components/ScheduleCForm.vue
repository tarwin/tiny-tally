<script setup lang="ts">
// Schedule C laid out like the IRS form: the header, Parts I and II on the
// first page, Parts III to V on the second, filled in from the Schedule C
// report. Tiny Tally's own page, to print, keep or copy from: the return is
// filed on the IRS's Schedule C, through tax software or a preparer.
import { computed } from 'vue';
import { scheduleCForm, type FormLine, type ScheduleCFormSource } from '../shared/scheduleCForm';

const props = defineProps<{
  report: ScheduleCFormSource;
  /** Formats cents as the form's figures: 12,345.67 */
  amount: (cents: number) => string;
  proprietor: string;
  businessName: string | null;
  ein: string | null;
  address: string | null;
  basis: 'cash' | 'accrual';
  /** 'Tax year 2026', or the dates for a custom range. */
  period: string;
  /** 'Schedule C (2026)' */
  linesFrom: string;
  prepared: string;
}>();

const f = computed(() => scheduleCForm(props.report));
/** Part II in the form's two columns: 8 to 17, then 18 on. */
const columns = computed(() => {
  const at = f.value.partII.findIndex((l) => Number.parseInt(l.line, 10) >= 18);
  return [f.value.partII.slice(0, at), f.value.partII.slice(at)];
});
const show = (l: FormLine) => (l.value === null ? '' : l.value < 0 ? `(${props.amount(-l.value)})` : props.amount(l.value));
</script>

<template>
  <div class="ScheduleCForm">
    <!-- ---- page 1: header, Parts I and II ---- -->
    <section class="Page">
      <header class="Head">
        <div>
          <div class="Kicker">Worked out from the books · not an IRS form</div>
          <h1>Schedule C: Profit or Loss From Business</h1>
          <p class="Head__sub">Sole proprietorship · {{ period }} · lines as in {{ linesFrom }}</p>
        </div>
      </header>

      <div class="Fields">
        <div class="Fields__row">
          <div class="Field"><span class="Field__label">Name of proprietor</span><span class="Field__value">{{ proprietor }}</span></div>
          <div class="Field Field--narrow"><span class="Field__label">Social security number (SSN)</span><span class="Field__value Field__value--blank" /></div>
        </div>
        <div class="Fields__row">
          <div class="Field"><span class="Field__label"><b>A</b> Principal business or profession, including product or service</span><span class="Field__value Field__value--blank" /></div>
          <div class="Field Field--narrow"><span class="Field__label"><b>B</b> Business code</span><span class="Field__value Field__value--blank" /></div>
        </div>
        <div class="Fields__row">
          <div class="Field"><span class="Field__label"><b>C</b> Business name</span><span class="Field__value">{{ businessName ?? '' }}</span></div>
          <div class="Field Field--narrow"><span class="Field__label"><b>D</b> Employer ID number (EIN)</span><span class="Field__value">{{ ein ?? '' }}</span></div>
        </div>
        <div class="Fields__row">
          <div class="Field"><span class="Field__label"><b>E</b> Business address</span><span class="Field__value">{{ address ?? '' }}</span></div>
        </div>
        <div class="Question">
          <span><b>F</b> Accounting method:</span>
          <span class="Choice"><span class="Tick">{{ basis === 'cash' ? 'X' : '' }}</span> Cash</span>
          <span class="Choice"><span class="Tick">{{ basis === 'accrual' ? 'X' : '' }}</span> Accrual</span>
          <span class="Choice"><span class="Tick" /> Other</span>
        </div>
        <div v-for="q in [
          ['G', 'Did you “materially participate” in the operation of this business during the year?'],
          ['I', 'Did you make any payments that would require you to file Form(s) 1099?'],
          ['J', 'If “Yes,” did you or will you file required Form(s) 1099?'],
        ]" :key="q[0]" class="Question">
          <span><b>{{ q[0] }}</b> {{ q[1] }}</span>
          <span class="Choice"><span class="Tick" /> Yes</span>
          <span class="Choice"><span class="Tick" /> No</span>
        </div>
      </div>

      <h2 class="Band">Part I · Income</h2>
      <div class="Lines">
        <div v-for="l in f.partI" :key="l.line" class="Line" :class="{ 'Line--total': l.total }">
          <span class="Line__no">{{ l.line }}</span><span class="Line__label">{{ l.label }}</span><span class="Line__amount">{{ show(l) }}</span>
        </div>
      </div>

      <h2 class="Band">Part II · Expenses</h2>
      <div class="Cols">
        <div v-for="(col, i) in columns" :key="i" class="Lines">
          <div v-for="l in col" :key="l.line" class="Line">
            <span class="Line__no">{{ l.line }}</span><span class="Line__label">{{ l.label }}</span><span class="Line__amount">{{ show(l) }}</span>
          </div>
        </div>
      </div>
      <div class="Lines">
        <div v-for="l in f.totals" :key="l.line" class="Line" :class="{ 'Line--total': l.total }">
          <span class="Line__no">{{ l.line }}</span><span class="Line__label">{{ l.label }}</span><span class="Line__amount">{{ show(l) }}</span>
        </div>
      </div>
    </section>

    <!-- ---- page 2: Parts III to V ---- -->
    <section class="Page">
      <h2 class="Band">Part III · Cost of Goods Sold</h2>
      <div v-if="f.partIII.length" class="Lines">
        <div class="Question Question--left">
          <span><b>33</b> Method used to value closing inventory:</span>
          <span class="Choice"><span class="Tick" /> Cost</span>
          <span class="Choice"><span class="Tick" /> Lower of cost or market</span>
          <span class="Choice"><span class="Tick" /> Other</span>
        </div>
        <div v-for="l in f.partIII" :key="l.line" class="Line" :class="{ 'Line--total': l.total }">
          <span class="Line__no">{{ l.line }}</span><span class="Line__label">{{ l.label }}</span><span class="Line__amount">{{ show(l) }}</span>
        </div>
      </div>
      <p v-else class="None">No cost of goods sold or inventory in the books for this period.</p>

      <h2 class="Band">Part IV · Information on Your Vehicle</h2>
      <div v-if="f.businessMiles !== null" class="Lines">
        <div class="Line">
          <span class="Line__no">43</span><span class="Line__label">When did you place your vehicle in service for business purposes?</span><span class="Line__amount" />
        </div>
        <div class="Line">
          <span class="Line__no">44a</span><span class="Line__label">Miles driven for business (from the mileage log)</span><span class="Line__amount">{{ f.businessMiles.toLocaleString() }}</span>
        </div>
        <div class="Line">
          <span class="Line__no">44b–c</span><span class="Line__label">Commuting and other miles</span><span class="Line__amount" />
        </div>
        <p class="Hint">Lines 45 to 47b are questions to answer on the return.</p>
      </div>
      <p v-else class="None">Only for car and truck expenses at the standard mileage rate; no business miles in the mileage log for this period.</p>

      <h2 class="Band">Part V · Other Expenses</h2>
      <div class="Lines">
        <div v-for="item in f.partV.items" :key="item.name" class="Line">
          <span class="Line__no" /><span class="Line__label">{{ item.name }}</span><span class="Line__amount">{{ amount(item.total) }}</span>
        </div>
        <p v-if="!f.partV.items.length" class="None">No other expenses.</p>
        <div class="Line Line--total">
          <span class="Line__no">48</span><span class="Line__label">Total other expenses (to Part II, other expenses)</span><span class="Line__amount">{{ amount(f.partV.total) }}</span>
        </div>
      </div>

      <footer class="Foot">
        Prepared with Tiny Tally on {{ prepared }} from the books of {{ proprietor }}, {{ basis }} basis. A record of the figures, not
        an IRS form: transfer them to Schedule C (Form 1040) or give them to your tax preparer. Blank lines and questions are for you
        to complete; the books don't know them.
      </footer>
    </section>
  </div>
</template>

<style scoped>
/* Paper, whatever the app theme. */
.ScheduleCForm {
  --ink: #1d1f24;
  --soft: #5f636b;
  --rule: #9aa3b0;
  --band: #2e3a48;
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 860px;
  margin: 0 auto;
  color: var(--ink);
  font-size: 12px;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
}

.Page {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 28px 30px;
  background: #fff;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 12%), 0 0 0 1px rgb(0 0 0 / 6%);
}

.Head {
  padding-bottom: 10px;
  border-bottom: 2px solid var(--band);
}

.Kicker {
  color: var(--soft);
  font-size: 0.85em;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

h1 {
  margin: 4px 0 2px;
  font-size: 1.8em;
  font-weight: 700;
  line-height: 1.15;
}

.Head__sub {
  margin: 0;
  color: var(--soft);
}

.Fields {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.Fields__row {
  display: grid;
  grid-template-columns: 1fr 220px;
  gap: 8px;
}

.Fields__row:has(> :only-child) {
  grid-template-columns: 1fr;
}

.Field {
  display: flex;
  flex-direction: column;
  min-height: 34px;
  padding: 3px 6px;
  border: 1px solid var(--rule);
}

.Field__label {
  color: var(--soft);
  font-size: 0.85em;
}

.Field__value {
  font-weight: 600;
  white-space: pre-line;
}

.Question {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  align-items: center;
  padding: 2px 0;
}

.Question > :first-child {
  flex: 1;
}

.Question--left > :first-child {
  flex: none;
}

.Choice {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}

.Tick {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 1.3em;
  height: 1.3em;
  border: 1px solid var(--ink);
  font-weight: 700;
  line-height: 1;
}

.Band {
  margin: 6px 0 0;
  padding: 4px 8px;
  background: var(--band);
  color: #fff;
  font-size: 1.1em;
  font-weight: 700;
}

.Cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 18px;
}

.Lines {
  display: flex;
  flex-direction: column;
}

.Line {
  display: grid;
  grid-template-columns: 2.6em 1fr 8.5em;
  gap: 6px;
  align-items: end;
  padding: 3px 0;
  border-bottom: 1px solid #d7dbe1;
}

.Line__no {
  font-weight: 700;
}

.Line__amount {
  min-height: 1.35em;
  padding: 0 4px;
  border-bottom: 1px solid var(--rule);
  font-weight: 600;
  text-align: right;
}

.Line--total .Line__label {
  font-weight: 600;
}

.None,
.Hint {
  margin: 2px 0;
  color: var(--soft);
}

.Foot {
  margin-top: 8px;
  color: var(--soft);
  font-size: 0.85em;
}

@media screen and (max-width: 760px) {
  .Cols,
  .Fields__row {
    grid-template-columns: 1fr;
  }
}

@media print {
  .ScheduleCForm {
    gap: 0;
    max-width: none;
    font-size: 8.4pt;
  }

  .Page {
    padding: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .Page + .Page {
    break-before: page;
  }
}
</style>
