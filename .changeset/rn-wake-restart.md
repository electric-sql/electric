---
"@electric-sql/client": patch
---

Fix ShapeStream wake reconnects in runtimes that do not preserve `AbortSignal.reason`, such as some React Native fetch/AbortController implementations.
