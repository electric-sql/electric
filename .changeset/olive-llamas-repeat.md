---
'@core/elixir-client': patch
---

Fix `Electric.Client.EctoAdapter.ArrayDecoder` decoding of escaped backslashes in
quoted PostgreSQL array elements: `\\` now decodes to a single backslash, matching
PostgreSQL semantics and the TypeScript client's parser.
