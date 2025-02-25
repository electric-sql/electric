---
"@core/elixir-client": patch
---

Remove requirement for a shape definition from Electric.Client.stream, so we now support endpoints that return a pre-configured stream. Also remove `oneshot` configuration flag as it no longer makes sense
