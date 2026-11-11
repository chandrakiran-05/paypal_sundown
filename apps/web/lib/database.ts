import { DatabaseSync } from "node:sqlite";

/** Build workers and request handlers may initialize the same SQLite file. */
export function openDatabase(filename: string) {
  const db = new DatabaseSync(filename);
  // Configure each connection before WAL/schema changes acquire write locks.
  db.exec("PRAGMA busy_timeout=10000");
  return db;
}

/** WAL mode changes can return BUSY immediately despite busy_timeout. */
export function initializeSchema(db: DatabaseSync, schema: string) {
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      db.exec(schema);
      return;
    } catch (error) {
      const code = (error as { errcode?: number }).errcode;
      if ((code !== 5 && code !== 6) || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
