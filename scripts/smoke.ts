/** Exercise the persisted replay flow, migration artifacts and release gates without network credentials. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  snapshot,
  setFlag,
  runParity,
  migrate,
  simulateCanary,
  root,
} from "../apps/web/lib/store";
for (const key of [
  "migrated",
  "idempotent",
  "failed",
  "checked",
  "canary",
  "running",
])
  setFlag(key, "");
assert.equal(snapshot().results.filter((r) => r.differences.length).length, 1);
assert.equal(
  snapshot().checks.every((c) => c.pass),
  false,
);
await runParity();
let state = snapshot();
assert.equal(state.results.filter((r) => r.differences.length).length, 0);
assert(state.tasks.some((t) => t.flagged));
assert(
  state.logs.some((l) => String(l.message).includes("Verifier iteration 1/3")),
);
migrate();
state = snapshot();
assert(state.checks.every((c) => c.pass));
assert(existsSync(path.join(root, "workspace/migrated-shop/catalog.json")));
assert.equal(
  JSON.parse(
    readFileSync(
      path.join(root, "workspace/migrated-shop/catalog.json"),
      "utf8",
    ),
  ).length,
  3,
);
await simulateCanary();
assert(snapshot().canary.rollback);
console.log(
  "PASS: persisted failure → schedule deferral → repair → 6/6 parity → migration → catalog → readiness → simulated rollback.",
);
for (const key of [
  "migrated",
  "idempotent",
  "failed",
  "checked",
  "canary",
  "running",
])
  setFlag(key, "");
