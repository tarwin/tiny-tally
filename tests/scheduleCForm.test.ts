// Schedule C as the form lays it out agrees with the Schedule C report.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { DEMO_NAMES, DEMO_SETUP, seedDemo } from '../backend/demo.ts';
import { scheduleCReport } from '../backend/reports.ts';
import { scheduleCForm } from '../src/shared/scheduleCForm.ts';

test('the form view of the US demo adds up to the report', async () => {
  const b = await makeBooks({ name: DEMO_NAMES.US, ...DEMO_SETUP.US });
  b.run(() => {
    seedDemo('2026-11-03', 'US');
    for (const year of [2025, 2026]) {
      const r = scheduleCReport({ from: `${year}-01-01`, to: `${year}-12-31`, basis: 'cash' });
      const f = scheduleCForm(r as any);
      const lines = f.partII.map((l) => l.line);
      // Every expense line, in the form's order, once each.
      assert.equal(new Set(lines).size, lines.length);
      assert.deepEqual(lines.slice(0, 6), ['8', '9', '10', '11', '12', '13']);
      assert.ok(lines.includes('27a') && lines.includes('27b'));
      assert.deepEqual(lines.filter((l) => l.startsWith('16')), year >= 2026 ? ['16a', '16b', '16c'] : ['16a', '16b']);
      // Part II adds up to line 28, and line 31 is the report's net profit.
      assert.equal(f.partII.reduce((t, l) => t + (l.value ?? 0), 0), r.totals.totalExpenses, `${year} line 28`);
      assert.equal(f.totals.find((l) => l.line === '28')!.value, r.totals.totalExpenses);
      assert.equal(f.totals.find((l) => l.line === '31')!.value, r.totals.netProfit);
      assert.equal(f.partI.find((l) => l.line === '7')!.value, r.totals.grossIncome);
      // Part V lists what's in other expenses, and totals it.
      assert.equal(f.partV.items.reduce((t, i) => t + i.total, 0), f.partV.total);
      // Lines no category maps to are left empty.
      assert.equal(f.partII.find((l) => l.line === '12')!.value, null);
    }
  });
  b.close();
});
