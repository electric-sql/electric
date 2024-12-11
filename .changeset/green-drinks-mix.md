---
"@core/elixir-client": patch
---

Fix stalled elixir client streams by ensuring that requests are always made, even if calling process dies
