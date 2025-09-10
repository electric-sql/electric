# Possible Starter Improvements

These notes combine first‑time user experience feedback with code/documentation alignment suggestions to reduce confusion and smooth onboarding.

## Quickstart & Environment

- Clarify exact versions early: surface `.tool-versions` values (Node 20.19, pnpm 10.12, Caddy 2.10) in the README’s “Pre‑requisites” table so users don’t need to discover it later.
- Make the “first run” timeline explicit: Docker up → Vite starts → Caddy auto‑starts → open `https://tanstack-start-db-electric-starter.localhost` → migrate DB. A short ordered list prevents confusion.
- Add a “Common pitfalls” box:
  - Docker not running → `docker compose ps` shows nothing.
  - Caddy not trusted → run `caddy trust` (and how to uninstall trust for cleanup).
  - Port conflicts (3000/54321) → how to change ports in `docker-compose.yaml` and env.
  - Missing `.env` → copy from `.env.example`.
- Surface “how to see logs” quickly: `docker compose logs -f electric postgres` is great for debugging Electric/Postgres issues.

## Caddy & URLs

- Note that Caddy auto‑starts via a Vite plugin and rewrites `Caddyfile` on dev boot. Mention that the generated domain is `<project-name>.localhost` and that direct `http://localhost:5173` is only a fallback (and can be slower for Electric unless using h2).
- Briefly explain “why Caddy”: Electric shape delivery benefits from HTTP/2 multiplexing; link to the existing troubleshooting doc but summarize the performance rationale inline.
- Add a short “if Caddy fails” checklist: test `caddy start`, check that the `Caddyfile` was generated, confirm trusted root cert, stop any other Caddy instance.

## Electric SQL Shapes

- Align README examples with the actual code path. The code proxies shapes through server routes (`/api/todos`, `/api/projects`, `/api/users`) using `prepareElectricUrl` instead of hitting `http://localhost:3000/v1/shape` directly. Update the README example block to use the proxied `shapeOptions.url: '/api/<table>'` so newcomers don’t wire the wrong URL.
- Document the shape filter strategy used in each route:
  - `/api/projects`: projects owned by or shared with the user.
  - `/api/todos`: todos where the user is in `user_ids`.
  - `/api/users`: currently no filter (returns all users). Consider documenting privacy implications and showing how to filter to “members of current projects only” for production apps.
- Call out the `parser.timestamptz` option and when to add parsers for other Postgres types.
- Add a short note for Electric Cloud: in production, the proxy targets `https://api.electric-sql.cloud` and supports `ELECTRIC_SOURCE_ID`/`ELECTRIC_SOURCE_SECRET`. Document these env vars in README and `.env.example` under a “Production” section.

## TanStack DB Usage

- Emphasize the core rules in README (they currently live in `AGENTS.md`):
  - Reads: Electric SQL + `useLiveQuery` only.
  - Writes: Collection ops only; tRPC is called from collection `onInsert/Update/Delete`.
  - Always preload collections in route loaders before rendering.
- Ensure examples consistently destructure `useLiveQuery` as `{ data }` and show dependency arrays where relevant.
- Show a minimal example of cross‑collection join and a basic aggregate to illustrate “why TanStack DB”.
- Add an example of `onUpdate` and `onDelete` in README so users see the full CRUD pattern.

## Preload Consistency

- In `src/routes/_authenticated/project/$projectId.tsx`, the component uses `usersCollection` but the route loader only preloads projects and todos. To match the “ALWAYS preload collections” rule, add `await usersCollection.preload()` in the loader. Also call this out in docs as a best practice so newcomers don’t see an uninitialized collection.

## tRPC Patterns

- The code includes helpful comments about generating `txid` via `pg_current_xact_id()::xid::text`. Bring a short “Why txid?” explanation into README so users understand how optimistic writes reconcile with Electric.
- Reinforce “CRUD‑only” guidance for tRPC. If more complex multi‑step actions are needed, mention `createOptimisticAction` as the sanctioned escape hatch.
- Add a “Server authorization model” blurb for the example tables explaining the `WHERE` clauses in mutations (e.g., only owners can update projects; `arrayContains` for todo membership). This makes the demo’s authorization intentions obvious.

## Auth UX & Docs

- Login page UX is friendly; replicate a short version of the “dev mode allows any email/password” note in README so users know signup is on by default in dev and disabled in production.
- Document `trustedOrigins` in `src/lib/auth.ts`: explain the local hostnames/IP behavior and how to adjust if users change the dev domain or run over a different network interface.

## Database & Migrations

- Add a script for generating migrations (e.g., `"migrations:generate": "drizzle-kit generate"`) and document the “edit schema → generate → migrate” loop. Right now only `pnpm migrate` is listed.
- Mention the casing option in both `drizzle.config.ts` and the `db` connection to reinforce the snake_case requirement.
- Provide a quick “cleanup” section: `docker compose down -v` to reset local data.

## Production Notes

- Add a minimal production checklist:
  - Set `BETTER_AUTH_SECRET`.
  - Configure `ELECTRIC_SOURCE_ID`/`ELECTRIC_SOURCE_SECRET` if using Electric Cloud.
  - Swap the dev Electric container for your production Electric deployment (or remove in Docker for prod).
  - Enforce HTTPS and secure cookies.

## README Alignment & Clarity

- The “Data Fetching” section shows a generic loader `fetch` example. Add a note that for application data in this starter, use Electric + TanStack DB for reads; loaders are still useful for non‑DB data or preloading collection calls.
- Consider moving the core rules and naming conventions from `AGENTS.md` into README (or link to them) so first‑time users don’t miss them.
- Provide a short “Add a new table” walkthrough: 1) define Drizzle schema, 2) generate + migrate, 3) add `/api/<table>` shape route, 4) add collection with schema + `shapeOptions`, 5) add tRPC router and wire into client handlers, 6) preload in relevant routes, 7) use `useLiveQuery`.

## Code Quality Nits

- Remove unused deps if any (e.g., `@tanstack/react-router-with-query` is present but not referenced).
- Ensure all routes/components that rely on a collection have a corresponding preload in their route loader (see `usersCollection` note above).
- Consider switching demo IDs to UUIDs/ULIDs (or let server return IDs and rely on `txid` reconciliation) and add a doc note explaining why numeric random IDs are fine for demos but stable IDs are recommended in real apps.
- Add a tiny `vitest` sanity test for one utility (or a component) to verify the test harness works, or update `pnpm test` messaging to make it explicit that tests aren’t included.

## Troubleshooting Section (suggested)

- Add a README “Troubleshooting” section with copy‑paste commands and expected outputs for:
  - Docker services healthy: `docker compose ps`, `docker compose logs -f electric postgres`.
  - DB connectivity: `psql` or a quick Node script using `DATABASE_URL`.
  - Electric reachability: `curl 'https://tanstack-start-db-electric-starter.localhost/api/todos?...'` shows a 200 and a stream.
  - Caddy status: `caddy start`, `caddy stop`, certificate trust.

These tweaks should reduce first‑run friction and make the “how/why” of the architecture obvious while keeping the code paths consistent with the documented patterns.

