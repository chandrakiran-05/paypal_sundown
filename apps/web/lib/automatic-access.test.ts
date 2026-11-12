import { afterEach, it, expect, vi } from "vitest";
import { proxy } from "../proxy";
import { adminCookie, validAdminSession } from "./admin-session";
import { sharedAccessEnabled, workspacePassword } from "./workspace-access";
afterEach(() => vi.unstubAllEnvs());
it("automatically enters the full showcase without an admin password", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SUNDOWN_ADMIN_PASSWORD", "");
  vi.stubEnv("SUNDOWN_SHARED_ACCESS", "");
  expect(sharedAccessEnabled({})).toBe(true);
  const response = proxy(
    new Request("https://sundown.example/overview", {
      headers: { accept: "text/html" },
    }),
  );
  expect(response.status).toBe(200);
  expect(
    proxy(
      new Request("https://sundown.example/", {
        headers: { accept: "text/html" },
      }),
    ).headers.has("set-cookie"),
  ).toBe(true);
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("SameSite=lax");
  expect(
    validAdminSession(
      cookie.split(";")[0].slice(adminCookie.length + 1),
      workspacePassword,
    ),
  ).toBe(true);
  expect(proxy(new Request("https://sundown.example/api/state")).status).toBe(
    503,
  );
  expect(
    proxy(
      new Request("https://sundown.example/api/action", {
        method: "POST",
        headers: {
          cookie: cookie.split(";")[0],
          origin: "https://evil.example",
        },
      }),
    ).status,
  ).toBe(403);
});
it("preserves private login when public access is explicitly disabled", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SUNDOWN_ADMIN_PASSWORD", "");
  vi.stubEnv("SUNDOWN_SHARED_ACCESS", "false");
  const response = proxy(
    new Request("https://sundown.example/overview", {
      headers: { accept: "text/html" },
    }),
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "https://sundown.example/login",
  );
  expect(response.headers.has("set-cookie")).toBe(false);
});
