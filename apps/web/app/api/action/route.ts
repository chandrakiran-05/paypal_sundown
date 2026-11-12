/** Validate and execute supported workspace actions. */
import { z } from "zod";
import {
  migrate,
  runParity,
  simulateCanary,
  log,
  setFlag,
  getFlag,
} from "../../../lib/store";
export async function POST(request: Request) {
  try {
    const { action } = z
      .object({
        action: z.enum(["migrate", "parity", "replay", "canary", "reset"]),
      })
      .parse(await request.json());
    if (action === "migrate") migrate();
    if (action === "parity") await runParity();
    if (action === "replay") await runParity({ allowInLive: true });
    if (action === "canary") await simulateCanary();
    if (action === "reset") {
      if (getFlag("running") === "true")
        return Response.json(
          { error: "Wait for the active parity run before resetting." },
          { status: 409 },
        );
      for (const k of [
        "migrated",
        "idempotent",
        "failed",
        "checked",
        "canary",
        "running",
      ])
        setFlag(k, "");
      log("Demo reset. Existing reports retained in workspace.");
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Action failed" },
      { status: 400 },
    );
  }
}
