---
'@core/elixir-client': patch
---

Add fast-loop detection to prevent the client from hammering the server when
responses don't advance the offset. Matches the TypeScript client's behaviour
of detecting, backing off, and eventually erroring on stuck retry loops.
