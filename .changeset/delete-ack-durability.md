---
"@electric-ax/durable-streams-server-rust": patch
---

fix: an acked DELETE is now durable before the 204 — the data-file and
sidecar unlinks (plus a parent-directory fsync) previously ran on a
detached background task, so a crash right after the ack resurrected the
stream with all its data on the next boot. Soft deletes (fork-referenced
streams) likewise persist the flag before acking. Found by the
crash/fault simulation (seed 20387; details in `CRASH_SIM_FINDINGS.md`).
