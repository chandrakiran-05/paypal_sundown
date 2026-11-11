> Historical report. The current judge audit and 37-test result are in [AUDIT.md](AUDIT.md).

# Acceptance report

Verified locally on 10 November 2026, Node 24.21.0, pnpm 11.25.0.

| Requested acceptance item                                       | Result                       | Evidence / limits                                                                                                                                                                              |
| --------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm i && pnpm dev` without credentials                        | PASS                         | Frozen-lockfile install succeeds; seed succeeds; webpack development server starts. Production HTTP and browser checks also completed.                                                         |
| Seeded dashboard, Gantt, matrix and pipeline render             | PASS                         | Browser observed AG Studio's four custom widgets, procedural pipeline, Gantt tasks/dependencies and twelve Scheduler rows. Shared Bryntum bundle fixes cross-page class registration conflict. |
| Failed parity reschedules Gantt, verifier repairs, matrix green | PASS for replay              | Persisted smoke test plus browser run: duplicate-event mismatch, two-day deferral, iteration 1 repair, 6/6 matching fixtures. Fixtures are synthetic, not sandbox recordings.                  |
| Readiness flips after migration and catalog is generated        | PASS for replay              | Browser observed four technical checks passing after migration/parity. Smoke asserts generated catalog with three products. Store Sync approval remains external.                              |
| Typecheck, lint, tests, build; Docker Compose starts shops      | FAIL as combined requirement | Typecheck, lint, all 16 unit tests and production build pass. Docker and PHP executables are unavailable here, so Compose startup and PHP execution were not verified.                         |
| README, architecture, demo and judging docs                     | PASS                         | All are included and linked from README.                                                                                                                                                       |

Additional `pnpm smoke` validation exercises persistent SQLite flags and journal, branch/catalog generation, and canary rollback. It resets demo flags afterward but retains the journal. The browser demonstration subsequently applies migration and parity, leaving the preview with 6/6 replay parity and 4/4 technical checks.

Production preview is served at `http://localhost:3002/overview`. The initial development UI preview was interrupted by expensive vendor compilation. Production browser checks succeeded. Tests do not establish live financial behavior.

## Unmet requested capabilities

- APIMatic was subsequently installed and used; see the follow-up below.
- Full live differential testing and sandbox buyer approval with Playwright are not implemented.
- Fixture provenance is synthetic, not recorded PayPal sandbox HTTP responses.
- Automatic GitHub PR creation is not implemented.
- Arbitrary-code LLM rewrite and general verifier repair are not implemented; the known-shop template and known replay idempotency repair are supported.
- AG Studio's Agent Framework is connected to an evidence-answer adapter. The workspace assistant can add a selected evidence widget; autonomous multi-agent widget planning is not implemented.
- The 3D pipeline is procedural but uses individual animated nodes rather than instancing or actual along-rail conversion motion. Horizon geometry is a wireframe plane, not a full terrain heightfield. The sunset widget avoids an invented deadline.
- Live credentials, LLM calls, external Zapier delivery, webhook verification responses, Render deployment and Docker startup were not exercised.

## APIMatic follow-up

The official installer registered `paypal@context-plugins` (0.4.1) in Codex. Preserved the pre-existing 0.1.0 official PayPal Server SDK context before replacing its registration. Read the installed context directly in the active session; automatic plugin loading requires a new Codex session.

Added `/checkout` for PayPal sandbox redirect approval, server-priced create order, browser-owned capture and partial refund. The official SDK is pinned to 2.5.0. OAuth/client reuse, bounded calls, typed safe errors, signature validation, and durable idempotency are covered by SDK transport and SQLite tests. The earlier tests remain valid; subsequent test totals are recorded in `docs/APIMATIC.md`.

Actual sandbox buyer approval/capture/refund is **not verified**: neither `.env.local` nor `apps/web/.env.local` supplies the required PayPal credentials. The six-scenario live differential harness remains separate and unimplemented; this checkout does not turn replay fixtures into live evidence.
