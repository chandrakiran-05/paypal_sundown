import { it, expect, vi, afterEach } from "vitest";
import { OpenRouterProvider } from "./index";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("uses OpenRouter bearer auth, configured model, JSON mode and validates the answer", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-router-key");
  vi.stubEnv("LLM_MODEL", "provider/model");
  const request = vi.fn(async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              answer: "Replay only",
              widget: "parity",
            }),
          },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", request);
  expect(
    await new OpenRouterProvider().complete("Evidence?", { mode: "replay" }),
  ).toEqual({ answer: "Replay only", widget: "parity" });
  const [url, options] = request.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(options.headers).toMatchObject({
    Authorization: "Bearer test-router-key",
  });
  expect(JSON.parse(String(options.body))).toMatchObject({
    model: "provider/model",
    response_format: { type: "json_object" },
  });
  expect(JSON.stringify(options)).not.toContain("x-api-key");
});
it("does not call a provider without a key or accept invalid structured output", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await expect(new OpenRouterProvider().complete("test", {})).rejects.toThrow(
    "not configured",
  );
  expect(request).not.toHaveBeenCalled();
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  request.mockResolvedValue(
    Response.json({
      choices: [
        { message: { content: '{"answer":"test","widget":"invented"}' } },
      ],
    }),
  );
  await expect(new OpenRouterProvider().complete("test", {})).rejects.toThrow();
});
