# Agents Markdown Docs Implementation Plan

## Goal

Add first-class collaborative markdown documents to Electric Agents.

Agents should be able to create a markdown document, add it to the entity
manifest, read it, and edit it with file-like replacement tools. Users should be
able to click the manifest entry, open a CodeMirror markdown editor in the
workspace, edit concurrently with other users, and see agent/user presence.

The first implementation intentionally does not require streaming tool calls or
runtime-level interception of assistant text. Streaming edits can be added after
the document model, auth, UI, and non-streaming tools are working.

## MVP Scope

### In scope

- A new manifest entry kind for collaborative markdown documents.
- One durable Yjs document stream per document, using
  `@durable-streams/y-durable-streams`.
- A CodeMirror markdown editor bound to `Y.Text`.
- User presence through Yjs awareness.
- Agent presence during document tools, including status and edit location.
- Agent tools for create/read/write/exact text replacement.
- Unified diff results from write/edit tools, matching the current file tool
  behavior.
- Explicit server auth for document Yjs stream paths.
- Forking support so forked entities receive forked document streams.

### Out of scope for MVP

- Token-by-token agent edits.
- Streaming tool arguments.
- Runtime routing of assistant text into documents.
- Rich-text CRDTs such as ProseMirror fragments.
- Markdown preview/render mode.
- Comments or suggestions inside docs.
- Document history UI beyond the Yjs/Durable Streams backing log.

## Core Design

### Manifest Entry

Add a new manifest entry kind rather than encoding docs as attachments.

Attachments are immutable, closed streams with byte length and sha256 semantics.
Markdown docs are mutable CRDT-backed resources, so they should be first-class
manifest entries with their own lifecycle and fork/auth behavior.

Proposed manifest shape:

```ts
type ManifestDocumentEntry = {
  key?: string
  kind: 'document'
  id: string
  title: string
  provider: 'y-durable-streams'
  docId: string
  docPath: string
  streamPath: string
  contentMimeType: 'text/markdown'
  transportMimeType: 'application/vnd.electric-agents.markdown-yjs'
  yTextName: 'markdown'
  createdAt: string
  createdBy?: string
  updatedAt?: string
  meta?: Record<string, JsonValue>
}
```

Recommended manifest key:

```ts
document:${id}
```

Recommended stream path:

```ts
/docs/agents/${entityType}/${instanceId}/documents/${id}
```

`docId` is the value passed to `YjsProvider`.

`docPath` is the provider-facing stable document path and should not have a
leading slash:

```ts
agents/${entityType}/${instanceId}/documents/${id}
```

`streamPath` is the Durable Streams document stream path used for auth, forking,
and debugging:

```ts
/docs/${docPath}
```

This shape follows the `y-durable-streams` URL contract. The provider requests:

```ts
{baseUrl}/docs/{docPath}?{queryParams}
```

For the agents server, use:

```ts
baseUrl = agentsServerUrl
docId = docPath
```

Do not set `baseUrl` to the raw `streamPath`; the provider appends `/docs/...`
itself.

### Yjs Document Model

Use a plain Yjs text type:

```ts
const ytext = ydoc.getText('markdown')
```

This keeps the MVP simple:

- The stored CRDT is binary Yjs updates.
- The logical document content is markdown text.
- CodeMirror can bind directly to `Y.Text`.
- Agent tools can operate on `ytext.toString()` and commit Yjs transactions.

### Mime Types

Use two concepts:

- `contentMimeType: 'text/markdown'` for what users and tools are editing.
- `transportMimeType: 'application/vnd.electric-agents.markdown-yjs'` for what
  is stored in the durable stream.

Do not label the durable stream itself as `text/markdown`; its bytes are Yjs
updates/snapshots.

## Implementation Areas

### 1. Runtime Types and Manifest Schema

Files:

- `packages/agents-runtime/src/entity-schema.ts`
- `packages/agents-runtime/src/types.ts`
- `packages/agents-runtime/src/manifest-helpers.ts`
- `packages/agents-server-ui/src/lib/ElectricAgentsProvider.tsx`

Tasks:

- Add `ManifestDocumentEntryValue`.
- Extend the manifest zod union with `kind: 'document'`.
- Export `ManifestDocumentEntry`.
- Add `manifestDocumentKey(id: string)`.
- Update UI-side manifest parsing/types to accept `kind: 'document'`.

Acceptance:

- Entity state can contain a `manifest` event with `kind: 'document'`.
- Existing manifest consumers continue to parse older entries.

### 2. Server Document API

Files:

- `packages/agents-server/src/entity-manager.ts`
- `packages/agents-server/src/routing/entities-router.ts`
- `packages/agents-runtime/src/runtime-server-client.ts`
- `packages/agents-runtime/src/types.ts`

Tasks:

- Add document validation helpers:
  - document id cannot be empty, start with `.`, or contain `/`.
  - title should be non-empty and bounded.
- Add `createDocument(entityUrl, req)`:
  - create durable Yjs backing stream if needed.
  - initialize the Yjs document with optional markdown text.
  - write the document manifest entry.
  - return `{ txid, document }`.
- Add `getDocument(entityUrl, id)`.
- Add `readDocument(entityUrl, id)` returning current markdown text.
- Add `writeDocument(entityUrl, id, content)` replacing the whole `Y.Text`.
- Add `editDocument(entityUrl, id, old_string, new_string, replace_all?)`.
- Add HTTP routes under entity API:
  - `POST /:type/:instanceId/documents`
  - `GET /:type/:instanceId/documents/:documentId`
  - `GET /:type/:instanceId/documents/:documentId/content`
  - `PUT /:type/:instanceId/documents/:documentId/content`
  - `PATCH /:type/:instanceId/documents/:documentId/content`

Open implementation choice:

- Preferred for MVP: put create/read/write/edit on the server API and expose
  them through `RuntimeServerClient`. This keeps auth, fork locks, and manifest
  writes in one place.
- Avoid direct runtime-tool writes to `YjsProvider` in the first cut. That is
  faster to prototype, but it spreads auth, fork locks, and stream path rules
  into the runtime.

Acceptance:

- Creating a doc appends a manifest row.
- Reading returns markdown text from the Yjs doc.
- Writing/editing produces Yjs updates, not manifest content mutations.
- Server rejects operations when the entity is stopped or fork-write-locked.

### 3. Durable Stream Yjs Integration

Files:

- `packages/agents-server/package.json`
- `packages/agents-server-ui/package.json`
- `packages/agents-runtime/package.json` if runtime tools manipulate Yjs locally.

Dependencies:

- `@durable-streams/y-durable-streams`
- `yjs`
- `y-protocols`
- `lib0`
- UI only:
  - `codemirror`
  - `@codemirror/state`
  - `@codemirror/view`
  - `@codemirror/lang-markdown`
  - `y-codemirror.next`

Tasks:

- Use `YjsProvider` for browser/editor connections.
- On server create/write/edit, either:
  - use `YjsProvider` server-side and wait for sync, or
  - use the y-durable-streams server utilities if exposed by the package.
- Always destroy providers after tool/server operations.
- For initial content, create a `Y.Doc`, set `getText('markdown')`, and persist
  through the provider.
- Keep the Yjs mount constants in one shared server module:
  - `docPathForDocument(entityUrl, documentId)`
  - `documentStreamPathForDocPath(docPath)`
  - `entityUrlFromYjsDocumentPath(path)`
  - `entityUrlFromYjsAwarenessPath(path)`

Acceptance:

- A browser editor and server operation converge on the same markdown text.
- New editor clients load through snapshot discovery and then live updates.

### 4. Durable Stream Auth

Files:

- `packages/agents-server/src/routing/durable-streams-router.ts`
- `packages/agents-server/src/routing/stream-append.ts`

Tasks:

- Add document path recognition for provider document requests:

```ts
function entityUrlFromYjsDocumentPath(path: string): string | null {
  const match = path.match(
    /^\/docs\/agents\/([^/]+)\/([^/]+)\/documents\/[^/]+(?:\/.*)?$/
  )
  if (!match) return null
  return `/${match[1]}/${match[2]}`
}
```

- Authorize `GET`/`HEAD` document stream access with entity read permission.
- Authorize `POST`/`PUT` document stream writes with entity write/manage rules
  or a dedicated document write permission rule.
- Inspect the installed `@durable-streams/y-durable-streams` package and add an
  equivalent `entityUrlFromYjsAwarenessPath(path)` for the exact awareness URL
  pattern used by the provider.
- Add route tests using real provider URL shapes for:
  - snapshot discovery and snapshot load.
  - live update reads.
  - local edit writes.
  - awareness reads/writes.
- Reject direct writes to document paths during fork locks.

Important:

The current durable-stream proxy explicitly guards entity streams, attachment
streams, and shared-state streams. Unknown paths intentionally pass through.
Document and document-awareness paths must not remain in that pass-through
bucket.

Acceptance:

- Unauthorized users cannot read, write, or observe awareness for document
  streams.
- Authorized users can edit through CodeMirror.
- Fork locks prevent concurrent writes while the subtree is being forked.

### 5. Forking

Files:

- `packages/agents-server/src/entity-manager.ts`

Tasks:

- Collect document stream paths from document manifest entries during fork
  snapshot reads.
- Lock document stream paths during fork, like shared-state streams.
- Fork each document durable stream from source to fork destination.
- Remap document manifest entries:
  - `streamPath`
  - `docPath`
  - `docId`
  - possibly `key` if document ids are rewritten.
- Keep document ids stable within a fork unless collisions require suffixing.

Acceptance:

- Forked entity opens an independent copy of each document.
- Editing a forked doc does not change the source entity's doc.
- Pointer forks include only document manifest entries visible at the fork point.

### 6. Runtime Tool Surface

Files:

- `packages/agents-runtime/src/tools/documents.ts`
- `packages/agents-runtime/src/tools.ts`
- `packages/agents-runtime/src/types.ts`
- `packages/agents-runtime/src/process-wake.ts`
- `packages/agents/src/bootstrap.ts`

Tasks:

- Add framework document tool factory.
- Extend `ProcessWakeConfig.createElectricTools` context with
  `principal?: RuntimePrincipal`, and pass `config.principal` through from
  `processWake`. Document tools need this for agent awareness state.
- Extend `ProcessWakeConfig.createElectricTools` context with document methods
  backed by `RuntimeServerClient`:
  - `createMarkdownDocument`
  - `readMarkdownDocument`
  - `writeMarkdownDocument`
  - `editMarkdownDocument`
- Add default built-in tools in `packages/agents/src/bootstrap.ts`, alongside
  event-source tools.
- Keep worker exposure explicit if desired. Horton already includes
  `ctx.electricTools`; Worker currently gets only selected tools.

Tool shapes:

```ts
create_markdown_doc({
  title: string,
  content?: string
})
```

```ts
read_markdown_doc({
  docId: string,
})
```

```ts
write_markdown_doc({
  docId: string,
  content: string,
})
```

```ts
edit_markdown_doc({
  docId: string,
  old_string: string,
  new_string: string,
  replace_all?: boolean
})
```

Tool behavior should mirror file tools:

- `read_markdown_doc`, `create_markdown_doc`, and `write_markdown_doc` mark the
  document as read in a per-wake read set.
- `edit_markdown_doc` must reject edits unless the document has been read or
  written in the same wake.
- `old_string` must occur exactly once unless `replace_all` is true.
- Return a useful error when not found or ambiguous.
- Return `details.diff` using `createTwoFilesPatch`.
- Return replacement counts and byte/char counts.

Acceptance:

- An agent can create a doc and then read/edit it with file-like tools.
- Tool call UI shows a diff for document edits without special casing if
  possible.

### 7. Agent Presence During Tools

Files:

- `packages/agents-runtime/src/tools/documents.ts`
- server-side document service module, if split from `entity-manager.ts`

Tasks:

- When a document tool edits content:
  - connect to the Yjs provider with an `Awareness` instance.
  - set local awareness state from the principal passed through
    `createElectricTools`, or from an agent principal derived by the server:

```ts
{
  user: {
    principalUrl,
    role: 'agent',
    name,
    color,
    status: 'editing'
  }
}
```

- Before applying a replacement, set the agent selection/cursor near the
  replacement range.
- Apply the Yjs transaction.
- Move cursor to the end of the replacement.
- Set status back to `idle` or destroy provider so awareness removal is
  broadcast.

Acceptance:

- While an agent edit tool is running, open editors see the agent presence.
- For quick edits this may be brief; that is acceptable for MVP.

### 8. UI: Document Manifest Rows

Files:

- `packages/agents-server-ui/src/components/EntityTimeline.tsx`
- `packages/agents-server-ui/src/lib/attachments.ts` or a new
  `documents.ts`

Tasks:

- Add `isDocumentManifest`.
- Display document rows as `Document`.
- Use the title as primary text.
- Show `text/markdown`, provider, and created metadata.
- Add an open action.
- Use workspace helper:

```ts
workspace.helpers.openEntity(entityUrl, {
  viewId: 'markdown-doc',
  viewParams: { docId: manifest.id },
})
```

Acceptance:

- Document manifests are not hidden as attachments.
- Clicking a document opens the editor view.

### 9. UI: CodeMirror Markdown Editor View

Files:

- `packages/agents-server-ui/src/lib/workspace/registerViews.ts`
- `packages/agents-server-ui/src/components/views/MarkdownDocumentView.tsx`
- new CSS module for the editor view.

Tasks:

- Register entity view:

```ts
registerView({
  kind: 'entity',
  id: 'markdown-doc',
  label: 'Docs',
  icon: FileText,
  Component: MarkdownDocumentView,
})
```

- Resolve `docId` from `viewParams`.
- Find document manifest from entity DB.
- Construct `Y.Doc`, `Awareness`, and `YjsProvider`.
- Use `baseUrl` pointing at the agents server durable-stream proxy.
- Bind CodeMirror to `ydoc.getText('markdown')`.
- Set local user awareness from `useCurrentPrincipal()`.
- Pass configured auth/principal headers to `YjsProvider.headers`, matching the
  rest of the agents UI request path.
- Render presence bar from awareness states.
- Destroy CodeMirror view/provider on unmount.

Acceptance:

- Two browser windows can concurrently edit one doc.
- Remote cursor/presence appears.
- Agent tool edits appear live in open editors.
- The editor survives tile split/open/close cycles.

### 10. Tests

Unit and integration tests should be added at the layer being changed.

Runtime:

- Manifest schema accepts document entries.
- Document tool exact replacement behavior matches file edit behavior.
- Diff details are returned.

Server:

- Create document writes manifest.
- Read/write/edit round trip through Yjs.
- Unauthorized durable stream document access is rejected.
- Forked docs are independent.

UI:

- Manifest row labels and open action.
- View registration.
- Editor view mounts with missing/invalid doc id states.

## Deferred Streaming Edit Work

The repo already has enough evidence for a later streaming path:

- `@mariozechner/pi-ai` emits `toolcall_start`, `toolcall_delta`, and
  `toolcall_end` provider events.
- `@mariozechner/pi-agent-core` forwards those as `message_update` while the
  assistant message is streaming.
- `packages/agents-runtime/src/pi-adapter.ts` currently only handles
  `text_delta` in `message_update`.
- `packages/agents-runtime/src/outbound-bridge.ts` currently persists tool calls
  only at `tool_execution_start` and final completion.

Later streaming options:

1. Surface tool argument deltas through the outbound bridge and persist partial
   args in the `toolCalls` collection.
2. Add a streaming document insertion tool whose string argument can be consumed
   incrementally.
3. Or add a runtime-level text routing mode. This is more invasive and should
   remain separate from the MVP.

This plan intentionally chooses non-streaming exact replacements first because
it avoids changing agent execution semantics.

## Open Questions

Resolve these inside the single PR before enabling the feature:

- Should document tools be enabled for all built-in agents by default, or only
  for Horton initially?
- Should workers be able to receive document tools by name in their spawn args?
- Should document stream write permission be tied to entity `manage`, entity
  `write`, or a new permission?
- Should document ids remain stable across forks, or be suffixed like shared
  state ids?

## Single PR Implementation Phases

Implement this as one PR. The phases below are sequencing for development and
review inside the branch, not separate merge boundaries. The PR should not be
merged with document creation/editing enabled until schema, server API,
auth, forking, tools, UI, presence, and tests are all complete.

### Phase 0: Provider Path Spike

Goal: remove uncertainty before changing product code.

Tasks:

- Inspect the installed `@durable-streams/y-durable-streams` package.
- Confirm the exact document request URLs for:
  - snapshot discovery.
  - snapshot load.
  - live update reads.
  - local edit writes.
- Confirm the exact awareness request URLs and methods.
- Capture helper names and URL examples in code comments/tests, not as
  free-floating assumptions.

Exit criteria:

- The implementation has concrete helpers for document and awareness path
  recognition.
- Route tests use real provider-shaped URLs.

### Phase 1: Schema and Shared Types

Tasks:

- Add `ManifestDocumentEntryValue`.
- Extend the manifest schema union.
- Export document manifest types.
- Add `manifestDocumentKey(id)`.
- Add shared document path helpers.
- Update UI manifest parsing/types.

Exit criteria:

- Existing entity streams still load.
- A synthetic document manifest row parses in runtime and UI tests.

### Phase 2: Server Document Service

Tasks:

- Add document id/title validation.
- Add create/get/read/write/edit document methods.
- Store initial markdown as `Y.Text('markdown')`.
- Return unified diffs from write/edit operations.
- Add entity API routes and `RuntimeServerClient` methods.
- Keep document writes server-mediated for MVP.

Exit criteria:

- Server tests can create, read, write, and exact-replace a markdown doc.
- Edit errors match the file edit tool behavior for missing/ambiguous strings.

### Phase 3: Auth and Fork Safety

Tasks:

- Authorize `/docs/agents/...` document paths.
- Authorize the matching y-durable-streams awareness paths.
- Reject unauthorized document reads/writes/presence.
- Lock document streams during fork work.
- Clone document streams during fork.
- Remap `streamPath`, `docPath`, and `docId` in forked manifest entries.

Exit criteria:

- Unauthorized users cannot read/write doc streams or awareness streams.
- Forked entities edit independent document streams.
- Pointer forks include only document manifests visible at the fork point.

### Phase 4: Runtime Tools

Tasks:

- Add document methods and `principal` to `createElectricTools` context.
- Add `create_markdown_doc`, `read_markdown_doc`, `write_markdown_doc`, and
  `edit_markdown_doc`.
- Maintain a per-wake read set.
- Require read/write/create before exact edit in the same wake.
- Add document tools to the built-in electric tool bundle.
- Decide and document Worker exposure in the same PR.

Exit criteria:

- Horton can create/read/write/edit a doc through tools.
- Tool results include `details.diff`.
- Tool behavior mirrors file tools closely enough that the existing tool UI is
  usable.

### Phase 5: UI Manifest and Editor

Tasks:

- Add document manifest row rendering.
- Add open action using `viewId: 'markdown-doc'` and
  `viewParams: { docId }`.
- Register the `markdown-doc` entity view.
- Add CodeMirror markdown editor bound to `ydoc.getText('markdown')`.
- Pass auth/principal headers to `YjsProvider`.
- Handle missing/invalid doc ids and provider errors.
- Destroy CodeMirror/Yjs resources on unmount.

Exit criteria:

- Clicking a document manifest opens the editor.
- Two editor tiles/windows can edit the same doc concurrently.
- Agent tool edits appear in open editors.

### Phase 6: Presence

Tasks:

- Set user awareness from `useCurrentPrincipal()`.
- Render presence states in the editor.
- Set agent awareness while document tools are running.
- Show agent status and cursor/edit location for replacements.

Exit criteria:

- Users see other active users in the document.
- Users see agent presence while an agent edit tool is applying a change.

### Phase 7: Verification

Tasks:

- Run runtime tests.
- Run server tests.
- Run UI tests.
- Run package typechecks.
- Manually verify the desktop flow:
  - agent creates a document.
  - manifest entry appears.
  - user opens it in a tile.
  - user edits it.
  - agent edits it with exact replacement.
  - two windows/tiles see concurrent updates and presence.
  - forked entity receives an independent document.

Suggested commands after `pnpm install` from repo root:

```sh
pnpm --filter @electric-ax/agents-runtime test
pnpm --filter @electric-ax/agents-server test
pnpm --filter @electric-ax/agents-server-ui test
pnpm --filter @electric-ax/agents-runtime typecheck
pnpm --filter @electric-ax/agents-server typecheck
pnpm --filter @electric-ax/agents-server-ui typecheck
```

Streaming edits should be a later design/implementation after the single PR
lands and the non-streaming collaborative document workflow is stable.
