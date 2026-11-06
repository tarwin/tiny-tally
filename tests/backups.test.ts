import test from 'node:test';
import assert from 'node:assert/strict';
import { backupDue, backupName, latestBackupStamp } from '../src/shared/backups.ts';

test('finds the newest backup of these books and nothing else', () => {
  const names = [
    backupName('Shop', '2026-01-02 09-00-00', 'tally'),
    backupName('Shop', '2026-03-01 09-00-00', 'tally'),
    backupName('Shop', '2026-02-01 09-00-00', 'tally'),
    backupName('Shop Two', '2026-12-01 09-00-00', 'tally'),
    'Shop 2026-12-01 09-00-00.txt',
    'Shop notes.tally',
    'Shop.tally',
  ];
  assert.equal(latestBackupStamp(names, 'Shop', 'tally'), '2026-03-01 09-00-00');
  assert.equal(latestBackupStamp(['Shop notes.tally'], 'Shop', 'tally'), null);
});

test('a backup falls due by calendar days', () => {
  const at = (d: string) => `${d} 23-59-00`;
  assert.equal(backupDue('off', null, at('2026-03-01')), false);
  assert.equal(backupDue('day', null, at('2026-03-01')), true);
  assert.equal(backupDue('day', '2026-03-01 08-00-00', at('2026-03-01')), false);
  assert.equal(backupDue('day', '2026-02-28 23-59-00', '2026-03-01 00-01-00'), true);
  assert.equal(backupDue('week', '2026-03-01 08-00-00', at('2026-03-07')), false);
  assert.equal(backupDue('week', '2026-03-01 08-00-00', at('2026-03-08')), true);
  assert.equal(backupDue('month', '2026-03-01 08-00-00', at('2026-03-30')), false);
  assert.equal(backupDue('month', '2026-03-01 08-00-00', at('2026-03-31')), true);
});
