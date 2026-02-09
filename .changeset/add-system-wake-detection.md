---
'@electric-sql/client': patch
---

Fix ShapeStream hanging after system sleep in non-browser environments (Bun, Node.js). Stale in-flight HTTP requests are now automatically aborted and reconnected on wake, preventing hangs until TCP timeout.
