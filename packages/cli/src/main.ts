/** CLI shares the web verifier; failed and invalid runs still produce CI artifacts. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { verifyPassport } from "@sundown/engine/passport";
import {
  verifyScenarios,
  postmanCollection,
} from "@sundown/engine/verification";
function main() {
  const { values, positionals } = parseArgs({
    options: {
      fixtures: { type: "string", default: "fixtures" },
      output: { type: "string", default: "workspace/verify" },
      "base-url": { type: "string", default: "http://localhost:3000" },
      passport: { type: "string" },
      head: { type: "string" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(
      "sundown verify [--fixtures fixtures] [--output workspace/verify] [--base-url http://localhost:3000]\nsundown verify --passport passport.json [--head retained-sha256]\nCompares six required synthetic replay scenarios, or checks a passport hash chain. Exit 1 on regression or invalid evidence.",
    );
    return;
  }
  if (positionals.length !== 1 || positionals[0] !== "verify")
    throw new Error(
      "Usage: sundown verify [--fixtures directory] [--output directory]",
    );
  if (values.passport) {
    const valid = verifyPassport(
      JSON.parse(readFileSync(values.passport, "utf8")),
      values.head,
    );
    console.log(
      `${valid ? "PASS" : "FAIL"} / Passport ${values.head ? "retained-head verification" : "internal chain consistency (no retained head provided)"}`,
    );
    if (!valid) process.exitCode = 1;
    return;
  }
  if (values.head) throw new Error("--head requires --passport");
  const output = path.resolve(values.output);
  const fixturesPath = path.resolve(values.fixtures);
  if (output === fixturesPath || fixturesPath.startsWith(output + path.sep))
    throw new Error("Report directory must not contain the fixture directory");
  mkdirSync(output, { recursive: true });
  let report:
    | ReturnType<typeof verifyScenarios>
    | { passed: false; mode: "synthetic-replay"; error: string };
  try {
    const files = readdirSync(fixturesPath)
      .filter((f) => f.endsWith(".json"))
      .sort();
    report = verifyScenarios(
      files.map((f) =>
        JSON.parse(readFileSync(path.join(fixturesPath, f), "utf8")),
      ),
    );
  } catch (error) {
    report = {
      passed: false,
      mode: "synthetic-replay",
      error: error instanceof Error ? error.message : "Invalid evidence",
    };
  }
  writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  writeFileSync(
    path.join(output, "sundown.postman_collection.json"),
    JSON.stringify(postmanCollection(values["base-url"]), null, 2) + "\n",
  );
  const safe = JSON.stringify(report, null, 2)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;");
  writeFileSync(
    path.join(output, "report.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Sundown parity</title><h1>${report.passed ? "PASS" : "FAIL"} / Synthetic replay</h1><pre>${safe}</pre></html>`,
  );
  console.log(
    `${report.passed ? "PASS" : "FAIL"} / synthetic replay. Reports: ${output}`,
  );
  if (!report.passed) process.exitCode = 1;
}
try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Verification failed");
  process.exitCode = 1;
}
