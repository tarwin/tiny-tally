// tjs:sqlite's Database, as much of it as the backend uses, over node:sqlite.
import { DatabaseSync } from 'node:sqlite';

export class Database {
  #db: DatabaseSync;
  #depth = 0;

  constructor(path: string, opts: { create?: boolean; readOnly?: boolean } = {}) {
    this.#db = new DatabaseSync(path, { readOnly: !!opts.readOnly });
  }

  exec(sql: string) {
    this.#db.exec(sql);
  }

  prepare(sql: string) {
    const st = this.#db.prepare(sql);
    return { all: (...args: any[]) => st.all(...args), run: (...args: any[]) => st.run(...args), finalize: () => {} };
  }

  /** Like tjs (better-sqlite3): nested calls become savepoints. */
  transaction(fn: (...args: any[]) => any) {
    return (...args: any[]) => {
      const name = `t${this.#depth}`;
      this.#db.exec(this.#depth ? `SAVEPOINT ${name}` : 'BEGIN');
      this.#depth++;
      try {
        const out = fn(...args);
        this.#depth--;
        this.#db.exec(this.#depth ? `RELEASE ${name}` : 'COMMIT');
        return out;
      } catch (e) {
        this.#depth--;
        this.#db.exec(this.#depth ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK');
        throw e;
      }
    };
  }

  get inTransaction() {
    return this.#db.isTransaction;
  }

  close() {
    this.#db.close();
  }
}
