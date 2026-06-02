# Living Wiki Demo Implementation Plan

**Status:** Draft implementation plan  
**Date:** 2026-06-02  
**Source design:** `docs/superpowers/specs/2026-06-02-living-wiki-demo-design.md`

## Planning stance

This plan implements the **Demo Day must-have path** first. The broader v1 scope from the design remains the target shape, but implementation should not expand until the core substrate-engineering demo works reliably.

Demo Day must show:

1. create/join a WikiSpace
2. join with lightweight identity
3. submit URL/text to private IntakeAgent
4. emit public ambient intake ActivityEvent
5. publish/attach accepted source into shared state
6. digest source into candidate WikiAgent pages
7. graph shows proposed faint nodes in multiple clients
8. open WikiAgent inspector and ask why it exists
9. approve page through ReviewBoard
10. page becomes canonical/solid
11. TopicCuratorAgent proposes one edge
12. approve edge
13. edge appears in graph
14. hover/inspector shows lineage
15. activity feed hides actor_kind by default and reveal toggle works

Stretch only after the above is stable:

- Steward reflection
- review-change-supersession loop
- fuzzy duplicate resolution
- merge animation
- full universal inspector tabs
- contradiction flags
- advanced topic clustering

## Target technical architecture

This demo should be a **Cloudflare Workers/Wrangler project** with a modern React frontend and a thin API layer that proxies to an Electric Agents space running in Electric Cloud.

Frontend stack:

- Vite
- React
- TanStack Router
- TanStack DB
- Base UI
- Inter font

API/deployment stack:

- Cloudflare Workers via Wrangler
- tRPC API exposed from the Worker
- REST endpoints where useful for simple client/proxy calls
- Worker API proxies to Electric Cloud / Electric Agents space
- local development stack that can run the Worker, Vite dev server, and local/proxied Electric Agents connection
- production deploy command through Wrangler

High-level topology:

```text
Browser
  ├─ Vite/React/TanStack Router UI
  ├─ TanStack DB local client state / synced queries
  └─ tRPC/REST calls
       ↓
Cloudflare Worker API
  ├─ tRPC router
  ├─ REST compatibility routes
  ├─ auth/session-light demo identity handling
  ├─ Electric Cloud proxy/client
  └─ environment secrets/config
       ↓
Electric Cloud
  └─ Electric Agents space
       ├─ persistent entities
       └─ per-WikiSpace shared-state DB
```

The frontend should not talk directly to Electric Cloud for privileged operations. The Worker API is the boundary for configuration, secrets, space lookup, entity message proxying, and production deployment.

Local development should support two modes:

1. **Cloud-proxy local dev**: local Worker/Vite frontend talks to a real Electric Cloud space using dev credentials.
2. **Seeded/demo local dev**: local app uses deterministic seed/fallback data where model or cloud connectivity is unavailable.

Production should deploy as a Wrangler project with clear commands, e.g. `pnpm dev`, `pnpm dev:worker`, `pnpm dev:vite`, and `pnpm deploy` or repo-conventional equivalents. Exact names should be finalized after inspecting package conventions.

## Implementation phases

Detailed implementation plans are split by independently testable subsystem. The first detailed plan is `docs/superpowers/plans/2026-06-02-living-wiki-scaffold.md`, covering the Wrangler/Vite/React/TanStack/tRPC scaffold and API foundation.

### Phase 0 — Orient in repo, scaffold Wrangler app, and verify cloud proxy

Goal: decide where the demo lives, scaffold the Cloudflare/Vite app, and verify it can reach an Electric Agents space in Electric Cloud.

Tasks:

- Inspect existing example app structure, especially `examples/deep-survey`, but do not assume its server topology is the right frontend/API shape for this demo.
- Choose implementation location:
  - likely `examples/living-wiki`
  - or another repo-conventional demo location
- Scaffold/configure:
  - `wrangler.toml`
  - Vite React app
  - TanStack Router route tree
  - TanStack DB setup
  - Base UI theme/components
  - Inter font loading
  - Worker entrypoint
  - tRPC router
  - REST proxy routes
- Confirm Electric Agents/Electric Cloud APIs for:
  - creating/finding an Electric Agents space
  - proxying entity messages
  - reading/observing shared-state DB collections from the client/API boundary
  - `registry.define`
  - `ctx.mkdb`
  - `ctx.observe(db(...))`
  - `ctx.send`
  - `ctx.spawn`
  - entity URLs and client subscriptions
- Define local/prod environment variables and secret names, e.g.:
  - Electric Cloud API URL
  - Electric Cloud API token
  - Electric Agents space ID or project ID
  - demo seed mode flag
- Add local development commands and production deploy command.

Deliverable:

- Wrangler/Vite/TanStack app scaffold with Worker API, tRPC health route, REST health route, and stub UI route.

Verification:

- `pnpm dev` or equivalent starts local dev stack
- stub route renders with Inter font/Base UI styling
- Worker health endpoint responds locally
- tRPC health procedure responds locally
- Worker can reach or intentionally mock/proxy the configured Electric Cloud space
- `pnpm deploy` or equivalent deploys the Worker/frontend bundle to Cloudflare

## Phase 0.5 — Worker API boundary and client data access

Goal: define the API contract between the React frontend and the Electric Agents space.

Worker responsibilities:

- resolve/create demo WikiSpaces
- maintain lightweight demo session identity
- proxy entity inbox messages to Electric Cloud
- expose shared-state reads/subscriptions or signed/proxied connection details as repo/runtime supports
- expose mutations that should be validated at the app boundary, such as review approvals and publish-source actions
- hide Electric Cloud secrets from the browser

tRPC procedures, initial set:

- `health()`
- `space.create({ title, displayName, avatarColor })`
- `space.join({ wikiSpaceId, displayName, avatarColor })`
- `space.get({ wikiSpaceId })`
- `agent.sendMessage({ entityUrl, message, clientMessageId })`
- `intake.submit({ wikiSpaceId, actorId, content, kind })`
- `intake.publish({ intakeRunId })`
- `review.resolve({ reviewRequestId, decision, note })`
- `seed.resetDemoSpace()` / `seed.populateDemoSpace()` for rehearsal only

REST routes, initial set:

- `GET /api/health`
- `POST /api/spaces`
- `POST /api/spaces/:id/join`
- optional webhook/proxy routes if Electric Cloud requires them

Frontend data access:

- use TanStack Router for route loading/navigation
- use TanStack DB for local query/materialized state where appropriate
- use tRPC for commands and API reads
- use Electric/TanStack DB subscription primitives if available through the Worker/proxy boundary; otherwise begin with polling/SSE/WebSocket fallback and replace once the repo-supported pattern is confirmed

Deliverable:

- typed tRPC router and client wrapper
- REST health/create/join endpoints
- frontend API client utilities

Verification:

- browser can create/join a space through Worker API
- browser never needs Electric Cloud secrets
- local and deployed Worker can both reach configured Electric Cloud or seeded fallback

## Phase 1 — Shared-state schema and typed helpers

Goal: create the per-WikiSpace substrate.

Collections:

- `wiki_spaces`
- `actors`
- `activity_events`
- `sources`
- `wiki_pages`
- `wiki_sections`
- `wiki_edges`
- `topics`
- `review_boards`
- `review_requests`
- `chat_messages`

Initial minimal shapes:

```ts
type WikiSpace = {
  id: string
  title: string
  created_at: string
  created_by_actor_id: string
  wiki_space_agent_id: string
  shared_state_db_id: string
  review_board_record_id: string
  review_board_agent_id?: string
}

type Actor = {
  id: string
  wiki_space_id: string
  kind: 'human' | 'agent'
  display_name: string
  avatar_color?: string
  entity_id?: string
  created_at: string
}

type ActivityEvent = {
  id: string
  wiki_space_id: string
  actor_id: string
  actor_kind: 'human' | 'agent'
  actor_entity_id?: string
  actor_entity_type?: string
  verb: string
  target_entity_id?: string
  target_entity_type?: string
  related_entity_ids: string[]
  visibility: 'public' | 'ambient' | 'private'
  summary_payload: Record<string, unknown>
  private_payload_ref?: string
  created_at: string
}
```

Implementation notes:

- Use stable IDs for derived rows.
- All shared-state mutations should append an `activity_events` row in the same logical operation.
- Keep raw private intake content out of shared-state DB.
- Build typed helper functions for common writes:
  - `appendActivityEvent`
  - `createActor`
  - `createReviewRequest`
  - `resolveReviewRequest`
  - `upsertSource`
  - `upsertWikiPage`
  - `upsertWikiEdge`

Deliverable:

- schema file and write helpers.

Verification:

- unit tests or simple script can create a WikiSpace DB and insert/read each record type.

## Phase 2 — Entity registration and role manuals

Goal: register persistent entity types and give each role scoped context/tools.

Persistent entities:

- `wiki_space`
- `intake`
- `source`
- `wiki`
- `topic_curator`
- optional for Demo Day: `review_board`

Do not make these agents in Demo Day:

- ReviewRequest
- WikiEdge
- individual claims
- individual proposals

Role manuals/context files:

- `prompts/wiki-space.md`
- `prompts/intake.md`
- `prompts/source.md`
- `prompts/wiki.md`
- `prompts/topic-curator.md`
- `prompts/review-board.md`

Each role manual should include:

- role purpose
- observable field / context sources
- allowed tools
- review gates
- privacy rules
- provenance expectations
- bad-attractor warnings

Important principle:

> Context window = materialized view over substrate. Role manuals and retrieved examples guide interpretation, but shared-state records and events are source of truth.

Deliverable:

- registered entity handlers with stub logic and role manuals loaded into context.

Verification:

- can create one entity of each type
- can send an inbox message and receive a basic response

## Phase 3 — WikiSpace creation/join flow

Goal: create a multiplayer space with lightweight identities.

User flow:

1. landing page asks for wiki title, display name, avatar color
2. create WikiSpaceAgent
3. WikiSpaceAgent first wake creates shared-state DB
4. create `wiki_spaces`, first human `actors`, `review_boards`
5. ensure root/default TopicCuratorAgent
6. show space URL/invite link
7. second browser can join with display name/color

Implementation details:

- Lightweight identity stored in local/session storage.
- All joined humans can review/edit in v1.
- Join URL contains or resolves `wiki_space_id`.

Deliverable:

- create page
- join page
- shared space shell

Verification:

- two browsers join same space and see same title/actor list
- `human.joined` events appear in shared state

## Phase 4 — Activity feed and actor-kind reveal

Goal: make the substrate visible early.

UI:

- right rail activity feed
- default text hides `actor_kind`
- reveal toggle shows Human/Agent prefix
- fixed renderer for known verbs

Minimum event verbs:

- `space.created`
- `human.joined`
- `intake.submission_received`
- `intake.digest_completed`
- `source.created`
- `source.digest_started`
- `source.digest_completed`
- `source.candidate_pages_emitted`
- `wiki.proposed`
- `review.requested`
- `review.approved`
- `wiki.canonicalized`
- `edge.proposed`
- `edge.approved`

Deliverable:

- live right rail feed.

Verification:

- events inserted by one client/entity appear in all clients
- actor-kind reveal works

## Phase 5 — Private IntakeAgent and publish boundary

Goal: let users submit material privately and publish into the shared substrate.

Flow:

1. user writes URL/text in private intake box
2. message sent to that user’s IntakeAgent
3. IntakeAgent creates private digest/summary
4. IntakeAgent emits ambient public metadata only
5. UI shows “Publish digest? [Yes]”
6. on publish, create or attach SourceAgent/source record

Demo Day simplifications:

- No full URL extraction needed initially; accept URL/title/text and summarize with LLM or deterministic fallback.
- Same URL duplicates can auto-attach.
- Fuzzy duplicate handling can be stretch.

Scoped IntakeAgent tools:

- `emit_ambient_intake_event`
- `create_or_attach_source`
- `publish_intake_digest`

Deliverable:

- private intake panel
- public ambient event
- source creation after publish

Verification:

- raw pasted private content is not visible in shared activity feed
- accepted source appears in shared `sources`

## Phase 6 — SourceAgent digest to candidate pages

Goal: turn an accepted source into proposed wiki pages.

Flow:

1. SourceAgent wakes on source creation or explicit digest request
2. writes `source.digest_started`
3. creates digest summary and lightweight claims
4. writes candidate page proposals
5. ensures corresponding WikiAgent entities/page rows
6. writes `source.candidate_pages_emitted` and `wiki.proposed`

Demo Day simplification:

- Extract 1–3 candidate pages per source.
- Use deterministic fallback if model output fails.
- Keep claims local/simple; no global claim graph.

Scoped SourceAgent tools:

- `update_source_digest`
- `propose_wiki_page`
- `request_source_duplicate_review` only if needed

Deliverable:

- SourceAgent digest path
- proposed wiki page rows

Verification:

- accepting one source creates at least one faint graph node
- source inspector can show digest and candidate pages

## Phase 7 — Graph/map MVP

Goal: primary wow surface.

Render:

- WikiAgent pages as nodes
- WikiEdges as edges
- TopicCuratorAgent/default topic as cluster or grouping
- proposed nodes faint
- canonical nodes solid
- proposed edges dashed
- approved edges solid
- recent activity pulse from `activity_events`

Demo Day layout:

- client-side force/layout is fine
- no persisted positions
- store only cluster membership/edges

Interactions:

- click node opens WikiAgent inspector
- click edge opens edge/review detail
- hover node/edge shows lineage summary

Deliverable:

- live graph view.

Verification:

- graph updates in two clients
- proposed nodes appear after source digest
- canonical node style updates after approval
- approved edge appears after approval

## Phase 8 — WikiAgent inspector and page approval

Goal: human can interrogate and approve a proposed page.

Inspector tabs for Demo Day:

- Chat
- Artifacts
- Lineage
- Events

Minimum content:

- title
- status
- summary
- backing sources
- lightweight claims
- recent events
- pending review action

Approval flow:

1. proposed WikiAgent creates or already has `approve_wiki_page` ReviewRequest
2. left rail shows Page Approvals
3. human approves
4. `review.approved` event written
5. WikiAgent/page transitions to `canonical`
6. `wiki.canonicalized` event written
7. graph node solidifies

Scoped WikiAgent tools:

- `explain_existence`
- `request_review`
- `canonicalize_after_review_approval`
- `suggest_section_edit`
- `update_section_after_human_confirmation`

Deliverable:

- inspector with chat and approve path.

Verification:

- user asks “why should this exist?” and gets grounded answer
- approval changes page status in all clients

## Phase 9 — ReviewBoard queues

Goal: support hard human gates with a simple queue UI.

Queues:

- Page Approvals
- Link Proposals

Stretch queues:

- Outline Reviews
- Draft Reviews
- Merge Decisions
- Contradiction Flags
- Source Duplicates

ReviewRequest fields:

- kind
- status
- title
- summary
- proposal_payload
- requester_agent_id/type
- target_entity_id/type
- blocks_agent_until_resolved
- supersession fields

Demo Day transitions:

- `pending → approved`
- `pending → rejected`

Stretch:

- `pending → changes_requested → superseded → pending`

Deliverable:

- left rail queue counts
- selected review details
- approve/reject buttons

Verification:

- queue count updates live
- approval unblocks page/edge transition

## Phase 10 — TopicCuratorAgent and one edge proposal

Goal: demonstrate agents gardening the graph.

Flow:

1. TopicCuratorAgent observes new canonical page or debounced wiki page changes
2. finds at least one plausible pair
3. creates proposed `wiki_edges` row
4. creates `approve_edge` ReviewRequest
5. emits `edge.proposed` and `review.requested`
6. human approves
7. edge status becomes `approved`
8. emits `edge.approved`
9. graph draws solid edge

Demo Day simplification:

- Use simple heuristic: propose edge between newest canonical page and an existing canonical/proposed page sharing topic hints/source overlap.
- If only one page exists, wait.
- If model fails, use deterministic related edge for seeded demo data.

Scoped TopicCuratorAgent tools:

- `propose_edge`
- `request_review`
- `update_topic_cluster`

Deliverable:

- at least one proposed/approved edge flow.

Verification:

- approving edge updates graph live
- edge tooltip shows rationale and lineage

## Phase 11 — Lineage and hover tooltips

Goal: make the trace field legible.

Lineage sources:

- `activity_events.related_entity_ids`
- target entity event history
- ReviewRequest status/history
- source/page/edge backing IDs

Minimum tooltip:

Node:

- title
- status
- backing source count
- seeded by source titles
- recent events
- open inspector

Edge:

- source/target titles
- edge type/status
- proposed by
- rationale
- backing source IDs
- review status

Deliverable:

- hover tooltip and inspector lineage tab.

Verification:

- tooltip for node/edge can explain source → page → review → canonical/edge path

## Phase 12 — Direct human canonical edits

Goal: show humans can directly shape canonical prose through WikiAgent.

Flow:

1. human asks WikiAgent to edit canonical page
2. WikiAgent proposes edit
3. human confirms Apply
4. write `wiki.section_updated_after_human_confirmation`
5. update `wiki_sections`
6. attribution is human actor

No review required in v1 for explicit human-confirmed canonical prose edits.

Deliverable:

- minimal article view/edit-with-agent flow.

Verification:

- edit appears in all clients
- event attribution is human

## Phase 13 — Demo rehearsal hardening

Goal: make it showable.

Required rehearsal outcomes:

- first visible graph growth within ~2 minutes
- two browser sessions stay in sync
- at least one source produces proposed page
- one page approval solidifies node
- one curator edge approval draws edge
- hover lineage works
- actor-kind reveal works

Fallbacks:

- seed source set
- pre-populated WikiSpace
- deterministic model fallback data
- recorded fallback/demo video

Observability:

- simple debug panel or console logs for wakes/events
- visible event log for power users
- test script to seed/reset demo state

## Cross-cutting implementation rules

### Idempotency

Use stable IDs for derived artifacts:

- `source:${sourceId}:claim:${index}`
- `wiki:${normalizedTitle}` or source-derived stable proposal ID
- `edge:${sourceWikiId}:${targetWikiId}:${edgeType}`
- `review:${targetId}:${kind}:${revision}`

Handlers should be safe to re-run on coalesced/at-least-once wakes.

### Scoped observation

Do not wake every agent on every activity event.

Suggested watches:

- IntakeAgent: inbox only for Demo Day
- SourceAgent: source row changes / inbox
- WikiAgent: own page row, relevant ReviewRequests, inbox
- TopicCuratorAgent: debounced wiki_pages/wiki_edges/review_requests
- ReviewBoardAgent: review_requests, inbox
- WikiSpaceAgent: broad summary only if needed

### Scoped tools

LLM agents should not get broad collection CRUD. Each tool should:

1. validate role and target
2. write typed state
3. append ActivityEvent
4. return structured result

### Privacy

- raw IntakeAgent submissions stay private
- ambient events contain safe metadata only
- accepted source digest becomes public
- no raw pasted text in shared DB unless explicitly published

### Review gates

Agent actions requiring review:

- canonicalizing page
- approving edge
- merging pages
- resolving ambiguous duplicate
- accepting contradiction/tension edge

Exempt in v1:

- human-confirmed canonical prose edits
- source digestion
- ambient intake metadata
- question-answering
- proposals that remain proposed

## Suggested file/module shape

If the demo lives at `examples/living-wiki`:

```text
examples/living-wiki/
  package.json
  wrangler.toml
  vite.config.ts
  tsconfig.json
  src/
    worker/
      index.ts              # Cloudflare Worker entrypoint
      trpc.ts               # tRPC app/router wiring
      routes.ts             # REST routes / proxy endpoints
      electric-cloud.ts     # Electric Cloud client/proxy helpers
      session.ts            # lightweight demo identity/session helpers
      env.ts                # typed env bindings
    agents/                 # Electric Agents entity definitions if colocated here
      entities/
        wiki-space.ts
        intake.ts
        source.ts
        wiki.ts
        topic-curator.ts
        review-board.ts
      workers/
        source-digest-worker.ts
        curator-sweep-worker.ts
      schema.ts
      tools/
        activity.ts
        review.ts
        source.ts
        wiki.ts
        edge.ts
      prompts/
        wiki-space.md
        intake.md
        source.md
        wiki.md
        topic-curator.md
        review-board.md
    app/
      main.tsx
      router.tsx
      routeTree.gen.ts      # if TanStack Router generation is used
      routes/
        __root.tsx
        index.tsx
        spaces.$wikiSpaceId.tsx
      components/
        ActivityFeed.tsx
        ActorKindToggle.tsx
        IntakePanel.tsx
        LivingGraph.tsx
        EntityInspector.tsx
        ReviewQueue.tsx
        ArticleView.tsx
      hooks/
        useWikiSpace.ts
        useActivityFeed.ts
        useGraphData.ts
        useEntityInspector.ts
      styles/
        globals.css         # Inter font, Base UI/theme tokens
    shared/
      api.ts                # tRPC client/shared types
      ids.ts
      event-rendering.ts
      types.ts
      db.ts                 # TanStack DB setup
```

Adjust paths to match repo conventions after Phase 0.

## Open implementation questions

Resolve during Phase 0/1:

- Exact shared-state schema API shape in this repo.
- Exact client subscription pattern for shared DB and entity streams.
- Whether private IntakeAgent artifacts should use entity-local DB state, timeline messages, or another private artifact mechanism.
- Whether SourceAgent digest should be a child worker or direct handler call for Demo Day.
- How to represent entity URLs/IDs in shared-state rows.
- Whether ReviewBoardAgent is needed for Demo Day or can be deferred.
- Exact Electric Cloud API/client package and auth mechanism from a Cloudflare Worker.
- Whether shared-state subscriptions can be proxied cleanly through Worker, or whether the browser should receive scoped/signed connection details.
- Whether the Worker serves the Vite static assets directly or uses Cloudflare Pages + Worker/API routing, depending on repo/deploy convention.
- Final command names for local dev and production deploy.

## Acceptance criteria for Demo Day plan completion

The implementation is demo-ready when:

- a new WikiSpace can be created and joined by two browser sessions
- both clients see the same activity feed and graph
- private intake produces public ambient trace and accepted public source
- source digest produces proposed WikiAgent/page nodes
- human approval turns a proposed page canonical
- TopicCuratorAgent proposes an edge between pages
- human approval turns edge approved and visible
- lineage tooltip explains node/edge history
- actor-kind reveal works
- seeded fallback state and recorded fallback exist
- app runs locally through the Wrangler/Vite development stack
- production deploy command publishes the Worker/frontend and can connect to Electric Cloud
