---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
'@electric-ax/agents': patch
---

Require an explicit Electric shape endpoint URL for pg-sync observations. Source identity is now derived from the shape options alone (not per-request metadata) so re-registrations reuse the same bridge and stream, and registration validates the endpoint by fetching the shape log up front, failing with Electric's error instead of retrying silently.
