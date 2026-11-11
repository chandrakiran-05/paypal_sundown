# Polish verification

The existing architecture and product features are unchanged. This pass fixes presentation and the runtime issues discovered while checking it.

| Area | Result | Root cause / change | File |
| --- | --- | --- | --- |
| Pipeline scene | Pass | Larger nodes, fitted orthographic camera, scenario labels, responsive layout, retained reduced-motion/WebGL fallback. Labels use ordinary DOM elements to avoid nested React root teardown errors. | `apps/web/components/scene.tsx` |
| Overview chart | Pass | Replaced the oversized serif zero with a smaller tabular numeral; the chart fills its card. Studio track sizes now match card content. | `apps/web/components/widgets.tsx`, `apps/web/components/studio.tsx` |
| Readiness | Pass | Number badges and checks use the product's border, color, and typography treatment. | `apps/web/components/dashboard.tsx`, `apps/web/app/globals.css` |
| Analytics microcopy | Pass | Increased small labels and muted-text contrast throughout dashboard cards and tables. | `apps/web/app/globals.css` |
| Landing layout | Pass | Bounded grid tracks and canvas containers to prevent intrinsic canvas width from squeezing the headline. | `apps/web/app/globals.css` |
| Dev overlay | Pass | Inlined the existing public AG Studio license; imported Bryntum structural/icon CSS; replaced deprecated task/dependency props; removed nested canvas label roots. No error-hiding configuration was added. | `apps/web/next.config.ts`, `apps/web/components/timeline.tsx`, `apps/web/components/scene.tsx`, `apps/web/app/globals.css` |

## Browser evidence

Checked all 21 product URLs in development: nine main pages and twelve site passports. No Next.js issue badges, console errors, or console warnings were observed in the final sweep. Production screenshots cover the same URLs. The landing screenshot was replaced after its intrinsic-width fix.

- [Screenshot gallery](../workspace/polish/screenshots/README.md)
- [Screenshot manifest](../workspace/polish/screenshots/manifest.json)
- [Development checks](../workspace/polish/dev-checks.json)

## PayPal retry

The updated sandbox REST credentials authenticate. The saved NVP credentials were also used by the legacy attempt. Secret values were moved into the ignored `.env.local`; `.env.example` remains a blank shareable template.

PayPal buyer approval rejects the migrated shop with: “This seller doesn't accept payments in your currency.” Both scenarios retain this real failure as `PAYPAL_CURRENCY_REJECTED`, along with their sandbox order IDs:

- Successful-checkout attempt: `20P06161H6161864R`
- Partial-refund attempt: `46L18945HY764514R`

Neither scenario reached capture, refund, or verified webhook settlement. The legacy flow also did not complete approval. These attempts are not reported as successful live payments. The sandbox merchant/buyer configuration must accept the shop's USD currency before approval can proceed.

Run evidence: `workspace/live-sandbox/fc00b512-61f3-4344-82cd-b3b86f75df93/`. Three regression tests cover hidden CAPTCHA frames, visible challenges, and the currency rejection.

## Final checks

After production screenshot review: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`. All pass; 64 tests across 11 test files.
