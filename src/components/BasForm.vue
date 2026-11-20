<script setup lang="ts">
// The BAS laid out like the ATO's quarterly statement (BAS A): the same
// sections, boxes and order, filled in from the books, to print, save as a
// PDF, keep or copy from. It's Tiny Tally's own page, not the ATO's form:
// a statement is lodged online, by an agent, or on the personalised paper
// form the ATO sends out.
import { computed, h, type FunctionalComponent } from 'vue';
import { BAS_FORM_LAYOUT, basFormFigures } from '../shared/basForm';
import type { ReturnRow } from '../shared/taxReturns';

const props = defineProps<{
  rows: ReturnRow[];
  business: string;
  abn: string | null;
  /** 'Jul–Sep 2026 (1 Jul 2026 – 30 Sep 2026)' */
  period: string;
  due: string | null;
  basis: 'cash' | 'accrual';
  /** 'Lodged 28 Oct 2026', 'Draft'. */
  status: string;
  /** Today, formatted. */
  prepared: string;
}>();

const f = computed(() => basFormFigures(props.rows));
const v = (code: string) => f.value.boxes[code] ?? null;

/** A whole-dollar figure in boxes, one digit each, right-aligned: $ [ , , ] .00 */
const Digits: FunctionalComponent<{ value: number | null; width?: number; percent?: boolean }> = (p) => {
  const text = p.value === null ? '' : `${p.value < 0 ? '−' : ''}${Math.abs(p.value)}`;
  const width = Math.max(p.width ?? 11, text.length);
  const chars = [...' '.repeat(width - text.length), ...text];
  return h('span', { class: 'Digits' }, [
    p.percent ? null : h('span', { class: 'Digits__sign' }, '$'),
    ...chars.map((c, i) => h('span', { class: ['Digits__cell', { 'Digits__cell--group': i > 0 && (width - i) % 3 === 0 && !p.percent }] }, c.trim())),
    h('span', { class: 'Digits__after' }, p.percent ? '%' : '.00'),
  ]);
};

/** A labelled box: label, code, figure. */
const Field: FunctionalComponent<{ label: string; code: string; value: number | null; width?: number; percent?: boolean }> = (p) =>
  h('div', { class: 'Field' }, [
    h('span', { class: 'Field__label' }, p.label),
    h('span', { class: 'Field__code' }, p.code),
    h(Digits, { value: p.value, width: p.width, percent: p.percent }),
  ]);

/** A box to mark with an X. */
const Tick: FunctionalComponent<{ on?: boolean }> = (p) => h('span', { class: 'Tick' }, p.on ? 'X' : '');
</script>

<template>
  <div class="BasForm">
    <!-- ---- page 1: GST ---- -->
    <section class="Page">
      <header class="Head">
        <div>
          <div class="Kicker">Worked out from the books · not an ATO form</div>
          <h1>Business activity statement</h1>
          <p class="Head__sub">Quarterly: GST, PAYG withholding and PAYG instalments</p>
        </div>
        <dl class="Head__details">
          <dt>Business</dt><dd>{{ business }}</dd>
          <dt>ABN</dt><dd>{{ abn || '—' }}</dd>
          <dt>Period</dt><dd>{{ period }}</dd>
          <dt>Due</dt><dd>{{ due || '—' }}</dd>
          <dt>GST accounting method</dt><dd>{{ basis === 'cash' ? 'Cash' : 'Accrual' }}</dd>
          <dt>Status</dt><dd>{{ status }}</dd>
        </dl>
      </header>

      <h2 class="Band">Goods and services tax (GST)</h2>
      <p class="Lead">Complete Option 1 OR 2 OR 3 (indicate one choice with an X)</p>
      <div class="Cols">
        <div class="Box">
          <div class="Box__title"><Tick on /> Option 1: Calculate GST and report quarterly</div>
          <Field label="Total sales" code="G1" :value="v('G1')" />
          <div class="Question">
            <span>Does the amount shown at G1 include GST?</span>
            <span class="Choice"><Tick on /> Yes</span>
            <span class="Choice"><Tick /> No</span>
          </div>
          <Field label="Export sales" code="G2" :value="v('G2')" />
          <Field label="Other GST-free sales" code="G3" :value="v('G3')" />
          <Field label="Capital purchases" code="G10" :value="v('G10')" />
          <Field label="Non-capital purchases" code="G11" :value="v('G11')" />
          <p class="Hint">Report GST on sales at 1A and GST on purchases at 1B in the Summary over the page.</p>
          <p class="Hint Hint--soft">On Simpler BAS only G1 is reported here. G2, G3, G10 and G11 are worked out from the books for reference.</p>
        </div>
        <div class="Stack">
          <div class="Box Box--unused">
            <div class="Box__title"><Tick /> Option 2: Calculate GST quarterly and report annually</div>
            <Field label="Total sales" code="G1" :value="null" />
            <div class="Question">
              <span>Does the amount shown at G1 include GST?</span>
              <span class="Choice"><Tick /> Yes</span>
              <span class="Choice"><Tick /> No</span>
            </div>
          </div>
          <div class="Box Box--unused">
            <div class="Box__title"><Tick /> Option 3: Pay GST instalment amount quarterly</div>
            <Field label="GST instalment" code="G21" :value="null" />
            <Field label="Estimated net GST for the year" code="G22" :value="null" />
            <Field label="Varied amount payable for the quarter" code="G23" :value="null" />
            <div class="Field">
              <span class="Field__label">Reason code for variation</span>
              <span class="Field__code">G24</span>
              <span class="Digits"><span class="Digits__cell" /><span class="Digits__cell" /></span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ---- page 2: PAYG and the summary ---- -->
    <section class="Page">
      <div class="Cols">
        <div>
          <h2 class="Band">PAYG tax withheld</h2>
          <div class="Box">
            <Field label="Total salary, wages and other payments" code="W1" :value="v('W1')" />
            <Field label="Amount withheld from payments shown at W1" code="W2" :value="v('W2')" />
            <Field label="Amount withheld where no ABN is quoted" code="W4" :value="v('W4')" />
            <Field label="Other amounts withheld (not at W2 or W4)" code="W3" :value="v('W3')" />
            <Field label="Total amounts withheld (W2 + W4 + W3)" code="W5" :value="v('W5')" />
            <p class="Hint">Write the W5 amount at 4 in the Summary below.</p>
          </div>
        </div>
        <div>
          <h2 class="Band">PAYG income tax instalment</h2>
          <div class="Box" :class="{ 'Box--unused': !f.instalment }">
            <div class="Box__title"><Tick :on="f.instalment" /> Option 1: Pay a PAYG instalment amount quarterly</div>
            <Field label="Instalment amount" code="T7" :value="v('T7')" />
            <Field label="Estimated tax for the year" code="T8" :value="null" />
            <Field label="Varied amount payable for the quarter" code="T9" :value="null" />
            <p class="Hint">Write the T7 (or T9) amount at 5A in the Summary below.</p>
          </div>
          <div class="Box Box--unused">
            <div class="Box__title"><Tick /> Option 2: Calculate PAYG instalment using income times rate</div>
            <Field label="PAYG instalment income" code="T1" :value="null" />
            <Field label="Instalment rate" code="T2" :value="null" :width="5" :percent="true" />
            <Field label="T1 × T2 (or × T3)" code="T11" :value="null" />
          </div>
        </div>
      </div>

      <h2 class="Band">Summary</h2>
      <div class="Cols">
        <div class="Box">
          <div class="Box__title">Amounts you owe the ATO</div>
          <Field label="GST on sales" code="1A" :value="v('1A')" />
          <Field label="PAYG tax withheld" code="4" :value="v('4')" />
          <Field label="PAYG income tax instalment" code="5A" :value="v('5A')" />
          <Field label="Deferred company/fund instalment" code="7" :value="v('7')" />
          <Field label="1A + 4 + 5A + 7" code="8A" :value="v('8A')" />
        </div>
        <div class="Box">
          <div class="Box__title">Amounts the ATO owes you</div>
          <Field label="GST on purchases" code="1B" :value="v('1B')" />
          <Field label="Credit from PAYG income tax instalment variation" code="5B" :value="v('5B')" />
          <Field label="1B + 5B" code="8B" :value="v('8B')" />
        </div>
      </div>

      <h2 class="Band">Payment or refund?</h2>
      <div class="Cols">
        <div class="Box">
          <div class="Box__title">Is 8A more than 8B?</div>
          <div class="Answer"><Tick :on="f.owing === true" /> <span><strong>Yes</strong>, then write 8A minus 8B at 9. This amount is payable to the ATO.</span></div>
          <div class="Answer"><Tick :on="f.owing === false" /> <span><strong>No</strong>, then write 8B minus 8A at 9. This amount is refundable to you.</span></div>
        </div>
        <div class="Box">
          <div class="Box__title">Your payment or refund amount</div>
          <Field label="" code="9" :value="v('9')" />
          <p class="Result">
            {{ f.owing === true ? 'To pay to the ATO' : f.owing === false ? 'Refund from the ATO' : 'Nothing to pay or refund' }}
          </p>
        </div>
      </div>

      <div class="Box Declaration">
        <p>
          <strong>Declaration</strong> I declare that the information given on this form is true and correct, and that I am authorised to make this declaration.
        </p>
        <div class="Sign">
          <span>Signature <span class="Line Line--long" /></span>
          <span>Date <span class="Line" /> / <span class="Line" /> / <span class="Line Line--year" /></span>
        </div>
      </div>

      <footer class="Foot">
        Prepared with Tiny Tally on {{ prepared }} from the books of {{ business }}, {{ basis }} basis, in whole dollars with cents dropped.
        This is a record of the figures, not a form the ATO accepts: lodge through Online services for business, your registered agent,
        or the statement the ATO sends you. Laid out after the ATO's {{ BAS_FORM_LAYOUT.form }}.
      </footer>
    </section>
  </div>
</template>

<style scoped>
/* Paper, whatever the app theme. */
.BasForm {
  --ink: #1d1f24;
  --soft: #5f636b;
  --rule: #9aa3b0;
  --band: #2e3a48;
  --tint: #eef1f5;
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

/* ---- head ---- */
.Head {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 24px;
  align-items: start;
  padding-bottom: 12px;
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
  font-size: 2em;
  font-weight: 700;
  line-height: 1.1;
}

.Head__sub {
  margin: 0;
  color: var(--soft);
}

.Head__details {
  display: grid;
  grid-template-columns: auto auto;
  gap: 3px 12px;
  margin: 0;
}

.Head__details dt {
  color: var(--soft);
  text-align: right;
}

.Head__details dd {
  margin: 0;
  font-weight: 600;
}

/* ---- sections ---- */
.Band {
  margin: 6px 0 0;
  padding: 4px 8px;
  background: var(--band);
  color: #fff;
  font-size: 1.1em;
  font-weight: 700;
}

.Lead {
  margin: 0;
  font-weight: 600;
}

.Cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: start;
}

.Stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.Cols > div > .Band {
  margin: 0 0 8px;
}

.Cols > div > .Box + .Box {
  margin-top: 10px;
}

.Box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--rule);
  border-radius: 3px;
}

.Box--unused {
  opacity: 0.45;
}

.Box__title {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 2px;
  font-weight: 700;
}

/* ---- boxes ---- */
.Field {
  display: grid;
  grid-template-columns: 1fr 2.6em auto;
  gap: 6px;
  align-items: center;
}

.Field__label {
  color: var(--soft);
  font-size: 0.92em;
  text-align: right;
}

.Field__code {
  font-weight: 700;
  text-align: right;
}

:deep(.Digits) {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

:deep(.Digits__sign) {
  margin-right: 3px;
  font-weight: 600;
}

:deep(.Digits__cell) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.35em;
  height: 1.7em;
  border: 1px solid var(--rule);
  border-left-width: 0;
  background: #fff;
  font-size: 1.05em;
  font-weight: 600;
}

:deep(.Digits__cell:first-of-type),
:deep(.Digits__sign + .Digits__cell),
:deep(.Digits__cell--group) {
  border-left-width: 1px;
}

:deep(.Digits__cell--group) {
  margin-left: 3px;
}

:deep(.Digits__after) {
  margin-left: 2px;
  font-weight: 600;
}

:deep(.Tick) {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 1.35em;
  height: 1.35em;
  border: 1px solid var(--ink);
  background: #fff;
  font-weight: 700;
  line-height: 1;
}

.Question {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  align-items: center;
  justify-content: flex-end;
  color: var(--soft);
  font-size: 0.92em;
}

.Choice {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: var(--ink);
}

.Answer {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.Hint {
  margin: 2px 0 0;
  font-weight: 600;
}

.Hint--soft {
  color: var(--soft);
  font-weight: 400;
}

.Result {
  margin: 0;
  font-size: 1.1em;
  font-weight: 700;
  text-align: right;
}

.Declaration {
  margin-top: 6px;
  background: var(--tint);
}

.Declaration p {
  margin: 0;
}

.Sign {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 32px;
  margin-top: 18px;
}

.Line {
  display: inline-block;
  width: 2.2em;
  border-bottom: 1px solid var(--ink);
}

.Line--long {
  width: 22em;
}

.Line--year {
  width: 3.6em;
}

.Foot {
  margin-top: 4px;
  color: var(--soft);
  font-size: 0.85em;
}

@media screen and (max-width: 760px) {
  .Cols,
  .Head {
    grid-template-columns: 1fr;
  }
}

/* One statement page to each sheet of paper. */
@media print {
  .BasForm {
    gap: 0;
    max-width: none;
    font-size: 8pt;
  }

  .Head {
    gap: 16px;
  }

  .Box {
    gap: 4px;
    padding: 7px 9px;
  }

  .Field {
    grid-template-columns: 1fr 2.2em auto;
    gap: 4px;
  }

  :deep(.Digits__cell) {
    width: 1.15em;
    height: 1.55em;
  }

  :deep(.Tick) {
    width: 1.25em;
    height: 1.25em;
  }

  .Page {
    padding: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .Page + .Page {
    break-before: page;
  }

  .Cols {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
