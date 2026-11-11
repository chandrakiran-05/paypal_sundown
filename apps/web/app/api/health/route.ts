import { getFlag } from "../../../lib/store";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    getFlag("migrated");
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
