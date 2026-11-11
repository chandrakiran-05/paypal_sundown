/** SQLite-backed run state and SSE event journal; all paths stay under the workspace. */
import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseLiveReport } from "@sundown/engine/live-evidence";
import {
  scan,
  plan,
  fixtureSchema,
  executeFixture,
  readiness,
  products,
  merchants,
  migratedSource,
  webhookSource,
  unifiedDiff,
  canary,
} from "@sundown/engine";
export const root =
  process.env.SUNDOWN_ROOT ||
  (process.cwd().endsWith("/apps/web")
    ? path.resolve(process.cwd(), "../..")
    : process.cwd());
mkdirSync(path.join(root, "workspace"), { recursive: true });
const sql = new DatabaseSync(path.join(root, "workspace/sundown.sqlite"));
sql.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state(id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS journal(id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, message TEXT NOT NULL); CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY, kind TEXT NOT NULL)",
);
export function getFlag(key: string) {
  return (
    (sql.prepare("SELECT value FROM state WHERE id=?").get(key)?.value as
      string | undefined) || ""
  );
}
export function setFlag(key: string, value: string) {
  sql
    .prepare(
      "INSERT INTO state(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
    .run(key, value);
}
export function log(message: string) {
  sql
    .prepare("INSERT INTO journal(created,message) VALUES (?,?)")
    .run(new Date().toISOString(), message);
}
export function acceptWebhook(id: string, kind: string) {
  return (
    sql
      .prepare("INSERT OR IGNORE INTO webhook_events(id,kind) VALUES (?,?)")
      .run(id, kind).changes > 0
  );
}
export function fixtures() {
  return readdirSync(path.join(root, "fixtures"))
    .filter((f) => f.endsWith(".json"))
    .map((f) =>
      fixtureSchema.parse(
        JSON.parse(readFileSync(path.join(root, "fixtures", f), "utf8")),
      ),
    );
}
export function sourceFiles() {
  return Object.fromEntries(
    readdirSync(path.join(root, "apps/legacy-shop"))
      .filter((f) => f.endsWith(".php"))
      .map((f) => [
        f,
        readFileSync(path.join(root, "apps/legacy-shop", f), "utf8"),
      ]),
  );
}
export function snapshot() {
  const migrated = getFlag("migrated") === "true",
    fixed = getFlag("idempotent") === "true",
    failed = getFlag("failed") === "true";
  const findings = scan(sourceFiles());
  const results = fixtures().map((f) => executeFixture(f, fixed));
  const generated = path.join(root, "workspace/migrated-shop");
  const generatedFiles = Object.fromEntries(
    ["index.php", "store.php", "webhook.php"]
      .filter((file) => migrated && existsSync(path.join(generated, file)))
      .map((file) => [file, readFileSync(path.join(generated, file), "utf8")]),
  );
  let catalog: unknown[] = [];
  try {
    const value = JSON.parse(
      readFileSync(path.join(generated, "catalog.json"), "utf8"),
    );
    if (migrated && Array.isArray(value)) catalog = value;
  } catch {
    /* Missing or invalid catalog is a failed readiness check. */
  }
  const migratedFindings = scan(generatedFiles);
  const source = Object.values(generatedFiles).join("\n");
  const checked = getFlag("checked") === "true";
  return {
    mode: "replay",
    paymentMode: process.env.PAYPAL_MODE === "live" ? "live" : "replay",
    liveSandbox: parseLiveReport(getFlag("live-sandbox-report")),
    migratedFindings,
    migrated,
    fixed,
    running: getFlag("running") === "true",
    checked,
    findings,
    tasks: plan(findings, failed),
    results,
    merchants,
    products,
    checks: readiness(
      source,
      catalog,
      checked && results.every((r) => !r.differences.length),
    ),
    logs: sql.prepare("SELECT * FROM journal ORDER BY id DESC LIMIT 40").all(),
    canary: getFlag("canary") ? JSON.parse(getFlag("canary")) : null,
    configuration: {
      llm: !!process.env.OPENROUTER_API_KEY?.trim(),
      license: !!process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY,
      zapier: !!process.env.ZAPIER_WEBHOOK_URL,
    },
    diff:
      unifiedDiff(sourceFiles()["index.php"], migratedSource) +
      unifiedDiff(
        sourceFiles()["store.php"],
        sourceFiles()["store.php"].split("function nvp(")[0],
        "store.php",
      ) +
      unifiedDiff(sourceFiles()["ipn.php"], "", "ipn.php") +
      unifiedDiff("", webhookSource, "webhook.php") +
      unifiedDiff("", JSON.stringify(products, null, 2) + "\n", "catalog.json"),
  };
}
export type Snapshot = ReturnType<typeof snapshot>;
export async function notify(event: string) {
  if (!process.env.ZAPIER_WEBHOOK_URL) return;
  const u = new URL(process.env.ZAPIER_WEBHOOK_URL);
  if (u.protocol !== "https:") throw new Error("Zapier URL must use HTTPS");
  try {
    const r = await fetch(u, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        mode: "replay",
        evidence: "synthetic-replay",
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) log("Zapier delivery failed: " + r.status);
  } catch {
    log("Zapier delivery failed; local verification continues.");
  }
}
export function migrate() {
  const target = path.join(root, "workspace/migrated-shop");
  mkdirSync(target, { recursive: true });
  const sharedStore = sourceFiles()["store.php"].split("function nvp(")[0];
  writeFileSync(path.join(target, "store.php"), sharedStore);
  writeFileSync(path.join(target, "index.php"), migratedSource);
  writeFileSync(path.join(target, "webhook.php"), webhookSource);
  writeFileSync(
    path.join(target, "catalog.json"),
    JSON.stringify(products, null, 2),
  );
  writeFileSync(path.join(root, "workspace/migration.diff"), snapshot().diff);
  try {
    execFileSync("git", ["init", "-b", "codex/orders-v2"], {
      cwd: target,
      stdio: "ignore",
    });
    execFileSync("git", ["add", "."], { cwd: target, stdio: "ignore" });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Sundown",
        "-c",
        "user.email=sundown@localhost",
        "commit",
        "-m",
        "Migrate demo shop to sandbox Orders v2",
      ],
      { cwd: target, stdio: "ignore" },
    );
  } catch {
    log("Migration files written; git commit unavailable or already current.");
  }
  setFlag("migrated", "true");
  log(
    "Rewriter: Orders v2 shop, webhook verification source and catalog.json written; inspect the isolated branch.",
  );
}
export async function runParity() {
  if (getFlag("running") === "true") return;
  if (process.env.PAYPAL_MODE === "live")
    throw new Error(
      "Run pnpm live:sandbox in a terminal for the two browser-driven live scenarios. Four other scenarios remain Replay.",
    );
  setFlag("checked", "");
  setFlag("running", "true");
  try {
    log(
      "Verifier: replaying six synthetic transcripts (not recorded sandbox evidence).",
    );
    for (const f of fixtures()) {
      const r = executeFixture(f, getFlag("idempotent") === "true");
      log(
        `${f.label}: ${r.differences.length ? "FAIL · " + r.differences.map((d) => d.field).join(", ") : "PASS"}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 450));
      if (r.differences.length) {
        setFlag("failed", "true");
        log(
          "Planner: parity gate blocked; cutover tasks deferred two working days.",
        );
        await notify("parity failed");
        await new Promise((resolve) => setTimeout(resolve, 1800));
        setFlag("idempotent", "true");
        log(
          "Verifier iteration 1/3: apply event-id uniqueness to replay execution; rerun identical duplicate-callback fixture.",
        );
        if (executeFixture(f, true).differences.length)
          throw new Error("Repair did not establish parity");
        log("Duplicate callback: PASS after idempotency repair.");
      }
    }
    setFlag("checked", "true");
    log(
      "Parity complete: 6/6 replay scenarios match. Deferred cutover requires review.",
    );
    writeFileSync(
      path.join(root, "workspace/parity-report.json"),
      JSON.stringify(snapshot().results, null, 2),
    );
    if (getFlag("migrated") === "true") await notify("cutover ready");
  } finally {
    setFlag("running", "false");
  }
}
export async function simulateCanary() {
  const result = canary([0.01, 0.012, 0.009, 0.015, 0.08, 0.15, 0.22]);
  setFlag("canary", JSON.stringify(result));
  log(
    "Simulated traffic: error spike detected. Simulated rollback decision; no real routing changed.",
  );
  if (result.rollback) await notify("rollback");
}
