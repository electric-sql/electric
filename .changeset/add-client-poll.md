---
'@core/elixir-client': minor
---

Add `Client.poll/4` for explicit request-response polling of shape changes. Unlike `stream/3` which returns a continuous `Enumerable`, `poll/4` makes a single request and returns `{:ok, messages, new_state}`, giving callers explicit control over request timing. Also extracts `ShapeState` and `TagTracker` modules from the stream internals for shared use between both APIs.
