# Electric SQL Collection Visibility Bug Analysis

## Issue Summary
Collections get "stuck" and stop reconnecting in Firefox after rapid tab switching. The symptom is NS_BINDING_ABORTED errors when the tab gains visibility, but after multiple occurrences, reconnection stops happening.

---

## Key Code Components Found

### 1. Visibility Change Handling
**File**: `/home/user/electric/packages/typescript-client/src/client.ts`
**Lines**: 1180-1196

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
  }
}
```

**Issues**:
- ❌ **Event listener is never removed** - No cleanup mechanism
- ❌ **No unsubscribe capability** - Handler can't be cleaned up when ShapeStream is destroyed
- ❌ **Memory leak potential** - Handler persists even after stream is destroyed
- ❌ **Multiple listener accumulation** - Each ShapeStream instance adds another listener

### 2. Pause/Resume Logic
**File**: `/home/user/electric/packages/typescript-client/src/client.ts`
**Lines**: 1040-1051

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

**Critical Issue**: Race condition in state transitions
- When `#pause()` is called, state becomes `pause-requested`
- If visibility changes again before state reaches `paused`, `#resume()` won't work
- `#resume()` only works when state is exactly `paused`, not `pause-requested`

### 3. State Management in RequestShape
**File**: `/home/user/electric/packages/typescript-client/src/client.ts`
**Lines**: 615-665

```typescript
async #requestShape(): Promise<void> {
  if (this.#state === `pause-requested`) {
    this.#state = `paused`
    return
  }

  // ... request setup ...

  try {
    await this.#fetchShape({...})
  } catch (e) {
    // Handle abort error triggered by refresh
    if (
      (e instanceof FetchError || e instanceof FetchBackoffAbortError) &&
      requestAbortController.signal.aborted &&
      requestAbortController.signal.reason === FORCE_DISCONNECT_AND_REFRESH
    ) {
      return this.#requestShape()
    }

    if (e instanceof FetchBackoffAbortError) {
      if (
        requestAbortController.signal.aborted &&
        requestAbortController.signal.reason === PAUSE_STREAM
      ) {
        this.#state = `paused`
      }
      return // interrupted
    }
    // ...
  }

  this.#tickPromiseResolver?.()
  return this.#requestShape()
}
```

**Problems**:
- State transitions depend on exception handling
- Race condition: Visibility changes during SSE parsing

### 4. SSE Request Handling
**File**: `/home/user/electric/packages/typescript-client/src/client.ts`
**Lines**: 943-1038

```typescript
async #requestShapeSSE(opts: {
  fetchUrl: URL
  requestAbortController: AbortController
  headers: Record<string, string>
}): Promise<void> {
  const { fetchUrl, requestAbortController, headers } = opts
  
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
        // Process messages
      },
      onerror: (error: Error) => {
        throw error
      },
      signal: requestAbortController.signal,
    })
  } catch (error) {
    if (requestAbortController.signal.aborted) {
      throw new FetchBackoffAbortError()
    }
    throw error
  }
}
```

**Issue**: SSE stream parsing race condition
- If visibility changes while SSE is streaming, abort signal fires
- But SSE parsing happens asynchronously in `onmessage` callbacks
- Rapid visibility changes can leave SSE in inconsistent state

---

## Root Cause Analysis

### 1. **Visibility Listener Accumulation** ❌
The visibility handler is added in constructor (line 528) but never removed:
- No cleanup on unsubscribe
- No cleanup on ShapeStream destruction
- Each instance adds a listener to the global `document` object

**Result**: After rapid tab switching, multiple stale handlers remain active, causing state confusion.

### 2. **Race Condition in Pause/Resume** ❌
State machine has incomplete coverage:
- `#pause()` sets state to `pause-requested`
- Rapid visibility change before state becomes `paused`
- Next `#resume()` call fails because state != `paused`
- Stream gets stuck in intermediate state

**Example scenario**:
```
1. Tab hidden → pause() sets state='pause-requested'
2. Tab visible (before paused state reached) → resume() called
3. resume() checks: state === 'paused'? NO → returns without action
4. State remains 'pause-requested' while trying to be 'active'
5. Stream stuck
```

### 3. **SSE Abort Handling During Streaming** ❌
When visibility changes during SSE streaming:
- `fetchEventSource` gets abort signal
- Throws error caught at line 988
- But `onmessage` callbacks might still be pending
- State transitions in error handling might not match actual state

### 4. **Firefox-Specific Behavior** 🦊
NS_BINDING_ABORTED is Firefox's native abort error:
- Firefox aggressively aborts network requests on tab visibility change
- More aggressive than Chrome/Safari
- Combined with rapid tab switching (e.g., developer tools), can trigger multiple aborts
- State machine doesn't handle high-frequency abort scenarios

---

## State Diagram Issues

```
Expected states:
  active ←→ paused
             ↑
          pause-requested

Current problematic flow with rapid visibility changes:
  
  1. active → pause-requested (visibility hidden)
  2. pause-requested → visible (too fast)
  3. resume() called but state != 'paused'
  4. pause() condition: state === 'active'? NO
  5. resume() condition: state === 'paused'? NO
  6. State stuck in 'pause-requested'
```

---

## Additional Findings

### SSE Fallback State
**Lines**: 486-491
```typescript
#lastSseConnectionStartTime?: number
#minSseConnectionDuration = 1000
#consecutiveShortSseConnections = 0
#maxShortSseConnections = 3
#sseFallbackToLongPolling = false
#sseBackoffBaseDelay = 100
#sseBackoffMaxDelay = 5000
```

- Tracks short SSE connections but doesn't reset on pause
- After 3 short connections → fallback to long polling
- Rapid visibility changes could trigger short connections
- Once in fallback, very difficult to recover

---

## Files Affected

1. **Main Client**: `/home/user/electric/packages/typescript-client/src/client.ts`
   - Visibility handler (lines 1180-1196)
   - Pause/resume logic (lines 1040-1051)
   - State management (lines 615-708)
   - SSE handling (lines 943-1038)

2. **Error Handling**: `/home/user/electric/packages/typescript-client/src/error.ts`
   - FetchBackoffAbortError (lines 48-53)

3. **Constants**: `/home/user/electric/packages/typescript-client/src/constants.ts`
   - PAUSE_STREAM constant (line 22)
   - FORCE_DISCONNECT_AND_REFRESH constant (line 21)

4. **Tests**: `/home/user/electric/packages/typescript-client/test/client.test.ts`
   - Mock visibility API (lines 26-52)
   - Pause/resume tests (lines 437-534)

---

## Recommended Fixes

### 1. Add Cleanup for Visibility Listener ✅
Store the handler reference and provide cleanup mechanism

### 2. Fix State Machine Race Conditions ✅
Handle `pause-requested` state in `#resume()` method

### 3. Prevent SSE Accumulation ✅
Reset SSE fallback counter on manual pause/resume

### 4. Add Visibility State Tracking ✅
Track actual document visibility separately from stream state

### 5. Add Guard Against Multiple Rapid Toggles ✅
Debounce or queue visibility changes

---

## Firefox-Specific Considerations

NS_BINDING_ABORTED in Firefox:
- Occurs when fetch is aborted by browser (tab switching, user cancellation)
- More aggressive than Chromium browsers
- Needs explicit handling in abort catch blocks
- Consider: Could visibility handler be getting called multiple times?
- Consider: Could async pause/resume logic be racing?

