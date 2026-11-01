// Attachments: receipts and supplier invoices stored in the books file as
// BLOBs. The page shrinks photos before they get here; PDFs come as they are.
// Bytes cross the bridge as base64.
import { all, getBooks, one, run } from './db';
import { fromBase64, toBase64 } from '../src/shared/base64';

/** What can be attached, by extension. */
const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};
const MAX_BYTES = 25 * 1024 * 1024;
const TOO_BIG = 'That file is over 25 MB. Try a smaller scan or photo.';

export type Owner = { entryId: number; invoiceId?: undefined } | { invoiceId: number; entryId?: undefined };

function ownerWhere(o: Owner) {
  if (typeof o?.entryId === 'number') return { col: 'entry_id', id: o.entryId, table: 'entries', what: 'transaction' };
  if (typeof o?.invoiceId === 'number') return { col: 'invoice_id', id: o.invoiceId, table: 'invoices', what: 'document' };
  throw new Error('Attach it to a transaction or a document.');
}

const baseName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
const extOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

/** A file the person picked or dropped, as base64 for the page to shrink (images) or send straight back. */
export async function readAttachmentFile(path: string) {
  const name = baseName(String(path));
  const mime = TYPES[extOf(name)];
  if (!mime) throw new Error('Attach a PDF or a photo (JPEG, PNG, HEIC, WebP or GIF).');
  const st = await tjs.stat(path);
  if (st.size > MAX_BYTES) throw new Error(TOO_BIG);
  return { name, mime, data: toBase64(await tjs.readFile(path)) };
}

export function listAttachments(o: Owner) {
  const w = ownerWhere(o);
  return all(getBooks().db,
    `SELECT id, name, mime, size, created_at AS createdAt FROM attachments WHERE ${w.col} = ? ORDER BY id`, w.id);
}

export function addAttachment(p: Owner & { name: string; mime: string; data: string }) {
  const { db } = getBooks();
  const w = ownerWhere(p);
  if (!one(db, `SELECT id FROM ${w.table} WHERE id = ?`, w.id)) throw new Error(`That ${w.what} no longer exists.`);
  const name = baseName(String(p.name ?? '')).trim().slice(0, 200) || 'Attachment';
  const mime = Object.values(TYPES).includes(p.mime) ? p.mime : TYPES[extOf(name)];
  if (!mime) throw new Error('Attach a PDF or a photo (JPEG, PNG, HEIC, WebP or GIF).');
  const bytes = fromBase64(String(p.data ?? ''));
  if (!bytes.length) throw new Error('That file is empty.');
  if (bytes.length > MAX_BYTES) throw new Error(TOO_BIG);
  return one<{ id: number }>(db,
    `INSERT INTO attachments (${w.col}, name, mime, size, data) VALUES (?, ?, ?, ?, ?) RETURNING id`,
    w.id, name, mime, bytes.length, bytes)!.id;
}

function bytesOf(id: number) {
  const row = one<{ name: string; mime: string; data: Uint8Array }>(getBooks().db, 'SELECT name, mime, data FROM attachments WHERE id = ?', id);
  if (!row) throw new Error('That attachment no longer exists.');
  return row;
}

/** For previewing an image in the page. */
export function getAttachment(id: number) {
  const { name, mime, data } = bytesOf(id);
  return { name, mime, data: toBase64(new Uint8Array(data)) };
}

/** Writes a copy where the person chose (Save a copy…). */
export async function saveAttachmentTo(id: number, path: string) {
  if (typeof path !== 'string' || (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path))) throw new Error('Choose where to save.');
  const { data } = bytesOf(id);
  await tjs.writeFile(path, new Uint8Array(data));
  return path;
}

/** Writes a temporary copy for the system viewer (Preview, Acrobat…) and returns its path. */
export async function openAttachment(id: number) {
  const { name, data } = bytesOf(id);
  const dir = `${tjs.tmpDir}/tiny-tally-attachments`;
  await tjs.makeDir(dir, { recursive: true });
  const path = `${dir}/${id}-${name.replace(/[^\w.\- ]+/g, '_')}`;
  await tjs.writeFile(path, new Uint8Array(data));
  return path;
}

export function deleteAttachment(id: number) {
  run(getBooks().db, 'DELETE FROM attachments WHERE id = ?', id);
  return true;
}
