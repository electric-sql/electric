# Bug Report: Collections Get Stuck in Firefox After Rapid Tab Switching

## Issue Summary

Electric SQL collections stop reconnecting in Firefox after rapid tab switching, causing new data to not appear until a page refresh. The issue manifests as:

- Network connections ending with `NS_BINDING_ABORTED` when tab visibility changes
- After multiple rapid visibility changes, collections stop reconnecting entirely
- Particularly reproducible in Firefox when switching tabs quickly (~5 seconds of rapid switching)
- Issue appears to be Firefox-specific or more pronounced in Firefox

## Root Cause Analysis

### 🔴 PRIMARY BUG: Pause/Resume Race Condition

**Location:** `packages/typescript-client/src/client.ts:1040-1051`

```typescript
#pause() {
  if (this.#started && this.#state === `active`) {
    this.#state = `pause-requested`
    this.#requestAbortController?.abort(PAUSE_STREAM)
  }
}

#resume() {
  if (this.#started && this.#state === `paused`) {
    this.#start()
  }
}
```

**The Problem:**

The state machine has an intermediate state `pause-requested` that `#resume()` doesn't handle:

1. **Tab hidden** → `#pause()` called
2. State changes: `active` → `pause-requested` (line 1042)
3. Request is aborted with `PAUSE_STREAM` reason
4. **Tab visible** (before abort completes) → `#resume()` called
5. `#resume()` checks `if (this.#state === 'paused')` (line 1048)
6. Condition is **false** because state is still `pause-requested`
7. **Stream gets stuck** - no reconnection happens

**State Transition Flow:**

```
Normal flow:
  active → [pause()] → pause-requested → [abort completes] → paused → [resume()] → active

Bug scenario (rapid tab switch):
  active → [pause()] → pause-requested → [resume() called here!] → STUCK
                                         ↑
                                         resume() sees state != paused
                                         so it does nothing
```

**Why Firefox is More Affected:**

- Firefox aborts requests more aggressively with `NS_BINDING_ABORTED`
- Chrome/Safari may handle visibility changes with different timing
- Firefox DevTools opening/closing can trigger rapid visibility changes

---

### 🔴 SECONDARY BUG: Memory Leak - Visibility Listener Never Removed

**Location:** `packages/typescript-client/src/client.ts:1180-1196`

```typescript
#subscribeToVisibilityChanges() {
  if (
    typeof document === `object` &&
    typeof document.hidden === `boolean` &&
    typeof document.addEventListener === `function`
  ) {
    const visibilityHandler = () => {
      if (document.hidden) {
        this.#pause()
      } else {
        this.#resume()
      }
    }

    document.addEventListener(`visibilitychange`, visibilityHandler)
    // ❌ NO CLEANUP! Listener is never removed
  }
}
```

**The Problem:**

1. Visibility event listener is added but **never removed**
2. Each `ShapeStream` instance adds its own listener
3. Listeners remain active even after the stream is destroyed
4. This creates a memory leak and can cause multiple stale handlers to fire
5. Stale handlers can interfere with active streams

**Impact:**

- Memory leak grows with each new ShapeStream instance
- Stale handlers calling `#pause()` and `#resume()` on destroyed streams
- Potential for race conditions when multiple handlers fire simultaneously

---

### 🟡 CONTRIBUTING FACTOR: SSE Fallback Logic

**Location:** `packages/typescript-client/src/client.ts:1000-1037`

The SSE fallback mechanism is designed to detect proxy misconfigurations (where proxies buffer SSE responses). However, it can be triggered unintentionally during rapid tab switching:

```typescript
finally {
  const connectionDuration = Date.now() - this.#lastSseConnectionStartTime!
  const wasAborted = requestAbortController.signal.aborted

  if (connectionDuration < this.#minSseConnectionDuration && !wasAborted) {
    this.#consecutiveShortSseConnections++

    if (this.#consecutiveShortSseConnections >= this.#maxShortSseConnections) {
      // Permanent fallback to long polling
      this.#sseFallbackToLongPolling = true
      console.warn(/* ... */)
    }
  } else if (connectionDuration >= this.#minSseConnectionDuration) {
    this.#consecutiveShortSseConnections = 0
  }
}
```

**Potential Issue:**

While the code checks `!wasAborted` to avoid counting intentional aborts, there may be edge cases where:
- Connection closes naturally before abort signal is processed
- Timing issues cause `wasAborted` to be false even though pause was requested
- If this happens 3 times, SSE is permanently disabled until stream reset

**Reset Behavior:**

The SSE fallback state is only reset in `#reset()` (called on 409 errors or explicit resets), not during normal pause/resume cycles.

---

## Why This Affects Firefox More

1. **More aggressive request abortion:** Firefox uses `NS_BINDING_ABORTED` and cancels requests more aggressively than other browsers
2. **DevTools interaction:** Opening/closing Firefox DevTools triggers visibility changes
3. **Timing differences:** Firefox's event loop and request handling timing makes the race condition more likely
4. **Visibility API implementation:** Subtle differences in how Firefox implements the Page Visibility API

---

## Reproduction Steps

1. Open an Electric SQL app in Firefox
2. Rapidly switch between tabs (every ~1 second) for about 5-10 seconds
3. Observe network tab showing connections ending with `NS_BINDING_ABORTED`
4. After several switches, connections stop being initiated
5. Make a change that should trigger collection updates (e.g., send a message)
6. Data doesn't appear until page refresh

---

## Expected vs Actual Behavior

**Expected:**
- Collections should handle visibility changes gracefully
- When tab becomes visible again, collection should resume streaming
- Data should sync automatically without requiring refresh

**Actual:**
- After rapid tab switching, collections stop reconnecting
- No new network requests are made
- Data updates don't appear until manual page refresh
- Stream is stuck in `pause-requested` or inconsistent state

---

## Recommended Fixes

### Fix 1: Handle `pause-requested` State in `#resume()`

```typescript
#resume() {
  if (this.#started && (this.#state === `paused` || this.#state === `pause-requested`)) {
    // Cancel any pending pause if still in pause-requested
    if (this.#state === `pause-requested`) {
      this.#state = `active`
    }
    this.#start()
  }
}
```

### Fix 2: Clean Up Visibility Listener

```typescript
#unsubscribeFromVisibilityChanges?: () => void

#subscribeToVisibilityChanges() {
  if (
    typeof document === `object` &&
    typeof document.hidden === `boolean` &&
    typeof document.addEventListener === `function`
  ) {
    const visibilityHandler = () => {
      if (document.hidden) {
        this.#pause()
      } else {
        this.#resume()
      }
    }

    document.addEventListener(`visibilitychange`, visibilityHandler)

    // Store cleanup function
    this.#unsubscribeFromVisibilityChanges = () => {
      document.removeEventListener(`visibilitychange`, visibilityHandler)
    }
  }
}

// Call this in unsubscribeAll or destructor
#cleanup() {
  this.#unsubscribeFromVisibilityChanges?.()
}
```

### Fix 3: Consider Debouncing Visibility Changes

Add a small debounce to prevent rapid pause/resume cycles:

```typescript
#visibilityChangeDebounceTimer?: number
#visibilityChangeDebounceMs = 100 // 100ms debounce

#subscribeToVisibilityChanges() {
  // ... existing checks ...

  const visibilityHandler = () => {
    clearTimeout(this.#visibilityChangeDebounceTimer)

    this.#visibilityChangeDebounceTimer = setTimeout(() => {
      if (document.hidden) {
        this.#pause()
      } else {
        this.#resume()
      }
    }, this.#visibilityChangeDebounceMs)
  }

  // ... rest of implementation ...
}
```

---

## Additional Notes

- This bug doesn't just affect Firefox - it's just more easily reproduced there
- Other browsers may experience the same issue with different triggering patterns
- The bug can affect any Electric SQL application using collections
- Users may perceive this as "data not syncing" or "real-time updates stopped working"

---

## Files Involved

- `packages/typescript-client/src/client.ts` - Main ShapeStream implementation
- `packages/typescript-client/src/constants.ts` - PAUSE_STREAM constant
- `packages/typescript-client/src/error.ts` - FetchBackoffAbortError class

## Related Code Locations

- State machine: `client.ts:1040-1051` (pause/resume methods)
- Visibility listener: `client.ts:1180-1196` (subscription)
- State transitions: `client.ts:615-665` (requestShape method)
- SSE fallback: `client.ts:1000-1037` (connection duration check)
