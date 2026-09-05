# Module review interface fixture

`module-review-admin-harness.tsx` exercises the real review workspace with clearly labelled synthetic
data. Its request adapter uses memory only. It has no wallet credentials, network requests, database
writes, reviewer authority, or publication capability. Keep it outside production routes.

For a local visual check, temporarily mount this development-only page, then remove it before committing
or running a release build:

```tsx
import { notFound } from "next/navigation";
import { moduleReviewAdminFixture } from "@/tests/fixtures/module-review-admin";
import { ModuleReviewAdminHarness } from "@/tests/fixtures/module-review-admin-harness";

export default function LocalFixturePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <ModuleReviewAdminHarness fixture={moduleReviewAdminFixture()} />;
}
```

The fixture host manifest is visible in its own disclosure at the bottom of the harness. It can be
copied into the manifest field. This rendering adapter intentionally returns the fixture manifest hash;
real validation is covered by `tests/module-review-admin-bff.test.ts` and remains in the authenticated
server client. A fixture screenshot proves interface behavior only.

Verified in the rendered local application on 6 September 2026:

- Production page presents its admin wallet gate without a connected session.
- Desktop 1280 × 720 and mobile 390 × 844 show a readable review workspace.
- Source opens as inert text; required author and reward wallets remain visible in detail.
- A checked manifest, successful current build, and all acknowledgements precede approval confirmation.
- Checkboxes, decision preview, and final confirmation work with keyboard Space/Enter and visible focus.
- A saved decision refreshes to the next revision and the terminal approved state.
- The simulated lost response sends exactly one decision, disables another send, and provides a current
  status read. Refresh retrieves the recorded next revision without resubmission.
- A failed build disables the approval option. An explicit plan can be queued for a new build.
- The mobile correction pass increased small metadata text and wrapped long wallet addresses. The
  corrected confirmation has no page overflow (390 CSS pixels); the wallet caption's scroll width
  equals its 254 CSS pixel content width. Tables and source keep their own scrollable regions.
- No browser console errors were observed. The webpack development server emits pre-existing optional
  Privy package warnings for `@stripe/crypto` and `@farcaster/mini-app-solana`.

The full authenticated production path, installed review worker, real database writes, publication,
and onchain admission require their independent integration evidence. This fixture proves none of them.
