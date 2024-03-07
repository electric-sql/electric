---
"electric-sql": patch
---

Reverted CLI to use Prisma v4 instead of v5 because Prisma v5 introduces breaking type changes in the generated client which caused type errors in the generated Electric client.
