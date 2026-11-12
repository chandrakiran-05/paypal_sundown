import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
const require = createRequire(import.meta.url),
  origin = "http://127.0.0.1:3004";
const password = randomBytes(32).toString("hex");
const child = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "start",
    "apps/web",
    "--hostname",
    "127.0.0.1",
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "3004",
      SUNDOWN_ADMIN_PASSWORD: password,
      SUNDOWN_APP_URL: origin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (chunk) => {
    logs = (logs + chunk).slice(-30000);
  });
const headers = {
  authorization:
    "Basic " + Buffer.from("sundown:" + password).toString("base64"),
};
const results = [];
const check = async (
  route,
  expected = 200,
  options = {},
  authenticated = true,
) => {
  const response = await fetch(origin + route, {
    ...options,
    headers: { ...(authenticated ? headers : {}), ...options.headers },
    signal: AbortSignal.timeout(20000),
  });
  results.push({
    route,
    status: response.status,
    expected,
    pass: response.status === expected,
  });
  return response;
};
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  for (const route of [
    "/",
    "/overview",
    "/plan",
    "/parity",
    "/readiness",
    "/portfolio",
    "/agent-demo",
    "/passport",
    "/checkout",
    ...Array.from({ length: 12 }, (_, i) => "/passport/" + (i + 1)),
  ])
    await check(route);
  await check("/overview", 401, {}, false);
  await check("/api/state", 401, {}, false);
  await check("/api/health", 200, {}, false);
  const state = await (await check("/api/state")).json();
  await check("/api/shopping-agent");
  const passport = await (await check("/api/passports/1?format=json")).json();
  await check("/api/passports/1?format=pdf");
  for (const format of ["json", "html", "postman"])
    await check("/api/export?format=" + format);
  await check("/api/action", 403, {
    method: "POST",
    headers: {
      origin: "https://outside.invalid",
      "content-type": "application/json",
    },
    body: '{"action":"reset"}',
  });
  await check("/api/webhooks", 400, { method: "POST", body: "{" }, false);
  await check(
    "/api/webhooks",
    400,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "INVALID",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
      }),
    },
    false,
  );
  const stream = await fetch(origin + "/api/events", {
    headers,
    signal: AbortSignal.timeout(5000),
  });
  const reader = stream.body.getReader();
  const message = await reader.read();
  await reader.cancel();
  let runtimeRssMiB = null;
  try {
    runtimeRssMiB =
      Number(
        execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], {
          encoding: "utf8",
        }).trim(),
      ) / 1024;
  } catch {
    /* Memory sampling is optional on platforms without ps. */
  }
  const result = {
    runtimeRssMiB,
    checks: results,
    passed: results.every((r) => r.pass),
    streamReceived: !!message.value?.length,
    paymentMode: state.paymentMode,
    replayMode: state.mode,
    liveScenarios: state.liveSandbox?.scenarios
      .filter((s) => ["success", "refund"].includes(s.id))
      .map((s) => ({
        id: s.id,
        legacy: s.legacy.label,
        migrated: s.migrated.label,
        capture: s.migrated.captureId,
      })),
    passportNeutralEvents: passport.payload.parity.scenarios
      .filter((s) => s.notComparable?.length)
      .map((s) => s.id),
    logs,
  };
  fs.writeFileSync(
    "workspace/production-validation.json",
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ ...result, logs: undefined }));
  if (!result.passed) process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
}
