---
"@electric-ax/agents-desktop": patch
---

Give the desktop pull-wake runner a distinguishable label instead of the
hardcoded `Electric Agents Desktop`, so multiple runners are easy to tell
apart in the mobile/desktop runner picker. The label now defaults to
`<identity> · <hostname>`, where identity is the signed-in Cloud name
(falling back to email, then `Electric Desktop`). It can be overridden via
the `pullWakeRunnerLabel` setting in `settings.json` or the
`ELECTRIC_DESKTOP_PULL_WAKE_RUNNER_LABEL` env var. Existing runners pick up
the new label automatically on next launch (registration upserts on the
stable runner id).
