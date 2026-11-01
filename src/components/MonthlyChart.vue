<script setup lang="ts">
// Income and expenses per month as paired bars, with a tooltip per month.
// Plain HTML so it takes the theme's tokens in light and dark.
import { computed, ref } from 'vue';
import { formatMoney } from '../lib/money';

const props = defineProps<{ months: { month: string; income: number; expense: number }[]; currency: string }>();

const hovered = ref<number | null>(null);
const max = computed(() => Math.max(1, ...props.months.flatMap((m) => [m.income, m.expense])));
const pct = (v: number) => `${Math.max(0, (v / max.value) * 100)}%`;
const money = (v: number) => formatMoney(v, props.currency);

function label(month: string, long = false) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, long ? { month: 'long', year: 'numeric' } : { month: 'short' });
}
</script>

<template>
  <div class="Chart">
    <div class="Chart__legend subdued">
      <span><i class="Swatch Swatch--in" />Income</span>
      <span><i class="Swatch Swatch--out" />Expenses</span>
      <span class="Chart__max">Top {{ money(max) }}</span>
    </div>
    <div class="Chart__plot" @mouseleave="hovered = null">
      <div
        v-for="(m, i) in months"
        :key="m.month"
        class="Chart__col"
        :class="{ 'Chart__col--on': hovered === i }"
        :aria-label="`${label(m.month, true)}: income ${money(m.income)}, expenses ${money(m.expense)}`"
        role="img"
        @mouseenter="hovered = i"
      >
        <div class="Chart__bars">
          <div class="Bar Bar--in" :style="{ height: pct(m.income) }" />
          <div class="Bar Bar--out" :style="{ height: pct(m.expense) }" />
        </div>
        <div class="Chart__x subdued">{{ label(m.month) }}</div>
        <div v-if="hovered === i" class="Tip" :class="{ 'Tip--left': i > months.length / 2 }">
          <strong>{{ label(m.month, true) }}</strong>
          <div><i class="Swatch Swatch--in" />Income <span class="money">{{ money(m.income) }}</span></div>
          <div><i class="Swatch Swatch--out" />Expenses <span class="money">{{ money(m.expense) }}</span></div>
          <div class="Tip__net">
            {{ m.income - m.expense < 0 ? 'Loss' : 'Profit' }} <span class="money">{{ money(Math.abs(m.income - m.expense)) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.Chart__legend {
  display: flex;
  gap: 16px;
  font-size: 12px;
  margin-bottom: 10px;
}

.Chart__max {
  margin-left: auto;
}

.Swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 6px;
  vertical-align: -1px;
}

.Swatch--in,
.Bar--in {
  background: var(--octans-primary);
}

.Swatch--out,
.Bar--out {
  background: var(--octans-text-subdued);
  opacity: 0.55;
}

.Chart__plot {
  display: flex;
  height: 160px;
  border-bottom: 1px solid var(--octans-border);
}

.Chart__col {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  border-radius: 6px 6px 0 0;
}

.Chart__col--on {
  background: var(--octans-surface-hover);
}

.Chart__bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
  padding: 0 3px;
}

.Bar {
  width: min(14px, 40%);
  border-radius: 4px 4px 0 0;
  min-height: 0;
}

.Chart__x {
  position: absolute;
  bottom: -20px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 11px;
}

.Tip {
  position: absolute;
  top: 8px;
  left: calc(100% + 4px);
  z-index: 2;
  min-width: 180px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--octans-border);
  background: var(--octans-surface-raised);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.12);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  pointer-events: none;
}

.Tip--left {
  left: auto;
  right: calc(100% + 4px);
}

.Tip div {
  display: flex;
  align-items: center;
}

.Tip .money {
  margin-left: auto;
  padding-left: 12px;
}

.Tip__net {
  padding-top: 4px;
  border-top: 1px solid var(--octans-border);
}

.Chart {
  padding-bottom: 20px;
}
</style>
