---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
'@electric-ax/agents': patch
---

Require an explicit Electric shape endpoint URL for pg-sync observations. Source identity is derived from the shape options plus the observing tenant/principal/entity — ephemeral per-request fields (wakeId, runtimeConsumerId, streamPath) are excluded — so the same agent reuses one bridge across wakes while different principals get their own correctly-scoped streams. Registration validates the endpoint by fetching the shape log up front, failing with Electric's error instead of retrying silently, and a duplicate registration no longer resets a running bridge's bootstrap state (which could drop changes after a restart). Adds an `unobserve_pg_sync` tool so an agent can stop being woken by a shape stream it previously observed without affecting other observers.
