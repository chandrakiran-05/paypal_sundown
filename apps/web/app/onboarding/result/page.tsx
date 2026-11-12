import Link from "next/link";
const results = {
  connected: {
    title: "You’re back from PayPal.",
    description:
      "The Sundown operator can review your server-verified connection status in the workspace. This return page alone does not confirm account readiness.",
  },
  pending: {
    title: "A few PayPal steps remain.",
    description:
      "Your return was received, but PayPal has not confirmed all account and permission requirements. Complete any remaining steps in PayPal, then ask the Sundown operator to refresh the connection.",
  },
  unavailable: {
    title: "Connection was not verified.",
    description:
      "Sundown could not verify this invitation with PayPal. No successful connection or payment is claimed. Ask your Sundown operator to review the connection and send a new invitation if needed.",
  },
  invalid: {
    title: "This invitation cannot be used.",
    description:
      "The return link is invalid, expired or already used. Ask the Sundown operator to review the invitation. Your PayPal account has not been marked connected by this return.",
  },
};
export default async function OnboardingResult({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const copy = results[status as keyof typeof results] || results.invalid;
  return (
    <main style={{ maxWidth: 680, margin: "12vh auto", padding: 28 }}>
      <Link href="/" className="brand">
        sundown.
      </Link>
      <p className="eyebrow" style={{ marginTop: 40 }}>
        PAYPAL SELLER ONBOARDING / SANDBOX
      </p>
      <h1 style={{ fontSize: "clamp(32px,5vw,52px)", margin: "18px 0" }}>
        {copy.title}
      </h1>
      <p className="muted" style={{ fontSize: 17, lineHeight: 1.8 }}>
        {copy.description}
      </p>
      <p className="muted">
        This confirms connection status only. It does not prove checkout
        migration, grant Store Sync access, or enable real-money payments.
      </p>
      <Link className="button secondary" href="/">
        Return to Sundown →
      </Link>
    </main>
  );
}
