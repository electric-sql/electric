---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents': patch
---

Fix Docker sandbox containers (`electric-sbx-*`) accumulating as zombies, and
stop creating containers for wakes that never use their sandbox:

- The boot sweep now reclaims RUNNING orphans whose owning process died
  (owner-pid label + in-container adoption marker), instead of only exited
  ephemeral leftovers — previously crash/quit leftovers were never cleaned up.
- Runtime shutdown flushes the debounced idle teardowns (stop persistent /
  remove ephemeral) instead of letting the unref'd timers die with the
  process, which leaked a running container on every quit.
- A failed post-start init no longer leaves a running, untracked container
  behind, and a 409 from inside creation is no longer misread as a name
  conflict (which "reattached" to a removed container).
- Sandbox creation is now lazy: the container is only created/started when a
  wake actually uses its sandbox, so backlog bursts of trivial wakes (cron
  ticks, bookkeeping) on runner reconnect no longer spin up containers.
  Terminal reclaim and spawn-`inherit` still work for never-used sandboxes,
  and concurrent container creations are capped to smooth real bursts.
- All sandbox containers carry `com.docker.compose.project=electric-sandboxes`
  so Docker GUIs group them and they can be stopped/removed together.
