/** Return persisted migration evidence. */
import { snapshot } from "../../../lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(snapshot());
}
