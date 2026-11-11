/** Two real sandbox flows; the remaining fixtures stay explicitly Replay. No buyer secrets are recorded. */
import { randomUUID, createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { once } from "node:events";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { z } from "zod";
import { executeFixture } from "@sundown/engine";
import {
  evidenceLabel,
  liveReportSchema,
  parseLiveReport,
  type LiveReport,
  type SideEvidence,
} from "@sundown/engine/live-evidence";
import { root, fixtures, getFlag, setFlag, log, migrate } from "./store";
import { startShoppingAgent, finishShoppingAgent } from "./shopping-agent";
import { sandboxSettlement, shopOrder } from "./agent-shop";
import { refundCapture } from "./paypal";
import { claimed } from "./checkout-store";
import { openLiveWebhook } from "./live-webhook";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const missing = (keys: string[]) =>
  keys.filter((key) => !process.env[key]?.trim());
const currencyRejection =
  "PAYPAL_CURRENCY_REJECTED: PayPal sandbox says this seller does not accept payments in the buyer's currency. No approval or capture completed.";
const failure = (
  stage: string,
  code: string,
  message: string,
): SideEvidence => ({
  source: "not-run",
  status: "not-run",
  error: { stage, code, message },
});
const nvpEntrySchema = z.object({
  method: z.string(),
  httpStatus: z.number(),
  recordedAt: z.string(),
  source: z.literal("paypal-sandbox"),
  response: z.record(z.string(), z.string()),
});
export async function approveSandboxBuyer(
  page: Page,
  approvalUrl: string,
  returnOrigin: string,
  options: { manual?: boolean; timeoutMs?: number } = {},
) {
  const url = new URL(approvalUrl);
  if (
    url.protocol !== "https:" ||
    !(
      url.hostname === "sandbox.paypal.com" ||
      url.hostname.endsWith(".sandbox.paypal.com")
    )
  )
    throw new Error("Approval URL is not PayPal sandbox");
  if (options.manual) {
    // The operator owns login, challenges and the final approval. Never inspect
    // form values, fill credentials, or click PayPal controls in this mode.
    try {
      const token = url.searchParams.get("token");
      if (!token) throw new Error("Missing approval token");
      await page.goto(approvalUrl, { waitUntil: "domcontentloaded" });
      await page.bringToFront();
      const returnedToShop = page.waitForURL(
        (current) => {
          if (
            current.origin !== returnOrigin &&
            current.hostname !== "sandbox.paypal.com" &&
            !current.hostname.endsWith(".sandbox.paypal.com")
          )
            throw new Error("Approval left the PayPal sandbox");
          return current.origin === returnOrigin;
        },
        {
          timeout: options.timeoutMs ?? 15 * 60 * 1000,
          waitUntil: "domcontentloaded",
        },
      );
      const currencyRejected = page
        .getByText(/seller doesn.t accept payments in your currency/i)
        .first()
        .waitFor({
          state: "visible",
          timeout: options.timeoutMs ?? 15 * 60 * 1000,
        })
        .then(() => {
          throw new Error(currencyRejection);
        });
      await Promise.race([returnedToShop, currencyRejected]);
      const returned = new URL(page.url());
      if (
        returned.searchParams.get("action") === "cancel" ||
        returned.searchParams.has("cancelled")
      )
        throw new Error("MANUAL_APPROVAL_CANCELLED");
      if (returned.searchParams.get("token") !== token)
        throw new Error("MANUAL_APPROVAL_TOKEN_MISMATCH");
      // A return URL is only permission to attempt capture. The PayPal API
      // still has to accept capture, and a signed event must settle the DB.
      return;
    } catch (error) {
      if (error instanceof Error && error.message === currencyRejection)
        throw error;
      const code =
        error instanceof Error &&
        [
          "MANUAL_APPROVAL_CANCELLED",
          "MANUAL_APPROVAL_TOKEN_MISMATCH",
        ].includes(error.message)
          ? error.message
          : "MANUAL_APPROVAL_INCOMPLETE";
      throw new Error(
        `${code}: Manual sandbox approval did not complete. No approval or capture is claimed.`,
      );
    }
  }
  if (missing(["PAYPAL_BUYER_EMAIL", "PAYPAL_BUYER_PASSWORD"]).length)
    throw new Error(
      "Configure PAYPAL_BUYER_EMAIL and PAYPAL_BUYER_PASSWORD for Playwright approval",
    );
  try {
    await page.goto(approvalUrl, { waitUntil: "domcontentloaded" });
    const end = Date.now() + 120000;
    let emailSubmitted = false,
      passwordSubmitted = false;
    while (Date.now() < end) {
      const current = new URL(page.url());
      if (
        current.origin !== returnOrigin &&
        !(
          current.hostname === "sandbox.paypal.com" ||
          current.hostname.endsWith(".sandbox.paypal.com")
        )
      )
        throw new Error("Approval left the PayPal sandbox");
      if (new URL(page.url()).origin === returnOrigin) {
        if (
          new URL(page.url()).searchParams.get("action") === "cancel" ||
          new URL(page.url()).searchParams.has("cancelled")
        )
          throw new Error("Buyer cancelled");
        return;
      }
      for (const challenge of await page
        .locator('iframe[src*="captcha"], #captcha, #challenge')
        .all()) {
        if (await challenge.isVisible())
          throw new Error("PayPal requires a manual security challenge");
      }
      if (
        await page
          .getByText(/seller doesn.t accept payments in your currency/i)
          .first()
          .isVisible()
      )
        throw new Error(currencyRejection);
      const email = page
        .locator('input#email, input[name="login_email"]')
        .first();
      if (!emailSubmitted && (await email.isVisible())) {
        await email.fill(process.env.PAYPAL_BUYER_EMAIL!);
        const next = page.locator("#btnNext").first();
        if (await next.isVisible()) {
          await next.click();
          emailSubmitted = true;
        }
      }
      const password = page
        .locator('input#password, input[name="login_password"]')
        .first();
      if (await password.isVisible()) {
        if (!passwordSubmitted) {
          await password.fill(process.env.PAYPAL_BUYER_PASSWORD!);
          const login = page.locator("#btnLogin").first();
          if (await login.isVisible()) {
            await login.click();
            passwordSubmitted = true;
          }
        }
      } else {
        const login = page
          .getByRole("button", { name: /log in|sign in/i })
          .first();
        if (await login.isVisible()) await login.click();
      }
      const approve = page
        .getByRole("button", {
          name: /^(pay now|agree (&|and) pay|complete purchase|continue|agree (&|and) continue)$/i,
        })
        .first();
      if (await approve.isVisible()) await approve.click();
      await delay(500);
    }
    throw new Error("Approval timeout");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("PAYPAL_CURRENCY_REJECTED:")
    )
      throw error;
    // Playwright exception logs can contain form values. Persist only this safe diagnostic.
    throw new Error(
      "Sandbox buyer approval did not complete; check credentials or complete PayPal's security challenge manually. No approval or capture is claimed.",
    );
  }
}
async function startLegacyServer(directory: string) {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("No local legacy port");
  const port = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const base = `http://127.0.0.1:${port}/`,
    transcript = path.join(directory, "legacy-nvp.jsonl");
  const localPhp = path.join(root, "workspace/tools/php/bin/php");
  const binary =
    process.env.PHP_BINARY && process.env.PHP_BINARY !== "php"
      ? process.env.PHP_BINARY
      : existsSync(localPhp)
        ? localPhp
        : "php";
  const child = spawn(
    binary,
    ["-S", `127.0.0.1:${port}`, "-t", path.join(root, "apps/legacy-shop")],
    {
      env: {
        NODE_ENV: process.env.NODE_ENV || "development",
        PATH: process.env.PATH,
        PAYPAL_MODE: "live",
        PAYPAL_NVP_USER: process.env.PAYPAL_NVP_USER,
        PAYPAL_NVP_PWD: process.env.PAYPAL_NVP_PWD,
        PAYPAL_NVP_SIGNATURE: process.env.PAYPAL_NVP_SIGNATURE,
        SHOP_DB: path.join(directory, "legacy-orders.sqlite"),
        SHOP_BASE_URL: base,
        SUNDOWN_NVP_TRANSCRIPT: transcript,
      },
      stdio: "ignore",
    },
  );
  let processError = false;
  child.on("error", () => {
    processError = true;
  });
  for (let i = 0; i < 60; i++) {
    if (processError || child.exitCode !== null)
      throw new Error(
        "php -S could not start; install PHP with curl and pdo_sqlite or set PHP_BINARY",
      );
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(500) })).ok)
        return {
          base,
          child,
          transcript,
          database: path.join(directory, "legacy-orders.sqlite"),
        };
    } catch {
      /* Wait for this owned server. */
    }
    await delay(100);
  }
  child.kill();
  throw new Error("Legacy PHP server startup timed out");
}
function nvpEntries(file: string) {
  return existsSync(file)
    ? readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => nvpEntrySchema.parse(JSON.parse(line)))
    : [];
}
export async function runLiveSandbox(
  options: { manualApproval?: boolean; legacyOnly?: boolean } = {},
): Promise<LiveReport> {
  if (process.env.PAYPAL_MODE !== "live")
    throw new Error(
      "Set PAYPAL_MODE=live; every payment endpoint remains sandbox-only",
    );
  const previous = options.legacyOnly
    ? parseLiveReport(getFlag("live-sandbox-report") || "")
    : null;
  const runId = randomUUID(),
    directory = path.join(root, "workspace/live-sandbox", runId);
  mkdirSync(directory, { recursive: true });
  const report: LiveReport = {
    version: 1,
    runId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: "running",
    scenarios: fixtures().map((f) => {
      const replay = executeFixture(f, true),
        live = ["success", "refund"].includes(f.id);
      return {
        id: f.id,
        label: f.label,
        legacy: live
          ? failure("preflight", "NOT_RUN", "Waiting for live NVP execution")
          : {
              source: "synthetic-replay",
              status: "completed",
              outcome: replay.legacy,
            },
        migrated:
          options.legacyOnly && previous?.scenarios.find((s) => s.id === f.id)
            ? structuredClone(
                previous.scenarios.find((s) => s.id === f.id)!.migrated,
              )
            : live
              ? failure(
                  "preflight",
                  "NOT_RUN",
                  "Waiting for live Orders execution",
                )
              : {
                  source: "synthetic-replay",
                  status: "completed",
                  outcome: replay.migrated,
                },
      };
    }),
  };
  function persist() {
    for (const scenario of report.scenarios) {
      scenario.legacy.label = evidenceLabel(
        scenario.id,
        scenario.legacy,
        "legacy",
      );
      scenario.migrated.label = evidenceLabel(scenario.id, scenario.migrated);
    }
    const value = JSON.stringify(liveReportSchema.parse(report), null, 2);
    writeFileSync(path.join(directory, "report.tmp"), value, { mode: 0o600 });
    renameSync(
      path.join(directory, "report.tmp"),
      path.join(directory, "report.json"),
    );
    setFlag("live-sandbox-report", value);
  }
  persist();
  if (getFlag("migrated") !== "true") migrate();
  const executablePath =
    process.env.SUNDOWN_BROWSER_EXECUTABLE ||
    (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let legacy:
    | {
        base: string;
        child: ChildProcess;
        transcript: string;
        database: string;
      }
    | undefined;
  let webhook: Awaited<ReturnType<typeof openLiveWebhook>> | undefined;
  const previousHook = process.env.PAYPAL_WEBHOOK_ID;
  try {
    browser = await chromium.launch({
      executablePath,
      headless:
        !options.manualApproval && process.env.SUNDOWN_HEADED !== "true",
    });
    try {
      legacy = await startLegacyServer(directory);
      log("Live harness: legacy shop started with php -S on a loopback port.");
    } catch (error) {
      for (const s of report.scenarios.filter((s) =>
        ["success", "refund"].includes(s.id),
      ))
        s.legacy = failure(
          "php -S",
          "PHP_UNAVAILABLE",
          error instanceof Error ? error.message : "PHP unavailable",
        );
    }
    for (const scenario of report.scenarios.filter((s) =>
      ["success", "refund"].includes(s.id),
    )) {
      if (!legacy) break;
      const absent = missing([
        "PAYPAL_NVP_USER",
        "PAYPAL_NVP_PWD",
        "PAYPAL_NVP_SIGNATURE",
      ]);
      if (absent.length) {
        scenario.legacy = failure(
          "NVP configuration",
          "MISSING_NVP_CREDENTIALS",
          `Missing ${absent.join(", ")}. REST credentials cannot be used for NVP; no PayPal rejection is invented.`,
        );
        persist();
        continue;
      }
      const before = nvpEntries(legacy.transcript).length,
        context = await browser.newContext(),
        page = await context.newPage();
      try {
        await page.goto(legacy.base);
        await page
          .getByRole("button", { name: "Add to cart", exact: true })
          .first()
          .click();
        await page
          .getByRole("link", {
            name: "Checkout with PayPal sandbox →",
            exact: true,
          })
          .click();
        await page.waitForLoadState("domcontentloaded");
        const rejected = nvpEntries(legacy.transcript)
          .slice(before)
          .find(
            (e) => !["Success", "SuccessWithWarning"].includes(e.response.ACK),
          );
        if (!rejected) {
          const token = nvpEntries(legacy.transcript)
            .slice(before)
            .find((entry) => entry.method === "SetExpressCheckout")
            ?.response.TOKEN;
          if (!token) throw new Error("NVP did not return an approval token");
          if (options.manualApproval)
            console.log(
              `Manual legacy approval: ${scenario.id}. Approve the NVP sandbox checkout in Chrome within 15 minutes; GetExpressCheckoutDetails and DoExpressCheckoutPayment run only after your return.`,
            );
          await approveSandboxBuyer(
            page,
            `https://www.sandbox.paypal.com/cgi-bin/webscr?cmd=_express-checkout&token=${encodeURIComponent(token)}`,
            new URL(legacy.base).origin,
            { manual: options.manualApproval },
          );
        }
        let entries = nvpEntries(legacy.transcript).slice(before);
        const payment = entries.find(
          (e) =>
            e.method === "DoExpressCheckoutPayment" &&
            ["Success", "SuccessWithWarning"].includes(e.response.ACK),
        );
        if (payment && scenario.id === "refund") {
          await context.request.post(legacy.base + "?action=refund", {
            form: { id: payment.response.PAYMENTINFO_0_TRANSACTIONID },
          });
          entries = nvpEntries(legacy.transcript).slice(before);
        }
        const refused = entries.find(
          (e) => !["Success", "SuccessWithWarning"].includes(e.response.ACK),
        );
        const recordingFile = path.join(
          directory,
          `legacy-${scenario.id}.json`,
        );
        writeFileSync(recordingFile, JSON.stringify(entries, null, 2), {
          mode: 0o600,
        });
        const recorded = z
          .array(nvpEntrySchema)
          .parse(JSON.parse(readFileSync(recordingFile, "utf8")));
        if (refused) {
          const error = recorded.find(
            (e) =>
              e.method === refused.method &&
              e.recordedAt === refused.recordedAt,
          )!;
          scenario.legacy = {
            source: "recorded-transcript",
            status: "failed",
            ...(payment?.response.PAYMENTINFO_0_TRANSACTIONID
              ? {
                  captureId: payment.response.PAYMENTINFO_0_TRANSACTIONID,
                  buyerApproved: true,
                }
              : {}),
            recording: {
              path: path.relative(root, recordingFile),
              sha256: createHash("sha256")
                .update(readFileSync(recordingFile))
                .digest("hex"),
              recordedAt: new Date(error.recordedAt).toISOString(),
            },
            error: {
              stage: error.method,
              code: error.response.L_ERRORCODE0 || "NVP_TRANSPORT",
              message:
                error.response.L_LONGMESSAGE0 ||
                error.response.L_SHORTMESSAGE0 ||
                error.response.TRANSPORT_ERROR ||
                "NVP rejected the request",
              httpStatus: error.httpStatus,
              correlationId: error.response.CORRELATIONID,
            },
          };
        } else {
          const refund = recorded.find((e) => e.method === "RefundTransaction");
          if (
            !payment?.response.PAYMENTINFO_0_TRANSACTIONID ||
            (scenario.id === "refund" && !refund?.response.REFUNDTRANSACTIONID)
          )
            throw new Error("Legacy approval or transaction did not complete");
          scenario.legacy = {
            source: "paypal-sandbox",
            status: "pending",
            captureId: payment.response.PAYMENTINFO_0_TRANSACTIONID,
            buyerApproved: true,
            ...(refund?.response.REFUNDTRANSACTIONID
              ? { refundId: refund.response.REFUNDTRANSACTIONID }
              : {}),
          };
          persist();
          const database = new DatabaseSync(legacy.database, {
            readOnly: true,
          });
          const row = database
            .prepare("SELECT amount,status FROM orders WHERE id=?")
            .get(payment.response.PAYMENTINFO_0_TRANSACTIONID);
          database.close();
          if (!row || row.amount !== "24.00" || row.status !== "COMPLETED")
            throw new Error(
              "Legacy shop DB did not persist the matching payment",
            );
          scenario.legacy = {
            source: "paypal-sandbox",
            status:
              payment.response.PAYMENTINFO_0_PAYMENTSTATUS === "Completed" &&
              refund?.response.REFUNDSTATUS !== "Pending"
                ? "completed"
                : "pending",
            captureId: payment.response.PAYMENTINFO_0_TRANSACTIONID,
            refundId: refund?.response.REFUNDTRANSACTIONID,
            buyerApproved: true,
            outcome: {
              amount:
                scenario.id === "refund"
                  ? z
                      .string()
                      .regex(/^\d+\.\d{2}$/)
                      .parse(refund?.response.GROSSREFUNDAMT)
                  : String(row.amount),
              currency: "USD",
              status:
                scenario.id === "refund" ? "PARTIALLY_REFUNDED" : "COMPLETED",
              transitions: [
                "CREATED",
                "COMPLETED",
                ...(scenario.id === "refund" ? ["PARTIALLY_REFUNDED"] : []),
              ],
              dbRows: 1,
              notifications: [],
            },
          };
          if (scenario.legacy.status !== "completed")
            delete scenario.legacy.outcome;
        }
      } catch (error) {
        scenario.legacy = {
          ...scenario.legacy,
          source: "paypal-sandbox",
          status: "failed",
          error: {
            stage: "legacy checkout",
            code: "NVP_FLOW_INCOMPLETE",
            message:
              error instanceof Error &&
              /^(MANUAL_APPROVAL_|PAYPAL_CURRENCY_REJECTED:)/.test(
                error.message,
              )
                ? error.message
                : "Legacy flow did not complete. Check buyer configuration and the retained NVP transcript; no replay success is fabricated.",
          },
        };
      } finally {
        // Retain every attempted call even when approval/transport fails before
        // the normal transcript-readback path. Never invent unexecuted calls.
        const entries = nvpEntries(legacy.transcript).slice(before);
        const recordingFile = path.join(
          directory,
          `legacy-${scenario.id}.json`,
        );
        writeFileSync(recordingFile, JSON.stringify(entries, null, 2), {
          mode: 0o600,
        });
        if (entries.length)
          scenario.legacy.recording = {
            path: path.relative(root, recordingFile),
            sha256: createHash("sha256")
              .update(readFileSync(recordingFile))
              .digest("hex"),
            recordedAt: new Date(
              entries[entries.length - 1].recordedAt,
            ).toISOString(),
          };
        await context.close().catch(() => {});
        persist();
      }
    }
    if (options.legacyOnly) return report;
    const absent = missing(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);
    if (!absent.length) {
      try {
        webhook = await openLiveWebhook();
        process.env.PAYPAL_WEBHOOK_ID = webhook.id;
      } catch (error) {
        for (const s of report.scenarios.filter((s) =>
          ["success", "refund"].includes(s.id),
        ))
          s.migrated = failure(
            "webhook setup",
            "WEBHOOK_UNAVAILABLE",
            error instanceof Error ? error.message : "Webhook setup failed",
          );
      }
    } else
      for (const s of report.scenarios.filter((s) =>
        ["success", "refund"].includes(s.id),
      ))
        s.migrated = failure(
          "REST configuration",
          "MISSING_REST_CREDENTIALS",
          `Missing ${absent.join(", ")}`,
        );
    if (webhook)
      for (const scenario of report.scenarios.filter((s) =>
        ["success", "refund"].includes(s.id),
      )) {
        const owner = randomUUID(),
          context = await browser.newContext(),
          page = await context.newPage();
        const side: SideEvidence = {
          source: "paypal-sandbox",
          status: "pending",
        };
        scenario.migrated = side;
        try {
          const origin = new URL(
            process.env.SUNDOWN_APP_URL || "http://localhost:3000",
          ).origin;
          const created = await startShoppingAgent(
            owner,
            "sandbox",
            randomUUID(),
            origin,
          );
          side.orderId = created.order.id;
          persist();
          if (!created.order.approval_url)
            throw new Error("Sandbox did not return approval URL");
          if (options.manualApproval)
            console.log(
              `Manual approval: ${scenario.id}, sandbox order ${side.orderId}. Log in and approve in the Chrome window within 15 minutes. Capture and any partial refund resume automatically after PayPal returns.`,
            );
          await approveSandboxBuyer(page, created.order.approval_url, origin, {
            manual: options.manualApproval,
          });
          side.buyerApproved = true;
          persist();
          const captured = await finishShoppingAgent(created.order.id, owner);
          side.captureId = captured.capture_id ?? undefined;
          persist();
          console.log(
            `${scenario.id}: capture ${side.captureId || "not completed"}; waiting for the real verified webhook.`,
          );
          const deadline = Date.now() + 300000;
          while (
            Date.now() < deadline &&
            shopOrder(created.order.id, owner).status !== "PAID"
          )
            await delay(500);
          const receipt = sandboxSettlement(created.order.id);
          side.settled = shopOrder(created.order.id, owner).status === "PAID";
          side.webhookVerified = Boolean(receipt);
          side.webhookEventId = receipt?.eventId;
          persist();
          if (!side.settled || !side.webhookVerified)
            throw new Error(
              "Capture recorded, but a real verified completion webhook has not settled the shop DB",
            );
          if (scenario.id === "refund") {
            if (!side.captureId) throw new Error("Missing real capture ID");
            const refunded = await claimed(
              `live-refund:${created.order.id}`,
              "12.00",
              randomUUID(),
              (requestId) => refundCapture(side.captureId!, requestId, "12.00"),
            );
            side.refundId = refunded.id;
            persist();
            console.log(
              `${scenario.id}: refund ${side.refundId || "not completed"}.`,
            );
            if (!refunded.id || String(refunded.status) !== "COMPLETED")
              throw new Error(
                "Partial refund is pending or failed; its ID is retained",
              );
          }
          side.status = "completed";
          console.log(
            `${scenario.id}: verified event ${side.webhookEventId}; shop DB settled PAID.`,
          );
          side.outcome = {
            amount: scenario.id === "refund" ? "12.00" : "24.00",
            currency: "USD",
            status:
              scenario.id === "refund" ? "PARTIALLY_REFUNDED" : "COMPLETED",
            transitions: [
              "CREATED",
              "COMPLETED",
              ...(scenario.id === "refund" ? ["PARTIALLY_REFUNDED"] : []),
            ],
            dbRows: 1,
            notifications: ["captured"],
          };
        } catch (error) {
          side.status = "failed";
          side.error = {
            stage: side.captureId
              ? "settlement/refund"
              : side.orderId
                ? "approval/capture"
                : "create",
            code:
              error instanceof Error &&
              error.message.startsWith("PAYPAL_CURRENCY_REJECTED:")
                ? "PAYPAL_CURRENCY_REJECTED"
                : "SANDBOX_INCOMPLETE",
            message:
              error instanceof Error ? error.message : "Sandbox step failed",
          };
        } finally {
          await context.close().catch(() => {});
          persist();
        }
      }
  } catch (error) {
    for (const scenario of report.scenarios.filter((s) =>
      ["success", "refund"].includes(s.id),
    ))
      if (
        scenario.migrated.source === "not-run" &&
        scenario.migrated.error?.code === "NOT_RUN"
      )
        scenario.migrated = failure(
          "browser setup",
          "HARNESS_UNAVAILABLE",
          error instanceof Error
            ? error.message.split("\n")[0]
            : "Browser unavailable",
        );
  } finally {
    legacy?.child.kill("SIGTERM");
    await browser?.close();
    await webhook?.close();
    if (previousHook === undefined) delete process.env.PAYPAL_WEBHOOK_ID;
    else process.env.PAYPAL_WEBHOOK_ID = previousHook;
    report.completedAt = new Date().toISOString();
    report.status = report.scenarios
      .filter((s) => ["success", "refund"].includes(s.id))
      .every(
        (s) =>
          evidenceLabel(s.id, s.migrated) === "Live sandbox" &&
          (evidenceLabel(s.id, s.legacy, "legacy") === "Live sandbox" ||
            (s.legacy.source === "recorded-transcript" &&
              Boolean(s.legacy.recording))),
      )
      ? "completed"
      : "incomplete";
    persist();
    log(
      `Live sandbox run ${report.status}; real IDs and provenance retained in ${path.relative(root, directory)}/report.json`,
    );
    const { createPassport } = await import("./passports");
    createPassport(1);
  }
  return report;
}
