import { timingSafeEqual } from "node:crypto";

export function accessConfigured(
  env: Record<string, string | undefined> = process.env,
) {
  const password = env.SUNDOWN_ADMIN_PASSWORD;
  return (
    (!password && env.NODE_ENV !== "production") ||
    Boolean(password && password.length >= 16)
  );
}

/** A single-operator workspace: protect evidence and mutations in production. */
export function checkAccess(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): Response | null {
  const url = new URL(request.url);
  if (url.pathname === "/" && ["GET", "HEAD"].includes(request.method))
    return null;
  if (url.pathname === "/api/webhooks" || url.pathname === "/api/health")
    return null;
  const password = env.SUNDOWN_ADMIN_PASSWORD;
  if (!password && env.NODE_ENV !== "production") return null;
  if (!accessConfigured(env)) {
    if (request.headers.get("accept")?.includes("text/html"))
      return new Response(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sundown — workspace setup required</title><body style="background:#101710;color:#e6ebdf;font:18px system-ui;max-width:640px;margin:12vh auto;padding:24px"><h1>Workspace setup required</h1><p>The server is running. Its administrator needs to configure production access in the hosting environment before the workspace can open.</p><p>Set SUNDOWN_ADMIN_PASSWORD to at least 16 characters, then redeploy. Never commit the password to Git.</p><a href="/" style="color:#eca16f">Return to Sundown</a></body></html>',
        {
          status: 503,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Retry-After": "60",
          },
        },
      );
    return Response.json(
      { error: "Production access is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
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
