---
'@electric-ax/agents-server': patch
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents-runtime': patch
'@electric-ax/agents': patch
'electric-ax': patch
---

Add pull-wake runners — a polling-based dispatch mechanism where desktop runners register with the server and pull wake notifications from a dedicated stream instead of receiving webhook pushes. Includes runner registration, heartbeating with lease-based liveness, dispatch state tracking (pending → outstanding → claimed), callback-forward auth for runner-owned entities, asserted identity propagation, and periodic recovery of expired claims and stale wakes.
