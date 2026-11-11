/** Keep provider credentials server-side and validate every assistant answer. */
import { z } from "zod";
import { OpenRouterProvider, ReplayProvider } from "@sundown/agents";
import { snapshot } from "../../../lib/store";
export async function POST(request: Request) {
  try {
    const { prompt } = z
      .object({ prompt: z.string().min(1).max(2000) })
      .parse(await request.json());
    const live = !!process.env.OPENROUTER_API_KEY?.trim();
    const result = await (
      live ? new OpenRouterProvider() : new ReplayProvider()
    ).complete(prompt, snapshot());
    return Response.json({
      ...result,
      provider: live ? "OpenRouter" : "Deterministic replay assistant",
    });
  } catch {
    return Response.json(
      {
        error:
          "Assistant unavailable. Evidence remains available in the parity and risk widgets.",
      },
      { status: 502 },
    );
  }
}
