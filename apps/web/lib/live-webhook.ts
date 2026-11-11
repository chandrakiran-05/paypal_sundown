/** Temporary sandbox callback exposes no application routes; real signatures precede settlement. */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ApiError } from "@paypal/paypal-server-sdk";
import { root } from "./store";
import { sandboxClient, verifyWebhook } from "./paypal";
import { applyShopWebhook } from "./agent-shop";
export async function sandboxRequest(
  endpoint: string,
  method = "GET",
  body?: unknown,
) {
  if (!/^\/v1\/notifications\/webhooks(?:\/[A-Z0-9]+)?$/.test(endpoint))
    throw new Error("Unsupported sandbox setup endpoint");
  let token;
  try {
    token = await sandboxClient().clientCredentialsAuthManager.updateToken();
  } catch (error) {
    throw new Error(
      error instanceof ApiError
        ? `PayPal sandbox OAuth rejected credentials: HTTP ${error.statusCode}. Check the matching Sandbox client ID and separate Secret.`
        : "PayPal sandbox OAuth failed. Check the matching Sandbox client ID and separate Secret.",
    );
  }
  const response = await fetch(`https://api-m.sandbox.paypal.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`Sandbox webhook setup rejected: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
export async function openLiveWebhook() {
  // Fail authentication before opening a tunnel or registering any callback.
  await sandboxRequest("/v1/notifications/webhooks");
  let webhookId = "";
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/webhook") {
      res.writeHead(404).end();
      return;
    }
    try {
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        const data = Buffer.from(chunk);
        bytes += data.length;
        if (bytes > 262144) throw new Error("Body too large");
        chunks.push(data);
      }
      const event: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (typeof value === "string") headers.set(key, value);
      if (
        !webhookId ||
        !(await verifyWebhook(event, headers, {
          client: sandboxClient(),
          fetch,
          webhookId,
        }))
      ) {
        console.warn(
          "Sandbox webhook signature verification rejected the event.",
        );
        res.writeHead(400).end();
        return;
      }
      const settled = applyShopWebhook(event, "sandbox");
      console.log(`Sandbox webhook verified; applied=${settled.applied}.`);
      res.writeHead(200).end();
    } catch (error) {
      console.warn(
        "Sandbox webhook processing failed:",
        error instanceof z.ZodError
          ? error.issues.map((issue) => issue.path.join(".")).join(", ")
          : "verification or settlement unavailable",
      );
      res.writeHead(400).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Webhook listener failed");
  const localBinary = path.join(
    root,
    "workspace/tools/cloudflared/cloudflared",
  );
  const tunnel = spawn(
    process.env.CLOUDFLARED_BINARY ||
      (existsSync(localBinary) ? localBinary : "cloudflared"),
    ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${address.port}`],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let cleanupCalled = false;
  async function close() {
    if (cleanupCalled) return;
    cleanupCalled = true;
    if (webhookId)
      await sandboxRequest(
        `/v1/notifications/webhooks/${webhookId}`,
        "DELETE",
      ).catch(() => {});
    tunnel.kill("SIGTERM");
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error("Webhook tunnel did not become available")),
        45000,
      );
      tunnel.on("error", () => {
        clearTimeout(timer);
        reject(
          new Error(
            "Install cloudflared or set CLOUDFLARED_BINARY for real webhook delivery",
          ),
        );
      });
      tunnel.on("exit", () => {
        clearTimeout(timer);
        reject(new Error("Webhook tunnel exited before setup"));
      });
      tunnel.stderr?.on("data", (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-12000);
        const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
    });
    const hook = z.object({ id: z.string().regex(/^[A-Z0-9]+$/) }).parse(
      await sandboxRequest("/v1/notifications/webhooks", "POST", {
        url: url + "/webhook",
        event_types: [{ name: "PAYMENT.CAPTURE.COMPLETED" }],
      }),
    );
    webhookId = hook.id;
    return { id: webhookId, close };
  } catch (error) {
    await close();
    throw error;
  }
}
