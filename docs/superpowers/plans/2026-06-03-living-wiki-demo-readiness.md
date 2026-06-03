# Living Wiki demo readiness discovery

Date: 2026-06-03

## Current flow summary

The current Worker-local demo can be exercised from an empty app without copying internal IDs:

1. Open `/` and create a wiki space with a title, display name, and avatar color.
2. The app navigates to `/spaces/:wikiSpaceId` and stores the current actor identity locally.
3. Submit a text or URL source from the space page.
4. The dashboard refreshes `GET /api/spaces/:wikiSpaceId/shared-state-snapshot` and shows the source in the Sources panel.
5. Click the inline `Propose page` button on the submitted source.
6. The dashboard refreshes and shows an open review item plus a proposed page count.
7. Click the inline `Approve` or `Reject` button in the Review queue. No review-item ID copying is required.
8. The dashboard refreshes and shows the review resolved and the page moved to canonical or rejected.

Obvious UI blockers found: none for the happy path above. The flow is plain, but it has enough controls to demonstrate create space, source intake, page proposal, and review resolution. The main demo-readiness gap is repeatability: a presenter must type content and cannot recover quickly from an in-memory Worker reset or a bad manual run.

## Seeded demo flag status

`ENABLE_SEEDED_DEMO` currently only affects health reporting through `seededDemoEnabled`. It does not create rows, expose a seeded endpoint, add a seeded page link, or reset demo state.

Recommendation: make the next slice use this flag for a deterministic seeded demo scenario behind Worker-local demo endpoints and a small homepage link/action. This is more useful than copy polish alone because it creates a repeatable smoke path and proves the new proposal/review flow end to end.

## Recommended next smallest slice

Add a deterministic seeded demo scenario plus route smoke tests. Keep it Worker-local, non-persistent, and guarded by `ENABLE_SEEDED_DEMO === "true"`.

Why this slice:

- It removes the highest demo-friction item: manual setup before every run.
- It directly answers whether the current end-to-end flow works after fresh Worker-local state.
- It can be implemented quickly by composing existing store and producer methods.
- It provides a stable target for future UI polish and reset behavior.

Reset should be included only as a test/helper endpoint if it remains tiny and flag-gated. If time is tight, seed creation is higher value than reset because deterministic IDs/upserts can make reseeding safe enough for repeated clicks.

## Exact tasks

1. Add a Worker-local seeded scenario builder
   - Create one deterministic wiki space, owner actor, and one submitted text source.
   - Optionally include a second source only if it does not increase UI or test complexity.
   - Prefer deterministic IDs and idempotent upserts so repeated seed calls return the same scenario.
   - Use existing local adapters/builders; do not add persistence.

2. Add flag-gated REST endpoints
   - `POST /api/demo/seed` returns the seeded `WikiSpaceSnapshot` plus the seeded source ID if useful for assertions.
   - Optional: `POST /api/demo/reset` clears only Worker-local demo stores and only when seeded demo is enabled.
   - Return `404` or `403` when the flag is not enabled; do not expose this in production by accident.

3. Add homepage entry point
   - When health says seeded demo is enabled, show a `Start seeded demo` button or link on `/`.
   - The action calls `POST /api/demo/seed` and navigates to `/spaces/:wikiSpaceId`.
   - Avoid showing raw source/review IDs in the UI.

4. Add smoke coverage
   - Worker route tests for disabled seed, successful seed, idempotent seed, and optional reset.
   - App route/API tests that the seeded action navigates to the seeded space.
   - Extend the existing space route smoke test only if low-risk: seeded source appears, `Propose page` works, `Approve` works.

5. Update docs
   - README: add a short local demo script for seeded and manual paths.
   - Note that seeded state is Worker-local memory and not durable across isolates, reloads of Wrangler state, or deploys.

## Commands

Verification used during this discovery:

```bash
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
```

Expected next-slice verification:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/worker/index.test.ts src/app/api/livingWikiApi.test.ts src/app/routes/spaces.\$wikiSpaceId.test.tsx
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
```

Manual smoke after the next slice:

```bash
pnpm --filter @electric-ax/example-living-wiki dev
# Open http://localhost:5177
# Click Start seeded demo
# Click Propose page on the seeded source
# Click Approve in the review queue
# Confirm Recent activity, Sources, Wiki graph, and Review queue update
```

## Risks

- Worker-local memory can reset between isolates, so the seeded route must be framed as a demo bootstrap, not persistence.
- Deterministic IDs can collide with manually created spaces if the same fixed ID is allowed. Use an explicit seed namespace and idempotent writes.
- A reset endpoint is useful for demos but risky if exposed outside local/demo mode. Keep it flag-gated and consider omitting it from the first slice if seed idempotence is sufficient.
- Homepage health loading could make the seeded link flicker. Keep the UX simple and resilient when health fails.

## Security notes

- Do not expose Electric Cloud or Agents runtime secrets in seed responses, UI, or tests.
- Do not call upstream Agents runtime URLs from the browser.
- Keep seed/reset endpoints disabled unless `ENABLE_SEEDED_DEMO` is exactly `true`.
- Do not fetch seeded URL sources, scrape content, call LLMs, or claim generated analysis.
- Do not write to real runtime shared state, use observe protocol writes, call `ctx.mkdb`, call `ctx.observe`, or add durable persistence in this slice.
- Keep browser reads on the existing Worker-local snapshot fallback until a separate real observe implementation is planned.

## Out of scope for the next slice

- Real Electric Agents runtime writes or shared-state append APIs.
- Durable observe protocol implementation or replacing the snapshot fallback.
- LLM generation, source fetching, scraping, digesting, graph generation, and role orchestration.
- Durable persistence across Worker isolates/deploys.
- Multi-user conflict semantics beyond the current local demo actor model.

## Discovery result

Status: ready for the seeded demo scenario slice. Current tests and typecheck pass. The current manual happy path appears demoable without copying IDs; seeded bootstrap is the smallest high-impact improvement for repeatable demos.
