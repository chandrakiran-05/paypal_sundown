import { getFlag } from "../../../lib/store";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    getFlag("migrated");
    return Response.json(
      {
        status: "ok",
        demo: "available",
        adminConfigured: Boolean(
          process.env.SUNDOWN_ADMIN_PASSWORD &&
          process.env.SUNDOWN_ADMIN_PASSWORD.length >= 16,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
