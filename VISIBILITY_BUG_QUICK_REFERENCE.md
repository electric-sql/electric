# Electric SQL Bug Investigation - Quick Reference

## File Locations

All TypeScript client code is in:
```
/home/user/electric/packages/typescript-client/src/
```

---

## The 5 Critical Issues

### 1. VISIBILITY LISTENER NOT CLEANED UP
File: `client.ts` Lines 1180-1196

The `visibilitychange` event listener is added in the constructor (line 528) but never removed. There's no way to unsubscribe or cleanup.

```
→ Search for: #subscribeToVisibilityChanges
→ Problem: addEventListener but no removeEventListener
→ Impact: Memory leak, stale handlers after stream destruction
```

---

### 2. PAUSE/RESUME RACE CONDITION
File: `client.ts` Lines 1040-1051

The `#pause()` method sets state to intermediate value `pause-requested`, but `#resume()` only handles final `paused` state.

```
→ Search for: #pause() and #resume()
→ Problem: After pause(), if resume() called before state='paused', 
           resume() won't work because state is still 'pause-requested'
→ Impact: Stream gets stuck in intermediate state after rapid visibility changes
```

---

### 3. STATE DEPENDS ON EXCEPTION HANDLING
File: `client.ts` Lines 615-665

State only transitions to `paused` when specific FetchBackoffAbortError is caught with PAUSE_STREAM reason.

```
→ Search for: async #requestShape()
→ Check: Lines 658-665 for state transition logic
→ Problem: If wrong exception type, state won't transition properly
→ Impact: SSE parsing errors can cause mismatched states
```

---

### 4. SSE MESSAGE PROCESSING RACE
File: `client.ts` Lines 943-1038

SSE `onmessage` callbacks process asynchronously while abort signal can fire synchronously.

```
→ Search for: async #requestShapeSSE
→ Check: onmessage callback line 963-978
→ Check: onerror handler line 981-984
→ Problem: Race between async message processing and abort signal
→ Impact: Messages can be partially processed when stream aborts
```

---

### 5. SSE FALLBACK COUNTER NEVER RESETS
File: `client.ts` Lines 486-491, 1000-1036

Counter `#consecutiveShortSseConnections` is only reset on 409 response, not on pause/resume.

```
→ Search for: #consecutiveShortSseConnections
→ Check: Line 1008 - increments on short connection
→ Check: Line 1014 - sets permanent fallback to long polling
→ Check: Line 1202-1213 in #reset() - only place counter resets
→ Problem: Rapid pause/resume creates short connections, triggers fallback
→ Impact: Once fallback enabled, very hard to recover, SSE stays disabled
```

---

## Key Constants

**File**: `constants.ts`
```typescript
export const PAUSE_STREAM = `pause-stream`                    // Line 22
export const FORCE_DISCONNECT_AND_REFRESH = `force-disconnect-and-refresh`  // Line 21
```

---

## Related Error Classes

**File**: `error.ts` Lines 48-53
```typescript
export class FetchBackoffAbortError extends Error {
  constructor() {
    super(`Fetch with backoff aborted`)
    this.name = `FetchBackoffAbortError`
  }
}
```

---

## State Machine

Current states: `active`, `pause-requested`, `paused`

**Problem**: State machine doesn't handle all transitions properly

```
pause() called:
  if (state === 'active') {
    state = 'pause-requested'  // ← Intermediate state
  }

resume() called:
  if (state === 'paused') {    // ← Only handles final state!
    start()
  }
  
// If visibility changes too fast:
// pause() sets state='pause-requested'
// resume() checks state==='paused' → false → returns without doing anything
// Stream stuck!
```

---

## Private Fields Tracking Pause/Resume

```typescript
#state = `active` as `active` | `pause-requested` | `paused`  // Line 464
#started = false                                             // Line 463
#requestAbortController?: AbortController                   // Line 475
```

---

## Testing Pause/Resume

Tests show the expected behavior:
**File**: `test/client.test.ts`

- Lines 26-52: `mockVisibilityApi()` helper
- Lines 437-461: Test for `pause` and `resume` on visibility
- Lines 463-534: Test for pausing stream and resuming it

The tests don't cover rapid toggling which is where the bug manifests.

---

## Firefox-Specific: NS_BINDING_ABORTED

Firefox uses specific abort error code: `NS_BINDING_ABORTED`

This error happens when:
1. Tab becomes hidden (visibility change)
2. Network request is aborted by browser
3. Fetch throws with this error

**Not explicitly caught in code** - falls through to generic error handling

---

## Hooks Into Visibility Tracking

The ShapeStream subscribes to visibility in constructor (line 528):
```typescript
this.#subscribeToVisibilityChanges()
```

Constructor logic:
- Lines 493-502: Constructor setup
- Line 528: Subscribe to visibility (only place it's called)
- NO CLEANUP: No destructor or cleanup method to unsubscribe

---

## SSE Short Connection Logic

Designed to detect:
- Cached responses (close immediately)
- Proxy misconfiguration (close immediately)
- Need ≥1 second connection to be "healthy"

**Problem**: Pause/resume during SSE startup can trigger rapid short connections
```
1. Resume from pause → Start SSE
2. Immediately pause again → Close in <1 sec
3. Count as "short connection"
4. After 3 times → Fall back to long polling permanently
```

---

## Backoff and Retry

**File**: `fetch.ts` Lines 77-164

The client uses exponential backoff with jitter for retries:
- Initial delay: 100ms
- Max delay: 60s
- Max retries: Infinity (will retry forever)
- Honoring server's `Retry-After` header

But this doesn't help if stream is stuck in wrong state.

---

## Snapshot Tracking

**File**: `snapshot-tracker.ts`

There's a SnapshotTracker but it's orthogonal to the pause/resume issue.

---

## Where to Start Fixing

1. **Immediate**: Add cleanup for visibility listener
2. **Critical**: Fix pause/resume state machine race
3. **Important**: Reset SSE fallback counter on pause/resume
4. **Defensive**: Add state validation/assertions
5. **Enhancement**: Add logging for state transitions (help debugging)

