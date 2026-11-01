// `node --import ./tests/support/register.mjs`: lets tests load the backend.
import { register } from 'node:module';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';

register('./hooks.mjs', import.meta.url);

// The few tjs globals the backend touches while opening books.
globalThis.tjs = {
  env: { HOSTNAME: 'test' },
  pid: process.pid,
  tmpDir: tmpdir(),
  stat: (p) => fs.stat(p),
  readFile: (p) => fs.readFile(p),
  writeFile: (p, data) => fs.writeFile(p, data),
  makeDir: (p, o) => fs.mkdir(p, o),
  makeTempDir: (t) => fs.mkdtemp(t.replace(/X+$/, '')),
  remove: (p) => fs.rm(p, { force: true }),
  spawn: () => {
    throw new Error('spawn is not available in tests');
  },
};
