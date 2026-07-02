---
"@electric-ax/durable-streams-server-rust": patch
---

fix: recovery now truncates a torn, never-acked tail on streams with no
surviving WAL record and no checkpoint tails entry (e.g. a stream created
after the last checkpoint whose only in-flight append was torn by power
loss) — previously the torn fragment became reader-visible. The `.meta`
sidecar persists a `durable_tail` proof (riding along on existing fsynced
meta writes; no new hot-path fsyncs) and recovery seeds every stream's
durable frontier from it. Old sidecars keep the previous behavior until
their next natural meta write. Found by the crash/fault simulation
(seed 20230; details in `CRASH_SIM_FINDINGS.md`).
