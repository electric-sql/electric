# Electric SQL Collections Visibility Bug - Investigation Summary

## Problem Statement
Collections get "stuck" and stop reconnecting in Firefox after rapid tab switching, with NS_BINDING_ABORTED errors during tab visibility changes.

---

## Critical Issues Found

### Issue 1: Unremovable Visibility Event Listener (MEMORY LEAK)

**Location**: `/home/user/electric/packages/typescript-client/src/client.ts:1180-1196`

**Problem**: The visibility change listener is added but never removed.

```typescript
#subscribeToVisibilityChanges() {
  if (typeof document === `object` && ...) {
    const visibilityHandler = () => {
      if (document.hidden) {
        this.#pause()
      } else {
        this.#resume()
      }
    }
    
    // ❌ NO CLEANUP - listener is never removed!
    document.addEventListener(`visibilitychange`, visibilityHandler)
  }
}
```

**Impact**:
- Event listeners accumulate (one per ShapeStream instance)
- Stale handlers remain after ShapeStream destruction
- Multiple handlers responding to same visibility changes
- Can cause state machine confusion

---

### Issue 2: Race Condition in Pause/Resume State Machine (STUCK STREAM)

**Location**: `/home/user/electric/packages/typescript-client/src/client.ts:1040-1051`

**Problem**: State transitions are incomplete, causing stream to get stuck.

```typescript
#pause() {
  if (this.#started && this.#state === `active`) {
    this.#state = `pause-requested`  // ← Sets intermediate state
    this.#requestAbortController?.abort(PAUSE_STREAM)
  }
}

#resume() {
  if (this.#started && this.#state === `paused`) {  // ← Only checks for 'paused'
    this.#start()
  }
}
```

**Problematic Flow**:
1. `Tab hidden` → `#pause()` called → state = `pause-requested`
2. Request is being aborted (async)
3. `Tab visible` (before abort finishes) → `#resume()` called
4. `#resume()` checks: `state === 'paused'`? **NO**
5. `#resume()` returns without action
6. **State stuck in `pause-requested`**, next `#pause()` checks `state === 'active'`? **NO**
7. **Stream completely stuck**

---

### Issue 3: State Transition Dependencies on Exception Handling

**Location**: `/home/user/electric/packages/typescript-client/src/client.ts:615-665`

**Problem**: State only transitions to `paused` if exception is caught correctly.

```typescript
async #requestShape(): Promise<void> {
  if (this.#state === `pause-requested`) {
    this.#state = `paused`
    return
  }

  try {
    await this.#fetchShape({...})
  } catch (e) {
    if (e instanceof FetchBackoffAbortError) {
      if (
        requestAbortController.signal.aborted &&
        requestAbortController.signal.reason === PAUSE_STREAM
      ) {
        this.#state = `paused`  // ← Only set here if exception is correct type
      }
      return
    }
    throw e
  }
  // ...
}
```

**Risk**: 
- If exception is wrong type, state won't transition
- SSE parsing errors might not match expected exception types
- Rapid visibility changes during SSE streaming can cause mismatched states

---

### Issue 4: SSE Streaming Race Condition During Pause

**Location**: `/home/user/electric/packages/typescript-client/src/client.ts:943-1038`

**Problem**: SSE `onmessage` callbacks are async and can race with abort.

```typescript
async #requestShapeSSE(opts: {...}): Promise<void> {
  try {
    let buffer: Array<Message<T>> = []
    await fetchEventSource(fetchUrl.toString(), {
      headers,
      fetch,
      onopen: async (response: Response) => {
        this.#connected = true
        await this.#onInitialResponse(response)
      },
      onmessage: (event: EventSourceMessage) => {
        // ❌ Async processing - can race with visibility change abort
        if (event.data) {
          const message = this.#messageParser.parse<Message<T>>(event.data, schema)
          buffer.push(message)
          if (isUpToDateMessage(message)) {
            this.#onMessages(buffer, true)  // ← Async call
            buffer = []
          }
        }
      },
      signal: requestAbortController.signal,  // ← Abort can fire mid-processing
    })
  } catch (error) {
    if (requestAbortController.signal.aborted) {
      throw new FetchBackoffAbortError()
    }
    throw error
  }
}
```

**Issue**:
- Visibility change → abort signal fires
- But `onmessage` callback might be queued
- Race between message processing and stream abort
- Firefox is more aggressive about aborting than Chrome

---

### Issue 5: SSE Fallback State Not Reset on Pause

**Location**: `/home/user/electric/packages/typescript-client/src/client.ts:486-491, 1000-1036`

**Problem**: SSE short-connection counter accumulates during rapid visibility changes.

```typescript
#lastSseConnectionStartTime?: number
#minSseConnectionDuration = 1000  // Must be open ≥1sec
#consecutiveShortSseConnections = 0
#maxShortSseConnections = 3       // After 3 short connections...
#sseFallbackToLongPolling = false // ...fall back to long polling

// In #requestShapeSSE finally block:
if (connectionDuration < this.#minSseConnectionDuration && !wasAborted) {
  this.#consecutiveShortSseConnections++
  
  if (this.#consecutiveShortSseConnections >= this.#maxShortSseConnections) {
    this.#sseFallbackToLongPolling = true  // ← Permanent fallback!
  }
}
```

**Problem**:
- Rapid pause/resume during SSE connection startup causes short connections
- After 3 short connections, SSE is disabled entirely
- Counter is only reset in `#reset()` (after 409 response)
- Pause/resume doesn't trigger reset
- **Once SSE fallback is set, very difficult to recover**

---

## Firefox-Specific Factors

**Why Firefox is affected more**:

1. **NS_BINDING_ABORTED**: Firefox's specific abort error code
   - Triggered on tab visibility change or user cancellation
   - More aggressive than Chromium's implementation
   - Fires multiple abort events on rapid tab switching

2. **Developer Tools Activation**: 
   - Opening DevTools changes tab visibility
   - Closing DevTools changes it again
   - Rapid toggling triggers multiple aborts in quick succession

3. **ESC Key Handling**:
   - Pressing ESC might affect visibility tracking in some setups
   - Could cause rapid pause/resume cycles

---

## Real-World Scenario

```
User in Firefox:
1. Opens Electric app
2. Opens DevTools (Tab becomes not visible)
   → pause() called, state = 'pause-requested'
   → Request aborts with NS_BINDING_ABORTED
   
3. Clicks on app (Tab becomes visible immediately)
   → resume() called, but state still 'pause-requested'
   → resume() checks state === 'paused'? NO, returns
   → Stream still trying to pause
   
4. Rapid window switching (Alt+Tab or manual)
   → Multiple visibility events fire in quick succession
   → State machine gets out of sync
   → Pause counter increments (triggers SSE fallback)
   
5. App is now "stuck"
   - No new connections being made
   - Stream is in inconsistent state
   - SSE has fallen back to long polling
   - No recovery mechanism
```

---

## Summary of Root Causes

1. **Visibility Listener**: Never cleaned up, accumulates across instances
2. **State Machine**: Incomplete transition coverage for `pause-requested` state
3. **Exception Handling**: State transitions depend on specific exception types
4. **SSE Racing**: Message processing can race with abort signal
5. **SSE Fallback**: Permanent fallback without recovery on pause/resume cycles

---

## Code Locations Summary

| Component | File | Lines | Issue |
|-----------|------|-------|-------|
| Visibility Listener | src/client.ts | 1180-1196 | Not removed |
| Pause/Resume | src/client.ts | 1040-1051 | Race condition |
| State Management | src/client.ts | 615-665 | Exception-dependent |
| SSE Handling | src/client.ts | 943-1038 | Async race |
| SSE Fallback | src/client.ts | 486-491, 1000-1036 | Counter not reset |
| Error Types | src/error.ts | 48-53 | FetchBackoffAbortError |
| Constants | src/constants.ts | 21-22 | PAUSE_STREAM, FORCE_DISCONNECT_AND_REFRESH |
| Tests | test/client.test.ts | 26-52, 437-534 | Mock visibility, pause/resume tests |

