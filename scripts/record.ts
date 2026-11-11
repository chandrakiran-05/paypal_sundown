/** Recording refuses synthetic data; live approval automation must supply real transcripts. */
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
const url = process.env.LIVE_PARITY_REPORT_URL;
if (process.env.PAYPAL_MODE !== "live" || !url)
  throw new Error(
    "Recording needs PAYPAL_MODE=live and LIVE_PARITY_REPORT_URL from your sandbox parity harness. No fixture has been relabelled.",
  );
const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error("Sandbox harness failed");
const body = z
  .object({
    mode: z.literal("live"),
    scenarios: z
      .array(
        z.object({
          id: z.string(),
          legacy: z.unknown(),
          migrated: z.unknown(),
          sandboxOrderId: z.string().min(1),
        }),
      )
      .length(6),
  })
  .parse(await response.json());
mkdirSync("workspace/recordings", { recursive: true });
writeFileSync(
  "workspace/recordings/" + Date.now() + ".json",
  JSON.stringify(body, null, 2),
);
console.log(
  "Saved live harness report. Inspect provenance before using it as proof.",
);
