# Judging map

| Criterion                        | Inspect                                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic migration evidence | [rules, planner, normalization](../packages/engine/src/index.ts), [tests](../packages/engine/src/engine.test.ts)                                                |
| Reviewable migration             | [PHP templates and diff](../packages/engine/src/rewriter.ts), generated ignored `workspace/migrated-shop`                                                       |
| Replay with no credentials       | [fixtures](../fixtures), [state and verifier](../apps/web/lib/store.ts)                                                                                         |
| AG Studio                        | [canvas, widgets, theme and framework adapter](../apps/web/components/studio.tsx), [widgets](../apps/web/components/widgets.tsx)                                |
| Bryntum                          | [real Gantt / Scheduler instances](../apps/web/components/timeline.tsx)                                                                                         |
| PayPal                           | [official sandbox SDK](../apps/web/lib/paypal.ts), [verified webhook route](../apps/web/app/api/webhooks/route.ts), [legacy NVP](../apps/legacy-shop/store.php) |
| Product design and 3D            | [procedural scenes](../apps/web/components/scene.tsx), [design system](../apps/web/app/globals.css)                                                             |
| AI                               | [agent roles / Zod / provider abstraction](../packages/agents/src/index.ts)                                                                                     |
| Zapier / exports                 | [event sender](../apps/web/lib/store.ts), [Postman / HTML / JSON](../apps/web/app/api/export/route.ts)                                                          |
| Render                           | [blueprint](../render.yaml), [Docker Compose](../docker-compose.yml)                                                                                            |
| Transparency                     | [limitations](../README.md#decisions-and-honest-limitations), [validation](VALIDATION.md)                                                                       |

Automatic GitHub PRs, arbitrary code repair and live Playwright differential parity are not implemented and should not be scored as completed.

APIMatic Context Plugin installation and concrete code/test usage: [provenance and sandbox flow](APIMATIC.md).
