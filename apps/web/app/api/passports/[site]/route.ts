import { z } from "zod";
import { createPassport, loadPassport } from "../../../../lib/passports";
import { passportPdf } from "../../../../lib/passport-pdf";
import {
  passportSettingsSchema,
  verifyPassport,
} from "@sundown/engine/passport";
type Context = { params: Promise<{ site: string }> };
export const dynamic = "force-dynamic";
const siteId = (site: string) =>
  z.coerce.number().int().min(1).max(12).parse(site);
export async function GET(request: Request, { params }: Context) {
  try {
    const id = siteId((await params).site),
      passport = loadPassport(id);
    if (!verifyPassport(passport))
      throw new Error("Passport integrity check failed");
    const format = new URL(request.url).searchParams.get("format");
    const headers = {
      "Content-Disposition": `attachment; filename="sundown-passport-${id}.${format === "pdf" ? "pdf" : "json"}"`,
      "Cache-Control": "no-store",
    };
    if (format === "pdf")
      return new Response(Buffer.from(await passportPdf(passport)), {
        headers: { ...headers, "Content-Type": "application/pdf" },
      });
    return Response.json(passport, { headers });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Passport unavailable",
      },
      { status: error instanceof z.ZodError ? 404 : 409 },
    );
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const id = siteId((await params).site);
    const settings = passportSettingsSchema.parse(await request.json());
    return Response.json(createPassport(id, settings));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? "Invalid site, estimate inputs or merchant date"
            : "Could not issue passport",
      },
      { status: 400 },
    );
  }
}
