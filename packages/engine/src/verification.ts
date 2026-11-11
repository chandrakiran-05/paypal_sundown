/** Credential-free regression gate. It compares outcomes and never repairs its inputs. */
import { fixtureSchema, executeFixture } from "./index";
import { createHash } from "node:crypto";
export const requiredScenarios = [
  "success",
  "cancel",
  "decline",
  "duplicate",
  "refund",
  "rounding",
];
export function verifyScenarios(inputs: unknown[], now = new Date()) {
  const fixtures = inputs.map((input) => fixtureSchema.parse(input));
  const ids = fixtures.map((f) => f.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate scenario IDs");
  const missing = requiredScenarios.filter((id) => !ids.includes(id));
  if (missing.length)
    throw new Error(`Missing scenarios: ${missing.join(", ")}`);
  const results = fixtures.map((f) => executeFixture(f, true));
  return {
    schemaVersion: 1 as const,
    generatedAt: now.toISOString(),
    mode: "synthetic-replay" as const,
    limitation:
      "Fixture comparison only; no sandbox transaction or running-shop differential execution.",
    inputsSha256: createHash("sha256")
      .update(JSON.stringify(fixtures))
      .digest("hex"),
    passed: results.every((r) => r.differences.length === 0),
    results,
  };
}
export function postmanCollection(baseUrl = "http://localhost:3000") {
  return {
    info: {
      name: "Sundown / synthetic replay parity",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      description:
        "Runs replay verification in a Sundown server. Does not execute PayPal sandbox transactions.",
    },
    variable: [{ key: "baseUrl", value: baseUrl }],
    item: [
      {
        name: "Verify scenarios without auto-repair",
        request: { method: "GET", url: "{{baseUrl}}/api/verify" },
        event: [
          {
            listen: "test",
            script: {
              exec: [
                "pm.test('Parity gate passes', () => { pm.response.to.have.status(200); const r = pm.response.json(); pm.expect(r.passed).to.eql(true); pm.expect(r.results.length).to.be.at.least(6); });",
              ],
            },
          },
        ],
      },
    ],
  };
}
