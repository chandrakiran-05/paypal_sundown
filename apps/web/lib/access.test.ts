import { it, expect } from "vitest";
import { checkAccess } from "./access";
const env = {
  NODE_ENV: "production",
  SUNDOWN_ADMIN_PASSWORD: "test-password-123456",
  SUNDOWN_APP_URL: "https://sundown.example",
};
const request = (pathname = "/api/state", init: RequestInit = {}) =>
  new Request("https://sundown.example" + pathname, init);
const authorization =
  "Basic " +
  Buffer.from("sundown:" + env.SUNDOWN_ADMIN_PASSWORD).toString("base64");
it("serves the public static landing without exposing workspace APIs or mutations", () => {
  expect(checkAccess(request("/"), { NODE_ENV: "production" })).toBeNull();
  expect(checkAccess(request("/", { method: "HEAD" }), env)).toBeNull();
  expect(
    checkAccess(request("/", { method: "POST" }), { NODE_ENV: "production" })
      ?.status,
  ).toBe(503);
  expect(
    checkAccess(request("/api/state"), { NODE_ENV: "production" })?.status,
  ).toBe(503);
});
it("shows a setup page for browsers and preserves JSON errors for API clients", async () => {
  const response = checkAccess(
    request("/overview", { headers: { accept: "text/html" } }),
    { NODE_ENV: "production" },
  );
  expect(response?.status).toBe(503);
  expect(response?.headers.get("Content-Type")).toContain("text/html");
  expect(await response?.text()).toContain("Workspace setup required");
  expect(
    checkAccess(request(), { NODE_ENV: "production" })?.headers.get(
      "Content-Type",
    ),
  ).toContain("application/json");
});
it("fails closed in production, preserves development, and challenges unauthenticated clients", () => {
  expect(checkAccess(request(), { NODE_ENV: "production" })?.status).toBe(503);
  expect(checkAccess(request(), { NODE_ENV: "development" })).toBeNull();
  expect(checkAccess(request(), env)?.status).toBe(401);
  expect(
    checkAccess(request(), env)?.headers.get("WWW-Authenticate"),
  ).toContain("Basic");
  expect(
    checkAccess(request(), { ...env, SUNDOWN_ADMIN_PASSWORD: "short" })?.status,
  ).toBe(503);
  expect(checkAccess(request(), env)?.headers.get("Cache-Control")).toBe(
    "no-store",
  );
});
it("requires the correct password and rejects cross-origin mutations even with authentication", () => {
  expect(
    checkAccess(request("/api/state", { headers: { authorization } }), env),
  ).toBeNull();
  expect(
    checkAccess(
      request("/api/action", {
        method: "POST",
        headers: { authorization, origin: "https://evil.example" },
      }),
      env,
    )?.status,
  ).toBe(403);
  expect(
    checkAccess(
      request("/api/action", {
        method: "POST",
        headers: { authorization, origin: env.SUNDOWN_APP_URL },
      }),
      env,
    ),
  ).toBeNull();
  expect(
    checkAccess(
      request("/api/state", { headers: { authorization: "Basic invalid" } }),
      env,
    )?.status,
  ).toBe(401);
});
it("leaves signature-authenticated webhooks and minimal health checks reachable, not lookalike paths", () => {
  expect(checkAccess(request("/api/webhooks"), env)).toBeNull();
  expect(checkAccess(request("/api/health"), env)).toBeNull();
  expect(checkAccess(request("/api/webhooks/other"), env)?.status).toBe(401);
});
