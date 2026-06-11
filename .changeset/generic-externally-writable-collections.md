---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents': patch
---

Add generic externally-writable custom collections for agent entity state. A collection opts in via `externallyWritable` on its definition; the runtime registers it with the server. Router writes go through `POST /:type/:id/collections/:collection`, which is authenticated, schema-validated, and stamps the authenticated principal into the change-event header — the client materializes that header into a read-only virtual column (`_principal`). Consumers can project custom collections into the entity timeline via the new `customSources` option on `createEntityTimelineQuery`. All other state stays agent-only by default. Comments are reimplemented as one such collection (declared on Horton and worker), with the UI writing via an optimistic action backed by the authenticated endpoint. Comments are genuinely per-agent: the canonical collection carries a `comments/v1` contract marker, the server reserves the `comments` collection name for that contract, and the UI only surfaces comment affordances (tab, composer mode, timeline merge) for entity types whose registration advertises it.
