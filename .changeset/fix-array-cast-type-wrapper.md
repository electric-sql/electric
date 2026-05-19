---
'@core/sync-service': patch
---

Fix `@>` (and other array operators) returning 400 when the right-hand side uses a non-foldable `ARRAY[...]::T[]` outer cast, e.g. `"organization_ids" @> ARRAY[$1]::uuid[]` with a column or parameter inside the constructor. The where-clause parser was assigning the element type (`:uuid`) instead of the array type (`{:array, :uuid}`) to array-cast and array-implicit-cast functions, which made the `@>` operator overload lookup fail with `Could not select an operator overload`.
