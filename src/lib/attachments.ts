// Attaching receipts: reading a picked or dropped file, shrinking photos so
// the books file stays a sensible size, and routing drops to whatever is
// open (a transaction or a document) instead of the importer.
import { api, type AttachmentFile } from './api';

export const ATTACHABLE = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'];

export function isAttachable(path: string) {
  return ATTACHABLE.includes(path.slice(path.lastIndexOf('.') + 1).toLowerCase());
}

/** Photos are kept up to this many pixels on the long side. */
const MAX_SIDE = 2000;
/** Smaller images than this (bytes, roughly) are kept as they are. */
const KEEP_UNDER = 600 * 1024;

/** Reads a file through the backend and shrinks it if it's a big photo. */
export async function readForAttaching(path: string): Promise<AttachmentFile> {
  const file = await api.readAttachmentFile(path);
  return file.mime.startsWith('image/') && file.mime !== 'image/gif' ? shrink(file) : file;
}

/** A JPEG at most MAX_SIDE on the long side. Anything the webview can't decode is kept as it is. */
async function shrink(file: AttachmentFile): Promise<AttachmentFile> {
  const img = new Image();
  img.src = `data:${file.mime};base64,${file.data}`;
  try {
    await img.decode();
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && (file.data.length * 3) / 4 < KEEP_UNDER) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  // Transparent PNGs would turn black as JPEG.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  // Only worth it if it came out smaller.
  if (data.length >= file.data.length) return file;
  return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', data };
}

export function sizeText(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---- drops ----------------------------------------------------------------------
// The newest open place that takes attachments gets dropped receipts.

type DropTarget = (paths: string[]) => void;
const targets: DropTarget[] = [];

export function registerDropTarget(fn: DropTarget) {
  targets.push(fn);
  return () => {
    const i = targets.lastIndexOf(fn);
    if (i >= 0) targets.splice(i, 1);
  };
}

/** True if something took the files as attachments. */
export function dropAttachments(paths: string[]) {
  const target = targets[targets.length - 1];
  if (!target || !paths.length || !paths.every(isAttachable)) return false;
  target(paths);
  return true;
}
