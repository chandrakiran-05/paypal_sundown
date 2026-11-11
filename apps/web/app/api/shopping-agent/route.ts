import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  finishShoppingAgent,
  legacyAttempt,
  sandboxAgentAvailable,
  startShoppingAgent,
} from "../../../lib/shopping-agent";
import { publicShopOrder, shopOrder } from "../../../lib/agent-shop";
const command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    mode: z.enum(["sandbox", "simulated"]),
    requestId: z.uuid(),
  }),
  z.object({ action: z.literal("capture"), id: z.string().min(5).max(100) }),
]);
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id)
    return Response.json({
      sandboxAvailable: sandboxAgentAvailable(),
      legacy: legacyAttempt(),
    });
  const owner = (await cookies()).get("sundown-agent")?.value;
  if (!owner)
    return Response.json({ error: "Order not found" }, { status: 404 });
  try {
    return Response.json({ order: publicShopOrder(shopOrder(id, owner)) });
  } catch {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }
}
export async function POST(request: Request) {
  try {
    const data = command.parse(await request.json());
    const jar = await cookies();
    let owner = jar.get("sundown-agent")?.value;
    if (!owner || !z.uuid().safeParse(owner).success) {
      owner = randomUUID();
      jar.set("sundown-agent", owner, {
        httpOnly: true,
        sameSite: "lax",
        secure: new URL(request.url).protocol === "https:",
        path: "/",
        maxAge: 86400,
      });
    }
    const result =
      data.action === "start"
        ? await startShoppingAgent(
            owner,
            data.mode,
            data.requestId,
            new URL(request.url).origin,
          )
        : { order: await finishShoppingAgent(data.id, owner) };
    return Response.json({ ...result, order: publicShopOrder(result.order) });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error:
            "Invalid command or unexpected PayPal tool response. No payment success is claimed.",
        },
        { status: 422 },
      );
    return Response.json(
      { error: error instanceof Error ? error.message : "Agent failed" },
      { status: 409 },
    );
  }
}
