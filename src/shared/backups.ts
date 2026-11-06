// Backup names and timing, shared by the backend and the page.
// A backup's time is in its name, so "when was the last one" needs no record
// in the books: writing one would change the file on every backup.

export type BackupEvery = 'off' | 'day' | 'week' | 'month';
export const BACKUP_EVERY: BackupEvery[] = ['off', 'day', 'week', 'month'];

const DAYS: Record<Exclude<BackupEvery, 'off'>, number> = { day: 1, week: 7, month: 30 };

/** 'Harbour 2026-11-06 14-30-05.tally'. The stamp is local time, sent by the page. */
export const backupName = (base: string, stamp: string, ext: string) => `${base} ${stamp}.${ext}`;

/** The newest backup of these books among a folder's file names, as its stamp. */
export function latestBackupStamp(names: string[], base: string, ext: string) {
  let latest: string | null = null;
  for (const n of names) {
    if (!n.startsWith(`${base} `) || !n.endsWith(`.${ext}`)) continue;
    const stamp = n.slice(base.length + 1, -ext.length - 1);
    if (/^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}$/.test(stamp) && (!latest || stamp > latest)) latest = stamp;
  }
  return latest;
}

const dayNumber = (stamp: string) => Date.UTC(+stamp.slice(0, 4), +stamp.slice(5, 7) - 1, +stamp.slice(8, 10)) / 86_400_000;

/** Whether a backup is due. Goes by calendar days, so "every day" means once each day. */
export function backupDue(every: BackupEvery, latest: string | null, now: string) {
  if (every === 'off') return false;
  return !latest || dayNumber(now) - dayNumber(latest) >= DAYS[every];
}
