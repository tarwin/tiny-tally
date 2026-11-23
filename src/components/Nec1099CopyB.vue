<script setup lang="ts">
// Form 1099-NEC Copy B, one page per recipient: a substitute statement on
// plain paper with the form's boxes, wording and Instructions for Recipient
// (nec1099Copy.ts). The payer's TIN is shown in full, the recipient's as the
// last four digits, as the IRS allows on recipient copies. Pub. 1179 section
// 4.1.3 sets what a substitute needs: the year, form number and name together,
// the same boxes and captions, the payer's phone number, the legend and the
// recipient instructions.
import { computed } from 'vue';
import { nec1099Revision, truncateTin } from '../shared/nec1099Copy';

export interface CopyBRecipient {
  id: number;
  name: string;
  tin: string | null;
  address: string | null;
  /** Box 1 (1a from 2026), in cents. */
  paid: number;
}

const props = defineProps<{
  year: number;
  payer: { name: string; address: string | null; phone: string | null; tin: string | null };
  recipients: CopyBRecipient[];
  /** Formats cents as the form's figures: 12,345.67 */
  amount: (cents: number) => string;
}>();

const rev = computed(() => nec1099Revision(props.year));
</script>

<template>
  <div class="CopyB">
    <section v-for="r in recipients" :key="r.id" class="Sheet">
      <div class="Form">
        <!-- left: payer and recipient -->
        <div class="Left">
          <div class="Cell Cell--payer">
            <span class="Cell__label">PAYER’S name, street address, city or town, state or province, country, ZIP or foreign postal code, and telephone no.</span>
            <span class="Cell__value">{{ payer.name }}</span>
            <span v-if="payer.address" class="Cell__value Cell__value--plain">{{ payer.address }}</span>
            <span v-if="payer.phone" class="Cell__value Cell__value--plain">{{ payer.phone }}</span>
          </div>
          <div class="Pair">
            <div class="Cell"><span class="Cell__label">PAYER’S TIN</span><span class="Cell__value">{{ payer.tin ?? '' }}</span></div>
            <div class="Cell"><span class="Cell__label">RECIPIENT’S TIN</span><span class="Cell__value">{{ truncateTin(r.tin) }}</span></div>
          </div>
          <div class="Cell"><span class="Cell__label">RECIPIENT’S name</span><span class="Cell__value">{{ r.name }}</span></div>
          <div class="Cell Cell--tall">
            <span class="Cell__label">Street address (including apt. no.), city or town, state or province, country, and ZIP or foreign postal code</span>
            <span class="Cell__value Cell__value--plain">{{ r.address ?? '' }}</span>
          </div>
          <div class="Cell"><span class="Cell__label">Account number (see instructions)</span><span class="Cell__value" /></div>
        </div>

        <!-- right: the boxes -->
        <div class="Right">
          <div class="Title">
            <div>
              <div class="Small">OMB No. 1545-0116</div>
              <div class="Big">Form <b>1099-NEC</b></div>
              <div class="Small">({{ rev.rev }})</div>
              <div class="Small">For calendar year <b class="Year">{{ year }}</b></div>
            </div>
            <div class="Name">Nonemployee Compensation</div>
          </div>
          <div class="Cell Box">
            <span class="Cell__label"><b>{{ rev.compBox }}</b> Nonemployee compensation</span>
            <span class="Cell__value Money">$ {{ amount(r.paid) }}</span>
          </div>
          <div v-if="rev.extraBoxes.length" class="Pair">
            <div v-for="b in rev.extraBoxes.slice(0, 2)" :key="b.box" class="Cell Box">
              <span class="Cell__label"><b>{{ b.box }}</b> {{ b.label }}</span><span class="Cell__value Money">{{ b.box === '1c' ? '' : '$' }}</span>
            </div>
          </div>
          <div v-for="b in rev.extraBoxes.slice(2)" :key="b.box" class="Cell Box">
            <span class="Cell__label"><b>{{ b.box }}</b> {{ b.label }}</span><span class="Cell__value Money">$</span>
          </div>
          <div class="Cell Box Box--check">
            <span class="Cell__label"><b>2</b> Payer made direct sales totaling $5,000 or more of consumer products to recipient for resale</span>
            <span class="Tick" />
          </div>
          <div class="Cell Box"><span class="Cell__label"><b>3</b> Excess golden parachute payments</span><span class="Cell__value Money">$</span></div>
          <div class="Cell Box"><!-- Pub. 1179 4.1.3: this caption must be bold on a substitute. -->
            <span class="Cell__label"><b>4 Federal income tax withheld</b></span><span class="Cell__value Money">$</span></div>
          <div class="Triple">
            <div class="Cell Box"><span class="Cell__label"><b>5</b> State tax withheld</span><span class="Cell__value Money">$</span></div>
            <div class="Cell Box"><span class="Cell__label"><b>6</b> State/Payer’s state no.</span><span class="Cell__value" /></div>
            <div class="Cell Box"><span class="Cell__label"><b>7</b> State income</span><span class="Cell__value Money">$</span></div>
          </div>
        </div>

        <!-- far right: the copy -->
        <div class="Copy">
          <div class="Copy__name">Copy B</div>
          <div class="Copy__for">For Recipient</div>
          <p>
            This is important tax information and is being furnished to the IRS. If you are required to file a return, a
            negligence penalty or other sanction may be imposed on you if this income is taxable and the IRS determines that it
            has not been reported.
          </p>
        </div>
      </div>
      <div class="FormFoot">
        <span>Form 1099-NEC ({{ rev.rev }})</span>
        <span>(keep for your records)</span>
        <span>www.irs.gov/Form1099NEC</span>
        <span>Department of the Treasury - Internal Revenue Service</span>
      </div>

      <div class="Instructions">
        <h3>Instructions for Recipient</h3>
        <p v-for="(t, i) in rev.instructions" :key="i">{{ t }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Paper, whatever the app theme. */
.CopyB {
  --ink: #111;
  --soft: #4a4f57;
  --rule: #222;
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 860px;
  margin: 0 auto;
  color: var(--ink);
  font-size: 11px;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}

.Sheet {
  padding: 28px 30px;
  background: #fff;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 12%), 0 0 0 1px rgb(0 0 0 / 6%);
}

.Form {
  display: grid;
  grid-template-columns: 1.15fr 1fr 0.55fr;
  border-top: 1.5px solid var(--rule);
  border-left: 1px solid var(--rule);
}

.Left,
.Right {
  display: flex;
  flex-direction: column;
}

.Cell {
  display: flex;
  flex-direction: column;
  min-height: 36px;
  padding: 2px 5px 4px;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
}

.Cell--payer {
  min-height: 108px;
}

.Cell--tall {
  min-height: 62px;
}

.Left > .Cell:last-child,
.Left > .Cell--tall {
  flex: 1;
}

.Cell__label {
  font-size: 0.82em;
}

.Cell__value {
  margin-top: 2px;
  font-size: 1.12em;
  font-weight: 600;
  white-space: pre-line;
}

.Cell__value--plain {
  margin-top: 0;
  font-weight: 400;
}

.Money {
  margin-top: auto;
}

.Pair,
.Triple {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.Triple {
  grid-template-columns: 1fr 1fr 1fr;
}

.Title {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
  padding: 3px 5px 5px;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
}

.Small {
  font-size: 0.82em;
}

.Big {
  font-size: 1.15em;
}

.Big b {
  font-size: 1.35em;
}

.Year {
  font-size: 1.25em;
}

.Name {
  align-self: center;
  max-width: 7em;
  font-size: 1.25em;
  font-weight: 700;
  text-align: right;
}

.Box--check {
  flex-direction: row;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.Tick {
  flex: none;
  width: 1.3em;
  height: 1.3em;
  border: 1px solid var(--ink);
}

.Copy {
  display: flex;
  flex-direction: column;
  padding: 6px 8px;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  text-align: right;
}

.Copy__name {
  font-size: 1.5em;
  font-weight: 700;
}

.Copy__for {
  font-weight: 700;
}

.Copy p {
  margin: 10px 0 0;
  font-size: 0.9em;
}

.FormFoot {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 0.82em;
}

.Instructions {
  columns: 2;
  column-gap: 22px;
  margin-top: 22px;
  font-size: 0.92em;
}

.Instructions h3 {
  margin: 0 0 6px;
  font-size: 1.15em;
}

.Instructions p {
  margin: 0 0 6px;
  break-inside: avoid;
}

@media screen and (max-width: 760px) {
  .Form {
    grid-template-columns: 1fr;
  }

  .Instructions {
    columns: 1;
  }
}

@media print {
  .CopyB {
    gap: 0;
    max-width: none;
    font-size: 8.6pt;
  }

  .Sheet {
    padding: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .Sheet + .Sheet {
    break-before: page;
  }
}
</style>
