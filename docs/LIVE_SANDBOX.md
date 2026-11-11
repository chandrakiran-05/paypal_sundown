# Minimal live sandbox validation

## Successful headed legacy NVP execution — 11 November 2026

Run `pnpm live:legacy:headed` to retry only the PHP legacy shop while retaining the migrated-shop receipts. The PHP shop runs with `php -S`. SetExpressCheckout's actual token supplies the visible sandbox approval URL; the operator approves manually. The return must match the PHP session's checkout token before GetExpressCheckoutDetails and DoExpressCheckoutPayment execute. No PayPal form controls are filled or clicked by the headed runner.

The observed run completed both legacy scenarios live:

| Scenario | SetExpressCheckout | GetExpressCheckoutDetails | DoExpressCheckoutPayment | Transaction | Refund |
| --- | --- | --- | --- | --- | --- |
| Successful checkout | Success | Success | Success | `7CJ81001XE074583Y` | — |
| Partial refund | Success | Success | Success | `8C990177K9301272P` | `6HW265079H695902E` |

All three columns show PayPal's actual ACK values (HTTP 200). RefundTransaction also returned ACK=Success and REFUNDSTATUS=Instant for USD 12.00. Report and per-scenario transcripts: `workspace/live-sandbox/172b0901-77f0-4650-9a79-488c7dde6fca/`. The transcript writer retains returned ACK, all numbered error codes/messages and transaction fields, redacts credential values even inside messages, and excludes buyer details. Hashed transcript references are retained on successful as well as failed attempts. Calls not reached after a failure are not invented.

If PayPal rejects NVP, the retained rejection is read back and labelled `Replayed: live NVP unavailable (<code>: <message>)` on the legacy side. Such a side retains failed status and never receives Live sandbox. Missing credentials remain Not run, and an incomplete browser approval remains Sandbox attempt. This run needed no replay fallback. Existing real migrated IDs remain unchanged; the four unrelated scenarios remain Replay. The Passport is reissued with current evidence.

Typecheck, lint, 75 tests across twelve files, PHP syntax checks, and production build pass. Tests cover manual NVP return handling, actual PHP transcript redaction and ACK preservation, rejection labels, and preservation of migrated receipts during a legacy-only retry.

## Successful migrated sandbox execution — 11 November 2026

The corrected credentials authenticated and both manual buyer approvals completed. Real captures succeeded, followed by real PayPal completion-event redelivery and successful signature verification. Both matching shop orders were marked PAID in SQLite. The partial refund completed for USD 12.00.

| Scenario | Order | Capture | Refund |
| --- | --- | --- | --- |
| Successful checkout | `41287203BR431893P` | `2T6823778H707234G` | — |
| Partial refund | `57D082887N5298832` | `26F66824J6343992W` | `2H616857JB349532E` |

Verified events: `WH-7P209267B1809664U-404089555J103280W` (checkout) and `WH-6JT785737W832913N-4LJ04583WH458374F` (refund-scenario capture). Only these two migrated scenarios receive Live sandbox; four others remain Replay. The legacy NVP side remains failed, so overall cross-shop parity is still incomplete.

Evidence and the reissued portable Passport: `workspace/live-sandbox/6d70aa46-5c99-4584-b7b1-ebedd7f79991/`. The initial 90-second webhook wait expired. Recovery requested real signed redelivery from PayPal, without creating new orders or simulating events. Signature verification now validates the event schema but forwards the original event object, preserving its serialization order; a regression test protects this behavior. The normal runner now allows five minutes for settlement and emits safe verification diagnostics.

Final validation: typecheck, lint, 73 tests, and production build pass. Earlier unsuccessful attempts below remain historical evidence.

The assistant now uses OpenRouter's chat-completions endpoint with `OPENROUTER_API_KEY`, an OpenRouter `LLM_MODEL` (default `openrouter/auto`), JSON output and schema validation. Direct Anthropic calls were removed. Root `.env.local` is read by the web app and live runner; explicit process variables and `apps/web/.env.local` take precedence. Credential values found in the template were moved into ignored `.env.local`; template secret fields are empty.

`pnpm live:sandbox` runs successful checkout and USD 12.00 partial refund against the migrated web shop using its existing PayPal Agent Toolkit, SDK, durable claims and SQLite settlement functions. Playwright handles sandbox buyer approval. A temporary callback receiver verifies real PayPal signatures before marking matching orders PAID. A Cloudflare tunnel exposes only this receiver; the runner removes its own temporary webhook registration and stops the tunnel/browser/PHP server afterward. No existing webhook registration is changed.

The legacy shop runs under `php -S` with a separate DB. NVP request responses are recorded through a strict whitelist that excludes credentials and buyer data. Rejected responses are read back from a retained, hashed transcript and labelled `replayed from recorded transcript`; a rejected call does not become a successful legacy payment. Missing NVP credentials have no real rejection transcript and remain `Not run`.

Passport JSON/PDF carry per-side evidence, order/capture/refund IDs, verified event IDs and errors. Only completed, approved, webhook-settled migrated scenarios receive `Live sandbox`; refund additionally requires a completed refund ID. The other four scenarios stay `Replay`. Pending/failed steps retain any IDs already observed. Existing passport hash chains remain verifiable; new evidence is part of the chain. Unavailable comparisons display BLOCKED rather than a fabricated parity difference.

## Headed manual approval

Run `pnpm live:sandbox:headed` with `PAYPAL_MODE=live` and the app running locally. This opens a visible Chrome window for each migrated order and waits up to 15 minutes for the operator to log in and approve with a sandbox buyer. No buyer credentials are needed by this manual path; it never reads form values, enters credentials, clicks PayPal controls, or bypasses challenges. Legacy NVP checks also wait for manual approval in headed mode. `pnpm live:legacy:headed` runs only the legacy side and carries forward the migrated evidence without creating new REST orders.

The return must carry the matching order token and must not be cancelled. Capture is then attempted through the existing Toolkit; only an accepted capture and a signature-verified webhook settling the matching shop order can establish completion. The partial-refund scenario additionally requires the real refund to complete. All IDs are persisted incrementally in the report, and the Passport is reissued when the run ends. A timeout, cancellation or closed browser retains a truthful incomplete attempt. Four unrelated scenarios always remain Replay; simulated event IDs cannot establish live evidence.

## Earlier local validation — before credentials were corrected

- A real OpenRouter request returned a valid structured answer. The workspace assistant was also exercised in the browser and displayed an OpenRouter answer preserving the Replay/Not run labels.
- PHP 8.5.12 with curl/PDO SQLite was installed under ignored `workspace/tools/php`; the harness started the legacy shop with `php -S`. PHP source syntax checks passed.
- Google Chrome was launched through Playwright. Cloudflare's official tunnel binary was installed under ignored `workspace/tools/cloudflared`; payment authentication failed before any tunnel or webhook registration was created.
- Real PayPal sandbox OAuth returned **HTTP 401 / invalid_client**. The saved `PAYPAL_CLIENT_SECRET` was identical to `PAYPAL_CLIENT_ID`. The matching app's separate Sandbox Secret is required.
- Sandbox buyer email/password are present. The three separate NVP credentials are absent. No REST credentials were substituted for NVP and no rejection/success was invented.
- The live harness exited 1, retained a truthful incomplete report, and reissued the passport showing two blocked/not-run cases and four Replay cases. **No real order, capture, refund or webhook settlement is claimed.**
- The report is `workspace/live-sandbox/e4d37df0-e73c-45d1-9a81-4514506f7687/report.json`. Runtime reports/transcripts are ignored workspace files.
- Typecheck, lint, 61 tests across ten files and production build passed. Tests cover OpenRouter transport/validation, per-scenario label gates, missing approval/capture/refund/webhook evidence, replayed rejection provenance and chained passport exports. Updated PDF pagination and provenance were rendered for visual review.

Those credential failures describe the earlier run only. The subsequent polish run authenticated with the corrected REST credentials and used the saved NVP credentials, but PayPal buyer approval rejected the seller's currency configuration. See [the polish verification](POLISH.md). A valid REST pair cannot supply or derive separate legacy NVP credentials.

## Headed run — 11 November 2026

`pnpm live:sandbox:headed` opened visible Chrome for the migrated refund scenario, order `6SN24658KN486180R`. After manual login, the operator reported PayPal's message: “This seller doesn't accept payments in your currency.” The blocked browser was closed and the runner cleaned up its owned PHP server, temporary webhook and tunnel. No capture, refund, or verified settlement completed. The second migrated scenario was not run after the browser closed. The other four scenarios remain Replay.

Report: `workspace/live-sandbox/12c08335-2200-44db-a11d-ae94ed378bf2/report.json`. Its `manual-approval-error.json` receipt explicitly identifies the message as operator-reported, rather than a PayPal API response. The Passport was reissued and a matching portable snapshot saved as `passport.json` in that directory. No live-success label was awarded.

The headed-mode implementation passes typecheck, lint, 72 tests across eleven files, and the production build. Tests verify that manual approval waits without filling or clicking PayPal controls, rejects cancellation/mismatched tokens/closed browsers, promptly retains a visible currency rejection, and preserves the two-live/four-replay label boundary only when all required receipts exist. Successful real capture/refund/webhook execution remains blocked by the sandbox merchant/buyer currency setup.
