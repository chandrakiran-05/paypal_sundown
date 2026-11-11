# APIMatic PayPal integration

## Installation verified

Ran APIMatic's [official installer](https://github.com/apimatic/context-plugins-installer):

```sh
CP_TELEMETRY=off npx --yes context-plugins install paypal --targets codex --yes --force
CP_TELEMETRY=off npx --yes context-plugins installed --targets codex --json
```

The installer reported `Installed paypal@context-plugins`; status confirmed `context-plugins/plugin-marketplace`, target `codex`. The installed plugin is version **0.4.1**, under `~/.codex/plugins/cache/context-plugins/paypal/0.4.1`. A pre-existing unregistered PayPal context folder (0.1.0) was preserved at `/private/tmp/sundown-paypal-context-backup-20261110` before registration. The backup is temporary; the original official-Server-SDK context remains available at `~/.codex/plugins/paypal/skills/typescript`.

Codex requests a new session to auto-load the registered plugin. During this run, context files were read directly, so the plugin's guidance could be used immediately.

## Which context and why

The pre-existing APIMatic context explicitly documents the official `@paypal/paypal-server-sdk` **2.5.0**. Read its TypeScript getting-started, client initialization, authentication, calling endpoints, error handling, configuration/resilience and testing skills. Read the newly installed plugin's TypeScript integration/getting-started skills too.

The new 0.4.1 context targets a different generated `paypal` package / `PaypalClient`; its SDK-specific names and defaults do not apply to the official SDK. The original Sundown requirement explicitly requests the **PayPal Server SDK for Node**. Retained that official SDK, pinned it to 2.5.0, and confirmed each signature, enum, request mapping and error class in its installed `src/`. Did not silently substitute the alternate SDK or copy its incompatible symbols.

APIMatic is a **development-time context plugin**, not a checkout runtime dependency or a PayPal payment provider.

## Applied guidance

| Context                           | Concrete implementation                                                                                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact package and source contract | SDK pinned to 2.5.0; `OrdersController`, `PaymentsController`, `CheckoutPaymentIntent`, `PaypalExperienceUserAction` checked against installed source.                                               |
| Client lifetime and OAuth         | Lazy process-scoped SDK client preserves token caching; 60-second clock skew; signature verification tokens expire and refresh.                                                                      |
| Endpoint and model mapping        | `paymentSource.paypal.experienceContext` becomes `payment_source.paypal.experience_context`; create/capture use Orders v2, refunds use Payments v2.                                                  |
| Errors                            | Catch actual `ApiError` shape; expose safe status/code/message, never raw provider response, credentials, headers or buyer details. Transport ambiguity is labelled unknown.                         |
| Resilience                        | Explicit 15-second SDK timeout, request abort deadline; retries disabled at SDK layer. Durable SQLite claims retain stable provider request IDs for reconciliation/retry.                            |
| Testing                           | Actual SDK serialization through an injected axios adapter; fake OAuth endpoint response, capture every request, and assert sandbox-only hosts and wire fields. No real tokens or payments in tests. |

Files: `apps/web/lib/paypal.ts`, `apps/web/lib/checkout-store.ts`, corresponding tests, order/webhook routes, and `/checkout`.

## Sandbox checkout

Set the following in `apps/web/.env.local` (never commit it), then restart the server:

```dotenv
PAYPAL_MODE=live
PAYPAL_CLIENT_ID=your_sandbox_app_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_app_client_secret
PAYPAL_WEBHOOK_ID=your_sandbox_webhook_id
```

1. Open `/checkout`; select an item and quantity. The server calculates its USD amount from the catalog.
2. Choose **Approve in PayPal sandbox**. Log in with a sandbox buyer account. PayPal returns to `/checkout?token=...`.
3. Choose **Capture approved sandbox order**. The server checks browser ownership and confirms capture amount/currency.
4. Enter a positive partial-refund amount and choose **Refund capture**. The refund uses the capture ID stored by the server, never an arbitrary client-supplied capture ID.
5. Register `/api/webhooks` as your sandbox app's public HTTPS listener. Configure its webhook ID. PayPal signature verification must succeed before the event ID is inserted; duplicate event IDs are acknowledged idempotently.

An unknown transport outcome retains its original request ID. Retrying uses the same provider key. Concurrent duplicate writes receive 409; successfully completed duplicate requests return their stored result. Claims older than 90 seconds can be retried with the same provider key. Browser ownership is demo isolation, not a production merchant authorization system.

## Verification and boundaries

SDK serialization/OAuth, capture/refund resource mapping, safe declines, unknown outcomes, invalid money, missing signatures, both verification outcomes, durable pre-write claims, concurrent duplicates, retry key preservation and browser ownership are tested without credentials. **29 tests pass**, together with typecheck, lint and production build.

The local environment has no PayPal sandbox credentials. Real OAuth, buyer approval, capture, refund and webhook deliveries have not been executed. Full live legacy-versus-migrated differential testing remains unimplemented. These limitations are separate from the completed sandbox checkout code and APIMatic installation; no synthetic evidence is presented as live proof.
