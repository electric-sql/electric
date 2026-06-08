---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents': patch
---

Fix leftover Docker sandbox containers (`electric-sbx-*`) piling up.

Sandbox containers are meant to be short-lived, but several gaps let them
outlive the work they were created for — opening the desktop app could leave
15+ containers running that were never explicitly started. This closes those
gaps so a container only exists while something is actually using it:

- **Created only when used.** A container now starts the first time an agent
  actually uses its sandbox (runs a command, reads/writes a file), so trivial
  wakes (scheduled ticks, bookkeeping) no longer spin one up.
- **Cleaned up on quit.** Shutdown now tears down idle containers immediately
  instead of leaving their delayed-teardown timers to die with the process.
- **Leftovers reclaimed at startup.** Containers are tagged with the process
  that created them; at startup, those whose owner is gone are reclaimed
  (throwaway ones removed, reusable ones stopped so their files survive), while
  containers a live process is still using are left untouched.

Also: a failed container setup step no longer strands an untracked container,
and all sandboxes are grouped under one `electric-sandboxes` entry in Docker
Desktop so they can be stopped/removed together.
