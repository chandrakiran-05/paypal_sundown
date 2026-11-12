import { timingSafeEqual } from "node:crypto";
import { adminCookie, validAdminSession } from "./admin-session";
import { workspacePassword, sharedAccessEnabled } from "./workspace-access";

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
  if (
    url.pathname === "/api/paypal/onboarding/return" &&
    request.method === "GET"
  )
    return null;
  if (
    url.pathname === "/onboarding/result" &&
    ["GET", "HEAD"].includes(request.method)
  )
    return null;
  if (
    ["/", "/demo", "/login"].includes(url.pathname) &&
    ["GET", "HEAD"].includes(request.method)
  )
    return null;
  if (url.pathname === "/api/webhooks" || url.pathname === "/api/health")
    return null;
  if (
    url.pathname === "/api/auth/login" &&
    ["POST", "DELETE"].includes(request.method)
  )
    return null;
  const password = env.SUNDOWN_ADMIN_PASSWORD;
  const browser =
    ["GET", "HEAD"].includes(request.method) &&
    !url.pathname.startsWith("/api/") &&
    request.headers.get("accept")?.includes("text/html");
  const loginRedirect = () =>
    new Response(null, {
      status: 303,
      headers: {
        Location: new URL("/login", url).href,
        "Cache-Control": "no-store",
      },
    });
  const token =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(adminCookie + "="))
      ?.slice(adminCookie.length + 1) || "";
  const sharedAuthenticated =
    sharedAccessEnabled(env) && validAdminSession(token, workspacePassword);
  if (!password && env.NODE_ENV !== "production") return null;
  if (!accessConfigured(env) && !sharedAuthenticated) {
    if (browser) return loginRedirect();
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
    !sharedAuthenticated &&
    !validAdminSession(token, password || "") &&
    (provided.length !== expected.length ||
      !timingSafeEqual(provided, expected))
  ) {
    if (browser) return loginRedirect();
    return new Response("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
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
