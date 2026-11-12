import { getFlag } from "../../../lib/store";
import { accessConfigured } from "../../../lib/access";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    if (!accessConfigured())
      return Response.json(
        {
          status: "unavailable",
          reason: "Production access is not configured",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    getFlag("migrated");
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
