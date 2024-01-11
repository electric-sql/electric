---
"@electric-sql/prisma-generator": patch
---

Revert change to generator to add .js extension to imports for nodenext compatibility as it broke for some bundlers.
