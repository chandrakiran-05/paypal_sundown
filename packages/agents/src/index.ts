/** Agent roles and provider-independent, schema-validated structured explanations. */
import { z } from "zod";
export const agents = [
  {
    id: "scanner",
    name: "Scanner-explainer",
    prompt: "Explain only supplied file:line findings. Never invent evidence.",
  },
  {
    id: "planner",
    name: "Planner",
    prompt: "Respect prerequisites; defer canary whenever parity fails.",
  },
  {
    id: "rewriter",
    name: "Rewriter",
    prompt: "Only sandbox APIs. Preserve cents and use idempotency keys.",
  },
  {
    id: "verifier",
    name: "Verifier",
    prompt:
      "Compare normalized evidence; repair at most three times. Never relabel synthetic evidence as live.",
  },
  {
    id: "dashboard",
    name: "Dashboard",
    prompt:
      "Answer from supplied parity results. Choose a widget to expose supporting evidence.",
  },
] as const;
export const answerSchema = z.object({
  answer: z.string(),
  widget: z.enum(["parity", "risk", "burndown", "countdown"]),
});
export type Answer = z.infer<typeof answerSchema>;
export interface LlmProvider {
  complete(prompt: string, context: unknown): Promise<Answer>;
}
export class OpenRouterProvider implements LlmProvider {
  async complete(prompt: string, context: unknown) {
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key) throw new Error("OpenRouter API key is not configured");
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: process.env.LLM_MODEL || "openrouter/auto",
          max_tokens: 1200,
          response_format: { type: "json_object" },
          provider: { require_parameters: true },
          messages: [
            {
              role: "system",
              content:
                'Answer only from evidence. Return JSON {answer:string,widget:"parity"|"risk"|"burndown"|"countdown"}. Preserve Replay, Simulated and Live sandbox provenance exactly; do not infer live execution from configuration.',
            },
            { role: "user", content: JSON.stringify({ prompt, context }) },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok)
      throw new Error("LLM provider rejected request: " + response.status);
    const body = z
      .object({
        choices: z
          .array(z.object({ message: z.object({ content: z.string() }) }))
          .min(1),
      })
      .parse(await response.json());
    return answerSchema.parse(JSON.parse(body.choices[0].message.content));
  }
}
export class ReplayProvider implements LlmProvider {
  async complete(prompt: string, context: unknown) {
    const data = z
      .object({
        results: z.array(
          z.object({ label: z.string(), differences: z.array(z.unknown()) }),
        ),
        findings: z.array(z.unknown()),
      })
      .parse(context);
    const fails = data.results.filter((r) => r.differences.length);
    return answerSchema.parse({
      answer: /risk|file/i.test(prompt)
        ? `${data.findings.length} deterministic file:line findings. Inspect the risk widget for replacement mappings.`
        : fails.length
          ? `${fails.map((f) => f.label).join(", ")} still fails parity. Run parity to exercise the verifier and inspect its repair journal.`
          : "All six replay flows match. This establishes fixture parity, not live sandbox or Store Sync approval.",
      widget: /risk|file/i.test(prompt) ? "risk" : "parity",
    });
  }
}
