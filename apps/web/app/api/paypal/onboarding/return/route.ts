/** Public PayPal return: one-time signed state plus server-to-server merchant verification. */
import {
  completePartnerOnboarding,
  onboardingResultOrigin,
  PartnerOnboardingError,
} from "../../../../../lib/partner-onboarding";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let status: "connected" | "pending" | "unavailable" | "invalid";
  try {
    status = await completePartnerOnboarding(new URL(request.url));
  } catch (error) {
    status =
      error instanceof PartnerOnboardingError &&
      error.code === "INVALID_CALLBACK"
        ? "invalid"
        : "unavailable";
  }
  let origin: string;
  try {
    origin = onboardingResultOrigin();
  } catch {
    return Response.json(
      {
        status: "unavailable",
        error: "Onboarding callback origin is not configured",
      },
      { status: 503 },
    );
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: origin + "/onboarding/result?status=" + status,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
