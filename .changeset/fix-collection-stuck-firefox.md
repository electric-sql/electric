---
'@electric-sql/client': patch
---

Fix race condition where collections get stuck and stop reconnecting after rapid tab switching, particularly in Firefox.

**Root cause:** Two race conditions in the pause/resume state machine:

1. `#resume()` only checked for `paused` state, but `#pause()` sets an intermediate `pause-requested` state. When visibility changes rapidly, `#resume()` is called before the abort completes, leaving the stream stuck.

2. Stale abort completions could overwrite the `active` state after `#resume()` has already started a new request.

**State machine flow:**

```
Normal pause:
  active → pause() → pause-requested → abort completes → paused

Interrupted pause (rapid tab switch):
  active → pause() → pause-requested → resume() → active
           ↑                              ↑
           abort starts              resumes immediately,
                                     prevents stuck state
```

**Additional fix:** Memory leak where visibility change event listeners were never removed, causing listener accumulation and potential interference from stale handlers.
