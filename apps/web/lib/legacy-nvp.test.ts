/** Exercise the actual PHP transcript writer without making payment requests. */
import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
const local = path.resolve("workspace/tools/php/bin/php");
const binary = process.env.PHP_BINARY || (existsSync(local) ? local : "php");
let available = false;
try {
  available =
    execFileSync(
      binary,
      ["-r", "echo extension_loaded('pdo_sqlite') ? 'yes' : 'no';"],
      { stdio: ["ignore", "pipe", "ignore"] },
    ).toString() === "yes";
} catch {
  /* PHP is optional on credential-free CI. */
}
it.skipIf(!available)(
  "retains raw ACK/error fields for every NVP call and redacts credentials even inside error messages",
  () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sundown-nvp-"));
    try {
      const file = path.join(dir, "transcript.jsonl");
      const code = `require ${JSON.stringify(path.resolve("apps/legacy-shop/store.php"))}; foreach (['SetExpressCheckout','GetExpressCheckoutDetails','DoExpressCheckoutPayment'] as $method) recordNvp($method,200,['ACK'=>'Failure','L_ERRORCODE0'=>'10002','L_SHORTMESSAGE0'=>'Security error','L_LONGMESSAGE0'=>'Security header is not valid','L_ERRORCODE1'=>'10003','L_LONGMESSAGE1'=>'secret-user secret-password secret-signature','USER'=>'secret-user','PWD'=>'secret-password','SIGNATURE'=>'secret-signature','EMAIL'=>'buyer@example.invalid']);`;
      execFileSync(binary, ["-r", code], {
        env: {
          ...process.env,
          SHOP_DB: path.join(dir, "shop.sqlite"),
          SUNDOWN_NVP_TRANSCRIPT: file,
          PAYPAL_NVP_USER: "secret-user",
          PAYPAL_NVP_PWD: "secret-password",
          PAYPAL_NVP_SIGNATURE: "secret-signature",
        },
      });
      const raw = readFileSync(file, "utf8");
      const entries = raw
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(entries.map((e) => e.method)).toEqual([
        "SetExpressCheckout",
        "GetExpressCheckoutDetails",
        "DoExpressCheckoutPayment",
      ]);
      for (const entry of entries)
        expect(entry.response).toMatchObject({
          ACK: "Failure",
          L_ERRORCODE0: "10002",
          L_SHORTMESSAGE0: "Security error",
          L_LONGMESSAGE0: "Security header is not valid",
          L_ERRORCODE1: "10003",
          L_LONGMESSAGE1: "[REDACTED] [REDACTED] [REDACTED]",
        });
      for (const secret of [
        "secret-user",
        "secret-password",
        "secret-signature",
        "buyer@example.invalid",
      ])
        expect(raw).not.toContain(secret);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
