// `node --import ./tests/support/register.mjs`: lets tests load the backend.
import { register } from 'node:module';
import * as fs from 'node:fs/promises';

register('./hooks.mjs', import.meta.url);

// The few tjs globals the backend touches while opening books.
globalThis.tjs = {
  env: { HOSTNAME: 'test' },
  pid: process.pid,
  stat: (p) => fs.stat(p),
  readFile: (p) => fs.readFile(p),
  writeFile: (p, data) => fs.writeFile(p, data),
  makeDir: (p, o) => fs.mkdir(p, o),
  remove: (p) => fs.rm(p, { force: true }),
  spawn: () => {
    throw new Error('spawn is not available in tests');
  },
};
