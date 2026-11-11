/** Read secrets only from ignored environment files; .env.example is never a credential source. */
import dotenv from "dotenv";
import path from "node:path";
const projectRoot = process.env.SUNDOWN_ROOT || process.cwd();
dotenv.config({
  path: path.join(projectRoot, "apps/web/.env.local"),
  quiet: true,
});
dotenv.config({ path: path.join(projectRoot, ".env.local"), quiet: true });
const { runLiveSandbox } = await import("../apps/web/lib/live-sandbox");
const report = await runLiveSandbox({
  manualApproval: process.argv.includes("--headed"),
  legacyOnly: process.argv.includes("--legacy-only"),
});
console.log(
  `Sandbox harness: ${report.status}. Report: workspace/live-sandbox/${report.runId}/report.json`,
);
for (const scenario of report.scenarios.filter((s) =>
  ["success", "refund"].includes(s.id),
))
  console.log(
    `${scenario.id}: migrated=${scenario.migrated.status}; legacy=${scenario.legacy.label}${scenario.legacy.error ? "; " + scenario.legacy.error.message : ""}`,
  );
if (report.status !== "completed") process.exitCode = 1;
