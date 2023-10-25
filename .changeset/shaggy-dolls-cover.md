---
"create-electric-app": patch
---

Expose port 65432 used by the proxy and make it configurable. Modify the migration machinery to go through the proxy. Modify the starter template to use the new `ALTER TABLE ... ENABLE ELECTRIC` syntax.
