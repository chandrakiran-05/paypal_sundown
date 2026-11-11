import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase, initializeSchema } from "./database";

it("waits for another build worker's schema lock instead of failing initialization", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sundown-lock-"));
  const file = path.join(dir, "test.sqlite");
  const worker = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync(${JSON.stringify(file)}); db.exec('BEGIN IMMEDIATE'); process.stdout.write('locked'); setTimeout(()=>{db.exec('COMMIT');db.close()},300);`,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const done = once(worker, "exit");
  try {
    await once(worker.stdout!, "data");
    const db = openDatabase(file);
    try {
      initializeSchema(
        db,
        "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS example(id INTEGER)",
      );
      expect(db.prepare("PRAGMA busy_timeout").get()?.timeout).toBe(10000);
      expect(
        db.prepare("SELECT count(*) AS count FROM example").get()?.count,
      ).toBe(0);
    } finally {
      db.close();
    }
    await done;
  } finally {
    worker.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
