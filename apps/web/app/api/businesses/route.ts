/** Operator-only partner connections; the production proxy protects this route. */
import { z } from "zod";
import {
  createBusinessConnection,
  listBusinesses,
  partnerSetup,
  PartnerOnboardingError,
  verifyBusinessConnection,
  resumeBusinessConnection,
} from "../../../lib/partner-onboarding";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(
    { setup: partnerSetup(), businesses: listBusinesses() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
const command = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      name: z.string(),
      requestId: z.uuid(),
      consent: z.literal(true),
    })
    .strict(),
  z.object({ action: z.literal("verify"), id: z.uuid() }).strict(),
  z.object({ action: z.literal("resume"), id: z.uuid() }).strict(),
]);
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 8192)
      return Response.json(
        { error: "Business request too large" },
        { status: 413 },
      );
    const data = command.parse(JSON.parse(raw));
    if (data.action === "verify")
      return Response.json({
        business: await verifyBusinessConnection(data.id),
      });
    if (data.action === "resume")
      return Response.json(await resumeBusinessConnection(data.id));
    return Response.json(
      await createBusinessConnection({
        name: data.name,
        requestId: data.requestId,
        consent: data.consent,
      }),
    );
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json(
        {
          code: "INVALID_INPUT",
          error:
            "Enter a business name and explicitly consent to sharing it with PayPal.",
        },
        { status: 400 },
      );
    const failure =
      error instanceof PartnerOnboardingError
        ? error
        : new PartnerOnboardingError(
            "ONBOARDING_UNAVAILABLE",
            "Partner onboarding is unavailable. No connection has been verified.",
            502,
          );
    return Response.json(
      {
        code: failure.code,
        error: failure.message,
        ...(failure.debugId ? { debugId: failure.debugId } : {}),
        setup: partnerSetup(),
      },
      { status: failure.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
