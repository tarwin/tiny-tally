// Base64 without atob/btoa (txiki has neither), in chunks so megabyte files
// don't build strings one character at a time.
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const INDEX = new Int16Array(128).fill(-1);
for (let i = 0; i < ABC.length; i++) INDEX[ABC.charCodeAt(i)] = i;

export function toBase64(bytes: Uint8Array) {
  const parts: string[] = [];
  const CHUNK = 3 * 4096;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    let s = '';
    for (let i = start; i < end; i += 3) {
      const a = bytes[i], b = i + 1 < end ? bytes[i + 1] : -1, c = i + 2 < end ? bytes[i + 2] : -1;
      s += ABC[a >> 2] + ABC[((a & 3) << 4) | (b < 0 ? 0 : b >> 4)];
      s += b < 0 ? '=' : ABC[((b & 15) << 2) | (c < 0 ? 0 : c >> 6)];
      s += c < 0 ? '=' : ABC[c & 63];
    }
    parts.push(s);
  }
  return parts.join('');
}

/** Throws on anything that isn't base64 (whitespace is ignored). */
export function fromBase64(text: string) {
  const s = text.replace(/\s+/g, '');
  if (s.length % 4 === 1) throw new Error('Not base64.');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const len = s.length - pad;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const n = [0, 1, 2, 3].map((k) => (i + k < len ? INDEX[s.charCodeAt(i + k)] ?? -1 : 0));
    if (n.some((v) => v < 0)) throw new Error('Not base64.');
    const v = (n[0] << 18) | (n[1] << 12) | (n[2] << 6) | n[3];
    out[o++] = v >> 16;
    if (o < out.length) out[o++] = (v >> 8) & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}
