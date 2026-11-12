import { afterEach, it, expect, vi } from "vitest";
vi.mock("./store", () => ({ getFlag: vi.fn(() => "") }));
import { getFlag } from "./store";
import { GET } from "../app/api/health/route";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(getFlag).mockReset();
});
it("does not declare a production deployment ready without valid access configuration", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SUNDOWN_ADMIN_PASSWORD", "");
  expect(GET().status).toBe(503);
  expect(getFlag).not.toHaveBeenCalled();
  vi.stubEnv("SUNDOWN_ADMIN_PASSWORD", "short");
  expect(GET().status).toBe(503);
  vi.stubEnv("SUNDOWN_ADMIN_PASSWORD", "long-test-password-1234");
  expect(GET().status).toBe(200);
});
it("returns unavailable on database failure without exposing internal errors", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SUNDOWN_ADMIN_PASSWORD", "long-test-password-1234");
  vi.mocked(getFlag).mockImplementation(() => {
    throw new Error("private path and internal SQL error");
  });
  const response = GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "unavailable" });
});
