---
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents-desktop': patch
---

Add a runner picker to the new-session view so users can choose which pull-wake runner handles a spawned entity. Defaults to the Electron shell's own runner when it's one of the enabled choices (preserves the previous single-runtime behaviour) and falls back to the first enabled runner otherwise. The picker is only rendered when at least one runner is registered, so servers using webhook-based dispatch are unaffected. Also extends `Select.Trigger` with an optional `renderValue` prop so triggers can show a human-readable label when option values are opaque keys (e.g. runner ids).
