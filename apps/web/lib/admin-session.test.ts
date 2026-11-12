import { it, expect } from "vitest";
import {
  adminCookie,
  createAdminSession,
  validAdminSession,
  passwordMatches,
} from "./admin-session";
import { checkAccess } from "./access";
const password = "test-admin-password-1234";
it("rejects tampered, expired and password-rotated sessions", () => {
  const now = 1800000000000,
    token = createAdminSession(password, now);
  expect(validAdminSession(token, password, now)).toBe(true);
  expect(validAdminSession(token, password, now + 8 * 3600000)).toBe(false);
  expect(validAdminSession(token, "different-password", now)).toBe(false);
  expect(
    validAdminSession(
      token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"),
      password,
      now,
    ),
  ).toBe(false);
  expect(validAdminSession("malformed", password, now)).toBe(false);
  expect(passwordMatches(password, password)).toBe(true);
  expect(passwordMatches("wrong", password)).toBe(false);
});
it("allows signed website sessions but rejects unsigned cookies and cross-origin mutations", () => {
  const env = {
    NODE_ENV: "production",
    SUNDOWN_ADMIN_PASSWORD: password,
    SUNDOWN_APP_URL: "https://sundown.example",
  };
  const cookie = `${adminCookie}=${createAdminSession(password)}`;
  expect(
    checkAccess(
      new Request(env.SUNDOWN_APP_URL + "/api/state", { headers: { cookie } }),
      env,
    ),
  ).toBeNull();
  expect(
    checkAccess(
      new Request(env.SUNDOWN_APP_URL + "/api/state", {
        headers: { cookie: adminCookie + "=true" },
      }),
      env,
    )?.status,
  ).toBe(401);
  expect(
    checkAccess(
      new Request(env.SUNDOWN_APP_URL + "/api/action", {
        method: "POST",
        headers: { cookie, origin: "https://evil.example" },
      }),
      env,
    )?.status,
  ).toBe(403);
});
