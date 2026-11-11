/** Sandbox approval must ignore hidden CAPTCHA infrastructure and stop on visible challenges. */
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "playwright";
let root: string, approve: typeof import("./live-sandbox").approveSandboxBuyer;
beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "sundown-approval-"));
  vi.stubEnv("SUNDOWN_ROOT", root);
  vi.stubEnv("PAYPAL_BUYER_EMAIL", "buyer@example.invalid");
  vi.stubEnv("PAYPAL_BUYER_PASSWORD", "test-password");
  approve = (await import("./live-sandbox")).approveSandboxBuyer;
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
function sandboxPage({ challenge = false, currencyError = false } = {}) {
  let stage = 0;
  const fill = vi.fn(async () => {});
  const button = (visible: () => boolean, next: () => void = () => {}) => ({
    first() {
      return this;
    },
    isVisible: async () => visible(),
    fill,
    click: async () => next(),
  });
  const page = {
    goto: async () => {},
    url: () =>
      stage === 2
        ? "http://localhost:3000/agent-demo?approved=1"
        : "https://www.sandbox.paypal.com/checkoutnow",
    locator: (selector: string) => {
      if (selector.includes("iframe"))
        return { all: async () => [{ isVisible: async () => challenge }] };
      if (selector.includes("#email")) return button(() => stage === 0);
      if (selector.includes("#password")) return button(() => stage === 1);
      if (selector === "#btnNext")
        return button(
          () => stage === 0,
          () => {
            stage = 1;
          },
        );
      return button(
        () => stage === 1,
        () => {
          stage = 2;
        },
      );
    },
    getByText: () => button(() => currencyError),
    getByRole: () => button(() => false),
  } as unknown as Page;
  return { page, fill };
}
it("ignores a hidden CAPTCHA iframe and completes normal sandbox buyer approval", async () => {
  const { page, fill } = sandboxPage();
  await approve(
    page,
    "https://www.sandbox.paypal.com/checkoutnow?token=TEST",
    "http://localhost:3000",
  );
  expect(fill).toHaveBeenCalledTimes(2);
  expect(page.url()).toContain("approved=1");
});
it("does not enter credentials when PayPal presents a visible challenge", async () => {
  const { page, fill } = sandboxPage({ challenge: true });
  await expect(
    approve(
      page,
      "https://www.sandbox.paypal.com/checkoutnow",
      "http://localhost:3000",
    ),
  ).rejects.toThrow("security challenge");
  expect(fill).not.toHaveBeenCalled();
});
it("retains PayPal's currency rejection instead of retrying login or claiming approval", async () => {
  const { page, fill } = sandboxPage({ currencyError: true });
  await expect(
    approve(
      page,
      "https://www.sandbox.paypal.com/checkoutnow",
      "http://localhost:3000",
    ),
  ).rejects.toThrow("PAYPAL_CURRENCY_REJECTED");
  expect(fill).not.toHaveBeenCalled();
});

function manualPage() {
  let current = "https://www.sandbox.paypal.com/checkoutnow?token=ORDER12345";
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const interact = vi.fn(() => {
    throw new Error("Manual approval must not interact with PayPal controls");
  });
  const page = {
    goto: vi.fn(async () => {}),
    bringToFront: vi.fn(async () => {}),
    url: () => current,
    locator: interact,
    getByRole: interact,
    getByText: () => ({
      first: () => ({ waitFor: vi.fn(() => new Promise<void>(() => {})) }),
    }),
    waitForURL: vi.fn(
      async (
        predicate: (url: URL) => boolean,
        options: { timeout: number },
      ) => {
        if (options.timeout <= 0) throw new Error("Invalid timeout");
        await waiting;
        if (!predicate(new URL(current)))
          throw new Error("No return navigation");
      },
    ),
  };
  return {
    page,
    interact,
    returnTo(url: string) {
      current = url;
      resume();
    },
  };
}
it("manual mode opens a visible page and waits for the operator without buyer credentials or button clicks", async () => {
  const { page, interact, returnTo } = manualPage();
  vi.stubEnv("PAYPAL_BUYER_EMAIL", "");
  vi.stubEnv("PAYPAL_BUYER_PASSWORD", "");
  try {
    let completed = false;
    const approval = approve(
      page as unknown as Page,
      page.url(),
      "http://localhost:3000",
      { manual: true },
    ).then(() => {
      completed = true;
    });
    await vi.waitFor(() => expect(page.waitForURL).toHaveBeenCalled());
    expect(completed).toBe(false);
    expect(page.bringToFront).toHaveBeenCalledOnce();
    expect(page.waitForURL.mock.calls[0][1]).toMatchObject({ timeout: 900000 });
    returnTo(
      "http://localhost:3000/agent-demo?approved=1&token=ORDER12345&PayerID=BUYER123",
    );
    await approval;
    expect(completed).toBe(true);
    expect(interact).not.toHaveBeenCalled();
  } finally {
    vi.stubEnv("PAYPAL_BUYER_EMAIL", "buyer@example.invalid");
    vi.stubEnv("PAYPAL_BUYER_PASSWORD", "test-password");
  }
});
it.each([
  [
    "http://localhost:3000/agent-demo?cancelled=1&token=ORDER12345",
    "MANUAL_APPROVAL_CANCELLED",
  ],
  [
    "http://localhost:3000/agent-demo?approved=1&token=OTHERORDER",
    "MANUAL_APPROVAL_TOKEN_MISMATCH",
  ],
  [
    "http://localhost:3000/agent-demo?approved=1",
    "MANUAL_APPROVAL_TOKEN_MISMATCH",
  ],
  ["https://example.invalid/?token=ORDER12345", "MANUAL_APPROVAL_INCOMPLETE"],
])("manual approval rejects an invalid return: %s", async (url, code) => {
  const { page, returnTo, interact } = manualPage();
  const approval = approve(
    page as unknown as Page,
    page.url(),
    "http://localhost:3000",
    { manual: true },
  );
  const rejected = expect(approval).rejects.toThrow(code);
  returnTo(url);
  await rejected;
  expect(interact).not.toHaveBeenCalled();
});
it("manual timeout or a closed browser fails safely without leaking browser exception details", async () => {
  const { page, interact } = manualPage();
  page.waitForURL.mockRejectedValue(
    new Error("Timeout: private browser form content"),
  );
  await expect(
    approve(page as unknown as Page, page.url(), "http://localhost:3000", {
      manual: true,
      timeoutMs: 10,
    }),
  ).rejects.toThrow(
    /^MANUAL_APPROVAL_INCOMPLETE: Manual sandbox approval did not complete/,
  );
  expect(page.waitForURL.mock.calls[0][1]).toMatchObject({ timeout: 10 });
  expect(interact).not.toHaveBeenCalled();
});
it("waits for a matching legacy NVP return without filling or clicking PayPal controls", async () => {
  const { page, returnTo, interact } = manualPage();
  const approval = approve(
    page as unknown as Page,
    "https://www.sandbox.paypal.com/cgi-bin/webscr?cmd=_express-checkout&token=EC-TEST123",
    "http://127.0.0.1:8080",
    { manual: true },
  );
  await vi.waitFor(() => expect(page.waitForURL).toHaveBeenCalled());
  returnTo(
    "http://127.0.0.1:8080/?action=return&token=EC-TEST123&PayerID=BUYER123",
  );
  await approval;
  expect(interact).not.toHaveBeenCalled();
});
it("manual mode promptly records a visible currency rejection without interacting with PayPal", async () => {
  const { page, interact } = manualPage();
  page.getByText = () => ({
    first: () => ({ waitFor: vi.fn(async () => {}) }),
  });
  await expect(
    approve(page as unknown as Page, page.url(), "http://localhost:3000", {
      manual: true,
    }),
  ).rejects.toThrow("PAYPAL_CURRENCY_REJECTED");
  expect(interact).not.toHaveBeenCalled();
});
