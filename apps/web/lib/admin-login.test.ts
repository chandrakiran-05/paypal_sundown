import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { workspacePassword } from "./workspace-access";
import { adminCookie, validAdminSession } from "./admin-session";
const testRoot = mkdtempSync(path.join(tmpdir(), "sundown-login-"));
vi.mock("./store", () => ({ root: testRoot }));
let api: typeof import("../app/api/auth/login/route");
const password = "test-password-at-least-16";
const request = (value: unknown, origin = "https://sundown.example") =>
  new Request("https://sundown.example/api/auth/login", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(value),
  });
beforeAll(async () => {
  mkdirSync(path.join(testRoot, "workspace"));
  vi.stubEnv("SUNDOWN_ADMIN_PASSWORD", password);
  vi.stubEnv("SUNDOWN_SHARED_ACCESS", "true");
  vi.stubEnv("SUNDOWN_APP_URL", "https://sundown.example");
  api = await import("../app/api/auth/login/route");
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(testRoot, { recursive: true, force: true });
});
it("issues a secure signed session through the website form and expires it on logout", async () => {
  const response = await api.POST(request({ password }));
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("Secure");
  expect(cookie).not.toContain(password);
  expect(
    validAdminSession(
      cookie.split(";")[0].slice(adminCookie.length + 1),
      password,
    ),
  ).toBe(true);
  expect(api.DELETE(request({})).headers.get("set-cookie")).toContain(
    "Max-Age=0",
  );
});
it("rejects incorrect passwords, malformed input and foreign origins", async () => {
  expect(
    (await api.POST(request({ password }, "https://evil.example"))).status,
  ).toBe(403);
  expect((await api.POST(request({ password: 123 }))).status).toBe(400);
  expect((await api.POST(request({ password: "x".repeat(5000) }))).status).toBe(
    413,
  );
  vi.stubEnv("SUNDOWN_ADMIN_PASSWORD", "");
  expect((await api.POST(request({ password }))).status).toBe(401);
  const judge = await api.POST(request({ password: workspacePassword }));
  expect(judge.status).toBe(200);
  expect(
    validAdminSession(
      judge.headers
        .get("set-cookie")!
        .split(";")[0]
        .slice(adminCookie.length + 1),
      workspacePassword,
    ),
  ).toBe(true);
  vi.stubEnv("SUNDOWN_ADMIN_PASSWORD", password);
});
it("rate limits repeated incorrect passwords without browser authentication challenges", async () => {
  for (let i = 0; i < 10; i++) {
    const response = await api.POST(request({ password: "wrong" }));
    expect(response.status).toBe(401);
    expect(response.headers.has("WWW-Authenticate")).toBe(false);
  }
  const response = await api.POST(request({ password }));
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
});
