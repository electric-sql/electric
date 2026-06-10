---
'@electric-ax/agents-server': patch
---

agents-server: harden the Electric shape proxy (`/_electric/electric/v1/shape`) against access-control bypasses. Requests for tables outside the explicitly scoped allowlist are now rejected with `403 TABLE_NOT_ALLOWED` instead of being forwarded with the privileged Electric secret and no row/column filter. Client-supplied `where` clauses that are not self-contained (unbalanced parentheses, top-level paren underflow, unterminated string/identifier literals, or SQL comment markers) are rejected with `400 INVALID_WHERE` so they cannot break out of the enforced per-tenant/per-principal scoping.
