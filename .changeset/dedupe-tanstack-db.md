---
'electric-ax': patch
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-mobile': patch
---

Dedupe `@tanstack/db` to a single instance.

`@tanstack/db` is effectively a singleton (collections/transactions/live
queries use `instanceof` checks and module-level state), but the lockfile had
drifted to several `0.6.x` copies, breaking StreamDB collections. Adds a root
`pnpm.overrides` entry collapsing the `0.6.x` line to `0.6.7`, scoped to
`>=0.6.0 <0.7.0` so the legacy example starters pinned to `0.0.x`/`0.5.8` are
untouched. Stopgap until `@durable-streams/state` ships `@tanstack/db` as a
peer dependency.

Also raises the `agents-mobile` iOS minimum deployment target to 16.4 (via
`expo-build-properties`). The chat renders in an Expo DOM WebView whose markdown
stack ships regex lookbehind, which JavaScriptCore only parses on iOS 16.4+;
below that the whole DOM bundle fails to parse and the chat renders blank.
