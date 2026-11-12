## Workspace access

Open `/login` to access the full workspace: Overview, Connect, Plan, Parity, Readiness, Portfolio, Agent Checkout and Migration Passports. There is no separate reduced demo; old `/demo` links redirect to the workspace. Existing sandbox, replay and simulated evidence retain their individual labels. Partner onboarding requires approved partner credentials.

Use the server-configured `SUNDOWN_ADMIN_PASSWORD` to sign in. Optional `SUNDOWN_SHARED_ACCESS=true` displays `Sundown-Workspace-2026` beneath the same form. This grants public access to workspace records and actions, so use only showcase data when enabled. Shared access is disabled by default. The real admin password and PayPal credentials are never displayed.

# Three-minute demo

## Recommended judge walkthrough

1. Open `/connect`. Enter a sample business name and upload `apps/web/public/examples/legacy-checkout.php` (also downloadable in the form). Show the five actual file/line findings, suggested dependencies, and JSON download. Explain that raw source is not stored and no migration/payment was executed for this business.
2. Show the optional PayPal connection panel. With no partner credentials it honestly shows setup required. Approved partners can generate a seller invitation, obtain consent on PayPal and verify permissions server-side. Do not present fixture tests of onboarding as a real partner connection.
3. Open Overview and follow the five-step journey. Review Plan, then Checkout tests. Run demo tests: the synthetic verifier/Planner loop does not charge PayPal or overwrite retained live receipts. Open a live row to show its actual order/capture/refund evidence and neutral legacy IPN Events note.
4. Open Migration Passport and download evidence. Explain that Horizon receipts belong only to the reference demo. Source assessments and partner connection records remain separate.

The extra Demo Tools navigation contains the launch checklist, seeded portfolio and agent checkout. These capabilities stay available without competing with the main walkthrough.

**0:00–0:30** Open `/`. “Sundown moves legacy checkout to Orders v2, with evidence.” Observe the procedural horizon. Open workspace. Point to Replay data and the synthetic-fixture disclosure.

**0:30–1:00** Overview: source findings, 5/6 parity baseline, conversion pipeline and AG Studio custom widgets. Click a node; show field-level differences. Ask “Which flows still fail refund parity?” The deterministic assistant identifies the duplicate-callback mismatch.

**1:00–1:45** Open Parity testing. Run parity. Observe failure → Planner defers tasks → Verifier iteration 1 applies replay idempotency → duplicate callback passes. Read the persisted journal. Open Plan and show deferred Gantt dependencies. Explain that this is a known fixture repair, not a claim of live payment proof.

**1:45–2:15** Review diff, apply the Orders v2 template to the isolated branch. Inspect generated workspace files and catalog. Readiness flips after migration and successful replay. Explain limited Store Sync access, US/USD physical goods and approval by PayPal.

**2:15–2:45** Simulate canary. Observe labelled simulated rollback and z-score evidence. Open Portfolio for twelve merchants' Bryntum Scheduler windows.

**2:45–3:00** Download HTML/JSON evidence and Postman collection. Show `/checkout` for sandbox redirect approval, capture and partial refund. Explain APIMatic context-guided SDK work and signature verification. Real sandbox calls require credentials; the two-scenario live harness is available with valid sandbox credentials.

## Upgrade walkthrough (five additional minutes)

1. Apply migration and run replay parity first. Open **Shopping agent** (`/agent-demo`). Point out that legacy checkout is rejected because its NVP/IPN contract does not implement the agent toolkit's Orders tools. This is a source-backed capability failure; no legacy charge is attempted.
2. With no credentials, select **Run Simulated checkout**. Show all three Simulated trace steps, the `SIM-` order/capture IDs, and PAID in the shop's SQLite DB. Explain that a distinct simulated event handler performed the write; this is not a sandbox transaction.
3. If sandbox credentials, webhook ID and public webhook routing are available, select **Run PayPal sandbox** instead. Approve in the returned PayPal sandbox link, then request capture. Watch AWAITING_WEBHOOK become PAID after the signed completion event. If approval, sandbox access or webhook delivery cannot run, show that limitation and use the explicitly labelled Simulated path. Never present a simulated ID as a sandbox transaction ID.
4. Open **Migration Passport** (`/passport/1`). Reissue to attach the latest run. Show synthetic parity results, separately labelled transaction IDs, and the estimate's five editable assumptions. Enter a merchant sunset target to enable the countdown; it is not a claimed global PayPal deadline. Switch to `/passport/2` to show honest absence of site-specific checkout evidence.
5. Download PDF and JSON. Retain the displayed head separately. Run `pnpm exec sundown verify --passport <download.json> --head <retained-head>`. Change an amount or transaction mode in a copy and show exit 1.
6. Run `pnpm exec sundown verify --output workspace/verify`. Show JSON/HTML reports and Postman artifact. In a copied fixture directory, change a migrated amount; run `--fixtures <copy>` and show exit 1 without auto-repair. CI uses the same CLI through `.github/actions/sundown-verify` and uploads artifacts even on failure.

The default walkthrough needs no PayPal or language-model credentials. Sandbox behavior is tested with injected tool responses and signature verification is tested at the HTTP boundary. Real sandbox attempts and their current blockers are documented in [LIVE_SANDBOX.md](LIVE_SANDBOX.md). The web agent-demo shop DB is separate from the standalone PHP shop DB. The reusable action is wired into CI; a hosted GitHub run requires pushing this repository.

## Live sandbox and OpenRouter

Use the ignored root `.env.local`, with `PAYPAL_MODE=live`, a matching Sandbox app client ID and separate Secret, sandbox Personal buyer email/password, and `OPENROUTER_API_KEY`. Use `LLM_MODEL=openrouter/auto` or a provider/model ID from OpenRouter. The assistant reports OpenRouter and preserves evidence provenance.

Start `pnpm dev`, then `pnpm live:sandbox`. The two targeted scenarios create real orders, drive buyer approval with Playwright, capture and await real verified completion webhooks. The refund scenario additionally records a real USD 12.00 refund. Show order/capture/refund IDs in `/passport/1`; only completed live sides carry Live sandbox labels. The other four scenarios retain Replay. Inspect retained legacy rejection transcripts and their hashes; absent NVP credentials mean Not run, never invented sandbox proof.

The harness's temporary tunnel publishes only a signature-verified webhook receiver. It cleans up its own temporary webhook registration, tunnel, browser and PHP server. An incomplete run exits nonzero and retains every ID/error already observed. PayPal CAPTCHA/security challenges require the operator and are not bypassed.

### Headed manual sandbox approval

To demonstrate only the legacy NVP side, run `pnpm live:legacy:headed`. Approve each PayPal sandbox checkout manually. Inspect the retained SetExpressCheckout → GetExpressCheckoutDetails → DoExpressCheckoutPayment ACKs, error fields, and transaction IDs in the report's hashed transcript files. Rejected calls display `Replayed: live NVP unavailable (<error>)` rather than a live-success claim. The successful migrated-shop evidence is carried forward without another REST payment.

With `pnpm dev` running and `PAYPAL_MODE=live` in the ignored `.env.local`, run `pnpm live:sandbox:headed`. The existing legacy NVP check runs first. For each migrated scenario, the terminal prints its scenario/order ID and Chrome opens PayPal sandbox. Log in with a sandbox buyer and approve manually; the runner never fills credentials or clicks approval controls in this mode. Each approval has a 15-minute limit. Cancellation, browser closure or a different return token fails safely.

After the matching PayPal return, capture and signature-verified webhook settlement continue automatically. The refund scenario additionally requests USD 12.00 back from its USD 24.00 capture. The report saves each real ID as soon as observed and the Passport is reissued at completion, including incomplete attempts. Only completed approval/capture/verified settlement receives **Live sandbox**, with a completed refund also required for the refund scenario. The other four remain **Replay**. A returned URL alone does not establish payment or promote a label.
