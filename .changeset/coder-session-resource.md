---
'@electric-ax/agents': minor
'@electric-ax/agents-runtime': minor
'@electric-ax/agents-server-ui': minor
---

feat(coder): split the coder entity into a thin wrapper + a coding-session resource

The coder entity used to own the session's full history on its own collections (`sessionMeta`, `cursorState`, `events`), which coupled the durable session state to a single entity instance. With this change the history (`transcript` + `sessionInfo`) lives on a standalone shared-state resource at a stable id (`coder-session/<entityId>`), and the wrapper entity tracks only its own run lifecycle (`runStatus`, `inboxCursor`).

Why: this is the prerequisite for forking a session, attaching multiple wrappers to the same history, sharing a coder URL across devices/users, and surfacing the same session through specialised viewers — all without entangling those use cases with the SDK runner that produces events.

Visible API additions on `@electric-ax/agents-runtime`:

- `codingSessionResourceSchema`, `codingSessionResourceId(entityId)`, `CODER_RESOURCE_TAG` — the resource schema + id helpers.
- `CodingSessionInfoRow`, `CodingSessionTranscriptRow`, `CodingSessionResourceSchema` — row + schema types.

Removed (clean break, pre-1.0): `CODING_SESSION_META_COLLECTION_TYPE`, `CODING_SESSION_CURSOR_COLLECTION_TYPE`, `CODING_SESSION_EVENT_COLLECTION_TYPE`. Coders created by older versions are not migrated; new coders use the new layout.
