import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./store", () => ({ snapshot: vi.fn(() => ({ checked: true })) }));
import { snapshot } from "./store";
import { GET } from "../app/api/events/route";
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(snapshot).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});
it("stops polling when the client cancels its stream", async () => {
  const response = GET(new Request("http://localhost/api/events"));
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  vi.advanceTimersByTime(5000);
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("does not start polling for an already-aborted request", async () => {
  const controller = new AbortController();
  controller.abort();
  const response = GET(
    new Request("http://localhost/api/events", { signal: controller.signal }),
  );
  expect((await response.body!.getReader().read()).done).toBe(true);
  expect(snapshot).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
