# Production deployment and verification

Sundown is a single-operator, single-instance migration workspace. Production hosting does not enable real-money PayPal payments: `PAYPAL_MODE=live` still selects PayPal sandbox only. Replay fixtures, seeded merchants and simulated operations remain explicitly labelled.

## Configuration

### Business assessment and partner onboarding

`/connect` supports operator-managed source assessments without PayPal partner credentials. Uploaded source is bounded, analyzed without execution, and discarded; only source hashes, safe findings and suggested tasks are retained in the persistent SQLite workspace. Business assessments never inherit the Horizon demo's transactions or parity status. This is a single-operator workspace, not tenant-isolated customer accounts.

The optional seller connection is sandbox-only. Approved partners configure `PAYPAL_PARTNER_CLIENT_ID`, `PAYPAL_PARTNER_CLIENT_SECRET`, `PAYPAL_PARTNER_ID`, `PAYPAL_PARTNER_BN_CODE`, and the deployed `SUNDOWN_APP_URL`. The callback path is `/api/paypal/onboarding/return`; only this exact GET return and its non-sensitive result page bypass workspace authentication. Signed expiring state, tracking identity, and server-side PayPal permission checks determine status. Missing configuration shows setup required, not a simulated connection. Connected status records the last successful check; continuous consent-revocation monitoring and per-seller payment routing are not implemented. Keep the existing checkout credentials separate.

The new business APIs and uploaded-source reports are protected by the same operator authentication as the workspace. `pnpm smoke:production` verifies both protected endpoints and the narrow public callback boundary; unit tests inject PayPal responses without creating seller grants.

Render must build/install before starting the server. For Docker, leave the dashboard's Docker Command override empty so the Dockerfile's direct Node command runs. For a native Node Web Service, use repository root, Node 24, build command `corepack enable && pnpm install --frozen-lockfile && pnpm build`, and start command `node node_modules/next/dist/bin/next start apps/web --hostname 0.0.0.0`. Do not put install/build commands in the start command. Next reads Render's `PORT` environment variable. No static publish directory is used.

The production entrypoint does not invoke pnpm/Corepack or download dependencies. pnpm's implicit pre-run installs are disabled; installation remains an explicit frozen-lockfile build step. The Docker dependency store is under `/app`, accessible to the non-root runtime user. Slow registry requests are build-network warnings; an “Out of memory (used over 512Mi)” message is an instance memory limit, not a port configuration error. If runtime memory still exceeds the instance limit after correcting startup, choose an instance with sufficient memory rather than raising the Node heap above available RAM.

Use Node 24 and the pinned pnpm version. Install with `pnpm install --frozen-lockfile`, then run `pnpm build` and `pnpm start`. The landing is public. `/login` opens the full original workspace; old `/demo` links redirect to `/overview`. Website login uses an HttpOnly, SameSite session lasting eight hours, without browser authentication popups. Configure `SUNDOWN_ADMIN_PASSWORD` (at least 16 characters) through the hosting secret store. The real admin password is never displayed. Changing it invalidates admin sessions. Basic authorization headers remain supported for CLI automation. Use HTTPS for non-loopback deployments.

Public showcase access is enabled by default: browser navigation automatically issues a session, and `/login` redirects to the workspace. This grants public access to all workspace records and sandbox controls. Use only showcase data. Set `SUNDOWN_SHARED_ACCESS=false` for a private deployment. PayPal stays sandbox-only.

Set `SUNDOWN_APP_URL` to the actual public HTTPS origin so authenticated browser mutations pass the same-origin check. Keep secrets server-side. The public AG Studio license is compiled at build time using `NEXT_PUBLIC_AG_GRID_LICENSE_KEY` (the root environment's existing license aliases still work for local builds). Docker accepts the corresponding build argument. Supply licensed Bryntum distribution assets before commercial use; the repository currently installs the trial package.

For Docker Compose, provide configuration using `docker compose --env-file .env.local up --build`. The web container runs as the non-root `node` user. Its persistent `/app/workspace` must be writable by that user. The legacy reference shop binds only to loopback in Compose and is a private service in the Render blueprint. It remains a sandbox/reference fixture, not a public production payment storefront.

Health monitoring uses unauthenticated `GET /api/health` and checks database readability. A missing admin password does not fail health checks. Workspace evidence, business, assistant and payment APIs require a valid shared or admin session. Shared sessions access the full workspace, including replay actions and sandbox controls; this is not tenant isolation. Login is rate limited. `/api/webhooks` independently verifies PayPal signatures. Cross-origin authenticated mutations are rejected.

SQLite storage requires one application instance and a persistent local disk. Back up the database using SQLite's backup facilities, not a copy of just the main file while WAL is active. Do not scale this deployment across independent replicas or treat it as a multi-tenant service.

## Persistent sandbox callbacks

Save matching sandbox REST credentials, register the deployed HTTPS `/api/webhooks` URL for `PAYMENT.CAPTURE.COMPLETED`, and configure that registration's `PAYPAL_WEBHOOK_ID` before enabling web checkout. The headed CLI's temporary webhook is cleaned up after each run and is not a persistent production callback.

At this verification, saved credentials successfully read both real sandbox orders and captures. The refund capture remains PARTIALLY_REFUNDED and its refund is COMPLETED; the checkout capture is COMPLETED. The saved environment currently has no persistent webhook ID or public application origin. Public deployment and continuous web checkout therefore still require those settings. No new payments were created during this audit.

## Cleanup and dependency policy

Removed tracked Finder metadata and an unused live-report environment setting. Pruned 141 packages from unused PayPal toolkit AI SDK, LangChain, MCP, dotenvx and JSON-patch adapter dependencies. Sundown uses only the toolkit's existing OpenAI function-tool adapter; other vendor adapters are intentionally excluded. OpenAI types remain installed.

The pinned toolkit uses Zod v3 schema internals. A small tracked patch imports the supported `zod/v3` compatibility entry from patched Zod 4.6.7. Mathjs is pinned to patched 15.2.0. The original vendor package and function interface remain in use. Toolkit schema/function-interface tests run against the installed patched package. `pnpm audit --prod` reports no known vulnerabilities; no audit findings are suppressed.

## Verification evidence

- Frozen-lockfile install, typecheck, lint, all 135 tests across twenty-one files, production build and runtime dependency audit passed. The runtime audit reports no known vulnerabilities.
- Production HTTP server: all 22 product pages returned 200 with authentication; unauthenticated evidence routes returned 401; cross-origin mutation returned 403; malformed/unsigned webhooks returned 400.
- JSON/PDF Passport exports, JSON/HTML/Postman report exports, event streaming and health endpoint passed. Production server logs contained no errors.
- Browser checks rendered the live/replay matrix and Passport without console warnings or errors. Live Events retain the neutral IPN-unreachable note.
- Local receipts: `workspace/production-validation.json`, `workspace/live-status-validation.json`, and `workspace/production-screenshots/`.

Run `pnpm smoke:production` after building to reproduce the HTTP checks. It starts a temporary loopback server with a randomly generated test password, performs read-only checks and rejected-mutation checks, saves its report under ignored `workspace/`, then stops its server. CI runs the same command after the production build.

Docker execution could not be verified on this machine because Docker is not installed. The requested verification scope was confirmed as local only; no public deployment was attempted. These checks establish local production-server behavior, not the status of an external deployment. The development preview remains available at http://localhost:3000; the smoke test stops its own temporary production server afterward.

## Render shows “Production access is not configured”

Private deployments require `SUNDOWN_ADMIN_PASSWORD` of at least 16 characters for workspace access. Set it through Render Environment, set `SUNDOWN_APP_URL` to the actual HTTPS origin, then Save and deploy. Use the website form at `/login`. Optional shared access works without an admin password unless `SUNDOWN_SHARED_ACCESS=false` disables public access. Never display or commit the real admin secret.
