# Living Wiki final demo audit

Date: 2026-06-03

## Scope

Audited the Living Wiki seeded-demo path and surrounding docs/UI/API/tests after `027230106 feat(living-wiki): show wiki page cards`.

Reviewed:

- `examples/living-wiki/README.md`
- `examples/living-wiki/src/app/routes/index.tsx`
- `examples/living-wiki/src/app/routes/spaces.$wikiSpaceId.tsx`
- `examples/living-wiki/src/app/components/wiki-state/*`
- `examples/living-wiki/src/app/selectors/wikiStateViewModels.ts`
- `examples/living-wiki/src/worker/routes.ts`
- `examples/living-wiki/src/worker/seeded-demo.ts`
- route/dashboard/API/worker tests for the demo flow

## Findings

The demo is close. The main flow no longer requires manual ID copying: submitted sources expose inline **Propose page** actions and open reviews expose inline **Approve** / **Reject** actions. Worker tests cover seeded seed/reset and the seeded happy path from source to approved canonical page. API boundary tests cover not leaking Agents secrets through health responses, and proxy tests cover the upstream boundary.

Small remaining polish blockers for a final seeded-demo presentation:

1. **Seeded identity storage copy is inconsistent.** The README says the seeded demo actor identity is stored in browser session storage, but the app writes it to `window.localStorage` via `writeDemoSessionIdentity(window.localStorage, ...)`. This is small but confusing for a demo/debugging audience.
2. **Final demo actions lack clear success/busy feedback.** The homepage disables seeded-demo buttons while seeding/resetting, and the space page disables source/review actions while submitting, but button text and status copy do not change. Source submission, page proposal, and review resolution also refresh silently on success. During a live demo this can look like nothing happened until the dashboard refresh appears.
3. **Review buttons are ambiguous when multiple review items exist.** Each open review renders generic `Approve` and `Reject` buttons. Screen-reader users and test/debug output cannot distinguish which review item a button resolves without adjacent context.
4. **README has useful commands but no concise smoke checklist.** It documents dev commands and the seeded/manual paths, but not a one-command/manual smoke script with expected visible milestones (seeded source appears, propose page creates review item/page card, approve makes canonical page). This is the most useful final-demo doc addition.

## Recommended smallest final implementation slices

### Slice 1 — Docs/demo copy consistency

- Update `examples/living-wiki/README.md` to say seeded identity is stored in browser `localStorage` (or change the app to `sessionStorage`; choose one and keep docs/tests aligned).
- Add a short **Smoke test** section:
  - seeded: `ENABLE_SEEDED_DEMO=true pnpm --filter @electric-ax/example-living-wiki dev`, click **Start seeded demo**, verify the seeded source, click **Propose page**, verify one open review and a proposed page card, click **Approve**, verify canonical page count/card.
  - manual: `pnpm --filter @electric-ax/example-living-wiki dev`, create a space, submit a text source, propose, approve.

### Slice 2 — UI status/accessibility polish

- Add small `aria-live="polite"` status messages and busy button labels for source submission, page proposal, review resolution, seeded start/reset, e.g. “Submitting source…”, “Source submitted.”, “Proposing page…”, “Page proposal created.”, “Resolving review…”, “Review approved.”
- Give review action buttons item-specific accessible names, e.g. `aria-label="Approve review: ${item.suggested_change}"` and `aria-label="Reject review: ${item.suggested_change}"`, while keeping visible labels short.
- Add/adjust route/dashboard tests for the status messages and review button accessible names.

These two slices keep the scope small and avoid a larger product phase while improving live-demo clarity and accessibility.

## Checks

To be run after this audit note:

```bash
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
```
