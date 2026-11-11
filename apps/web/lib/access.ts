import { timingSafeEqual } from "node:crypto";

/** A single-operator workspace: protect evidence and mutations in production. */
export function checkAccess(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): Response | null {
  const url = new URL(request.url);
  if (url.pathname === "/api/webhooks" || url.pathname === "/api/health")
    return null;
  const password = env.SUNDOWN_ADMIN_PASSWORD;
  if (!password && env.NODE_ENV !== "production") return null;
  if (!password || password.length < 16)
    return Response.json(
      { error: "Production access is not configured" },
      { status: 503 },
    );
  const authorization = request.headers.get("authorization") || "";
  const provided = authorization.startsWith("Basic ")
    ? Buffer.from(authorization.slice(6), "base64")
    : Buffer.alloc(0);
  const expected = Buffer.from(`sundown:${password}`);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  )
    return new Response("Authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Sundown", charset="UTF-8"',
        "Cache-Control": "no-store",
      },
    });
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const allowed = new URL(env.SUNDOWN_APP_URL || request.url).origin;
    if (origin && origin !== allowed)
      return Response.json(
        { error: "Cross-origin mutation denied" },
        { status: 403 },
      );
  }
  return null;
}
