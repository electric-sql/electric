---
"@electric-ax/agents-mobile": patch
"@electric-ax/agents-server-ui": patch
---

Bring the fork capability to mobile at parity with desktop:

- **Whole-subtree fork.** A gated **Fork subtree** item in the session kebab (`SessionMenu`) — root-only (`!entity.parent`), disabled when the session is stopped/killed or the caller lacks the `fork` permission, with a single-flight guard, a pending spinner, and an inline error; on success it navigates to the new root. Backed by a native `forkEntity` in `agentsClient` (POST `…/fork`, empty body = whole-subtree HEAD clone) built on the shared `entityApiUrl` helper and exposed through `AgentsProvider`. `SESSION_PERMISSIONS` gains `fork`, and a `git-fork` glyph is added to the native icon set.
- **Per-message "Fork from here".** The pointer fork already rendered via the shared `ChatLogView` embed; its mutation now runs through native RN networking instead of the WebView's `fetch`. `createForkEntity` gains an optional transport and the embed injects a marshalled `onRequestForkEntity`, so the embed's only mutation uses the same native path every other mobile mutation already uses (mirroring desktop's Electron IPC routing), while keeping the shared failure-toast behaviour.
- **Embedded button hardening.** Extracted a tested `singleFlight` primitive, added a spinner + disabled state to the embedded fork button, and mounted a `ToastProvider` inside the embed so fork failures surface in the WebView instead of vanishing into a listener-less bus.

No server API changes.
