# Replay Mode Infinite Loop Bug

## Summary

A bug in the TypeScript Electric client's "replay mode" logic can cause an infinite loop that consumes 100% CPU and freezes the browser UI. The loop occurs when cached HTTP responses return the same cursor value that's stored in localStorage, causing the client to repeatedly suppress up-to-date notifications without ever exiting replay mode.

**Symptoms:**

- 100% CPU usage
- Frozen browser UI (including DevTools)
- HTTP requests happening rapidly (though may appear as "no requests" due to frozen UI)
- Issue persists **indefinitely** until page is force-closed (cache TTLs do not break the loop)
- Multiple machines syncing the same shape can get stuck simultaneously

**Workarounds that fix it:**

- Clearing browser localStorage
- Clearing Electric server cache (resetting shapes)

**Affected setups:**

- Electric Cloud (standard configuration) - **most likely to trigger**
- Any setup with CDN/proxy caching between client and Electric
- Less likely with direct connection to Electric (server collision detection helps)

---

## How to Reproduce

### Basic Reproduction Steps

```
STEP 1: Open app
        ↓
        Shape syncs successfully ✓
        cursor=X saved to localStorage with timestamp=NOW

STEP 2: Refresh page (within 60 seconds)
        ↓
        App enters replay mode (reads cursor=X from localStorage)
        Cached response has cursor=X
        X === X → STUCK FOREVER ✗
```

**First load always works. It's the refresh that kills it.**

### The 60-Second Window Resets

The 60-second window is NOT from the "original" sync—it resets on every successful sync:

```typescript
// In recordUpToDate():
this.data[shapeKey] = {
  timestamp: Date.now(), // <-- RESETS on each successful sync
  cursor,
}
```

This means the bug can trigger on ANY refresh, not just the first one:

| Scenario                                                      | Result           |
| ------------------------------------------------------------- | ---------------- |
| Open app, refresh immediately                                 | **STUCK**        |
| Open app, wait 2 minutes, refresh                             | OK (timer reset) |
| Open app, refresh in 30 seconds                               | **STUCK**        |
| Open app, wait 61 seconds, refresh                            | OK               |
| Keep app open for hours, then refresh within 60s of last sync | **STUCK**        |

### Practical Impact

In typical usage patterns (open app → use briefly → refresh), **the bug will almost always trigger** because most refreshes happen within 60 seconds of the page loading.

### Write Throttling Wrinkle

There's a 60-second write throttle to localStorage to avoid performance issues:

```typescript
private readonly writeThrottleMs = 60_000 // Throttle localStorage writes to once per 60s
```

This means:

- In-memory timestamp is always current
- localStorage might be up to 60 seconds stale
- On refresh, localStorage is what's read

If you keep the app open for several minutes without refreshing, the localStorage timestamp might become old enough that a subsequent refresh won't trigger the bug. But this is an edge case—most usage patterns will trigger it.

### New Machine Behavior

A machine that has **never** opened the app before will NOT get stuck on first load:

| Machine         | localStorage | Enters Replay Mode? | First Load Result            |
| --------------- | ------------ | ------------------- | ---------------------------- |
| Previously used | Has cursor=X | **Yes**             | **May get stuck** (if < 60s) |
| Never used      | Empty        | No                  | Works fine                   |

However, if a new machine successfully syncs and then refreshes within 60 seconds, it WILL get stuck just like any other machine.

---

## Why the Bug Is "Occasional" But Consistent Per Shape

Users report this bug occasionally, not constantly. But when it does happen with a particular shape, it affects all machines syncing that shape. Here's why:

### The Key Condition: Cursor Must Match

The bug requires the **cached response cursor** to match the **localStorage cursor**. This depends on several factors:

### Factor 1: Shape Activity (Most Important)

| Shape State                  | What Happens                                     | Result                        |
| ---------------------------- | ------------------------------------------------ | ----------------------------- |
| **Static (no writes)**       | CDN revalidates → 304 Not Modified → same cursor | **Bug persists indefinitely** |
| **Active (frequent writes)** | New data arrives with new cursor                 | Bug self-heals                |

**Static shapes are the primary trigger.** When a shape has no new writes:

- Electric returns 304 Not Modified on revalidation
- CDN extends cache TTL with the same stale response
- The same cursor keeps being served
- All users stay stuck

**Active shapes self-heal.** When new data is written:

- Electric returns a full response with new data
- Response includes a new cursor
- Loop breaks naturally

### Factor 2: Cache State

| Cache State                         | Result                                 |
| ----------------------------------- | -------------------------------------- |
| **Warm** (recently hit)             | Cached cursor served → bug may trigger |
| **Cold** (expired, never populated) | Fresh response from server → no bug    |

The bug only triggers when the cache is warm with a response containing the matching cursor.

### Factor 3: CDN Edge Location

Different geographic locations have independent cache states:

```
User A (NYC)    ──► Cloudflare NYC Edge ──► Electric
                        cache: cursor=100

User B (London) ──► Cloudflare LHR Edge ──► Electric
                        cache: cursor=200 (different!)
```

- Users at the **same edge** get the same cached cursor → all get stuck together
- Users at **different edges** might have different experiences

### Factor 4: Timing Within Cursor Window

Cursors change every 20 seconds. If:

- Cache was populated with cursor=100
- User syncs later, gets cursor=100, stores it
- Cache gets revalidated and updated to cursor=120
- User refreshes → 120 !== 100 → no bug

But with static shapes, the 304 trap prevents this escape.

### Why "Occasional But Consistent"

| Observation                         | Explanation                                                          |
| ----------------------------------- | -------------------------------------------------------------------- |
| **Occasional**                      | Only static shapes trigger persistent loops; active shapes self-heal |
| **Consistent per shape**            | Same CDN cache → same cursor → all users store same cursor           |
| **Affects all machines**            | Users at same edge location share cache state                        |
| **Clearing server cache fixes all** | Invalidates CDN, forces fresh cursors everywhere                     |

### Typical Trigger Scenario

```
1. Shape goes quiet (no writes for a while)
   ↓
2. User A syncs → CDN caches response with cursor=X
   ↓
3. User A stores cursor=X in localStorage
   ↓
4. User A refreshes within 60s → STUCK
   (304s keep extending cache, loop persists)
   ↓
5. User B syncs from same CDN edge → gets same cursor=X
   ↓
6. User B stores cursor=X
   ↓
7. User B refreshes → ALSO STUCK
   ↓
8. All users at this edge stuck with this shape
   ↓
9. Fix: Clear server cache OR wait for new writes to the shape
```

### Shapes Most Likely to Trigger the Bug

- **Reference data** that rarely changes (countries, categories, settings)
- **Historical data** that's append-only and queries don't include recent records
- **Demo/test shapes** with static seed data
- **Low-traffic shapes** where writes are infrequent

### Shapes Least Likely to Trigger the Bug

- **Active transactional data** with frequent writes
- **Real-time data** that updates constantly
- **User-specific shapes** where each user's data changes independently

---

## What is Replay Mode?

Replay mode is a feature designed to prevent duplicate UI renders when the browser serves cached HTTP responses on page refresh.

### The Problem It Solves

When a user syncs a shape and then refreshes the page within a short time window:

1. The browser may serve cached HTTP responses (from browser cache or CDN)
2. These cached responses contain up-to-date messages
3. Without replay mode, the UI would render once from cache, then again when fresh data arrives
4. This causes unnecessary re-renders and potential UI flicker

### How Replay Mode Works

1. When a shape receives an up-to-date message, the client records the timestamp and cursor in localStorage
2. On page refresh, if a recent entry exists (< 60 seconds old), the client enters "replay mode"
3. In replay mode, up-to-date messages with matching cursors are suppressed
4. When a NEW cursor is seen (indicating fresh data from server), replay mode exits and notifications resume

### The Bug

**The client never exits replay mode if cached responses continue to return the same cursor value.**

When the cursor in cached responses matches the cursor stored in localStorage, the suppression logic returns early without clearing the replay mode state, causing an infinite loop.

---

## Root Cause Analysis

### The Buggy Code

In `packages/typescript-client/src/client.ts`, lines 1092-1103:

```typescript
// Check if we should suppress this up-to-date notification
// to prevent multiple renders from cached responses
if (this.#replayMode && !isSseMessage) {
  // We're in replay mode (replaying cached responses during initial sync).
  // Check if the cursor has changed - cursors are time-based and always
  // increment, so a new cursor means fresh data from the server.
  const currentCursor = this.#liveCacheBuster

  if (currentCursor === this.#lastSeenCursor) {
    // Same cursor = still replaying cached responses
    // Suppress this up-to-date notification
    return // <-- BUG: Returns without clearing #lastSeenCursor
  }
}

// We're either:
// 1. Not in replay mode (normal operation), or
// 2. This is a live/SSE message (always fresh), or
// 3. Cursor has changed (exited replay mode with fresh data)
// In all cases, notify subscribers and record the up-to-date.
this.#lastSeenCursor = undefined // Exit replay mode  <-- Never reached when suppressing!
```

### The Problem

When `currentCursor === this.#lastSeenCursor`:

1. The code returns early (line 1101)
2. `#lastSeenCursor` is never set to `undefined` (line 1110 is never reached)
3. `#replayMode` remains `true` (it's a getter that checks if `#lastSeenCursor !== undefined`)
4. Next iteration: same check, same result, infinite loop

### Critical Detail: #isUpToDate is Set Before Suppression

```typescript
this.#lastSyncedAt = Date.now()
this.#isUpToDate = true // <-- Set BEFORE the suppression check
// ...
if (this.#replayMode && !isSseMessage) {
  if (currentCursor === this.#lastSeenCursor) {
    return // Suppress, but #isUpToDate is already true!
  }
}
```

Because `#isUpToDate = true` is set before the suppression check, subsequent requests are **live requests** (with `live=true` parameter). This matters because:

- Live requests have short cache times (5-10 seconds)
- But during that cache window, the loop runs at full speed

---

## The Infinite Loop Flow

### Prerequisites

1. User syncs a shape at time T
2. Client records `cursor=X` in localStorage via `upToDateTracker.recordUpToDate()`
3. User refreshes page within 60 seconds

### Step-by-Step Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 1: Page Refresh                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ • upToDateTracker.shouldEnterReplayMode() returns "X" (from localStorage)   │
│ • Client sets #lastSeenCursor = "X"                                          │
│ • Client is now in replay mode                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 2: Initial Sync Request (offset=-1)                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ • Browser/CDN serves CACHED response (max-age=604800 for initial sync)      │
│ • Cached response has cursor=X baked in                                      │
│ • Response header: electric-cursor: X                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 3: Process Response                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ • #liveCacheBuster = "X" (from response header)                              │
│ • See up-to-date message                                                     │
│ • #isUpToDate = true                                                         │
│ • Check: currentCursor === lastSeenCursor → "X" === "X" → TRUE              │
│ • SUPPRESS up-to-date, return early                                          │
│ • #lastSeenCursor remains "X" (NOT cleared!)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 4: Next Request (Live Request)                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ • #isUpToDate = true, so this is a live request (live=true)                 │
│ • Request URL includes: live=true&cursor=X                                   │
│ • IF cached (max-age=5): returns cursor=X → LOOP CONTINUES                  │
│ • IF fresh from server: returns cursor=Y → EXIT REPLAY MODE                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
              Cached (cursor=X)              Fresh (cursor=Y)
                    │                               │
                    ▼                               ▼
            ┌───────────────┐               ┌───────────────┐
            │ INFINITE LOOP │               │ Normal        │
            │ (back to      │               │ Operation     │
            │  Step 3)      │               │ Resumes       │
            └───────────────┘               └───────────────┘
```

### Why the Loop Runs at 100% CPU

1. **Successful responses have no backoff**: The fetch wrapper only applies backoff to failed requests (4xx/5xx). Successful 200 responses return immediately.

2. **Cached responses are instant**: Browser cache returns in microseconds, no network wait.

3. **No delay between iterations**: The recursive call `return this.#requestShape()` happens immediately after processing.

4. **Microtask saturation**: The async loop creates microtasks faster than the event loop can process other tasks, freezing the UI.

---

## Server-Side Caching Behavior

### Cache Headers by Request Type

| Request Type              | Cache-Control Header                                            | Duration                       |
| ------------------------- | --------------------------------------------------------------- | ------------------------------ |
| Initial sync (offset=-1)  | `max-age=604800, s-maxage=3600, stale-while-revalidate=2629746` | 1 week (browser), 1 hour (CDN) |
| Live requests (live=true) | `max-age=5, stale-while-revalidate=5`                           | 5-10 seconds                   |
| Non-live requests         | `max-age=60, stale-while-revalidate=300`                        | 60-360 seconds                 |

### Cursor Calculation

The cursor (electric-cursor header) is calculated as:

```elixir
# In packages/sync-service/lib/electric/plug/utils.ex
def get_next_interval_timestamp(long_poll_timeout_ms, prev_interval) do
  long_poll_timeout_sec = div(long_poll_timeout_ms, 1000)  # Default: 20
  diff_in_seconds = DateTime.diff(DateTime.utc_now(), @oct9th2024, :second)
  next_interval = ceil(diff_in_seconds / long_poll_timeout_sec) * long_poll_timeout_sec

  if "#{next_interval}" == prev_interval do
    next_interval + Enum.random(1..3_600)  # Collision avoidance
  else
    next_interval
  end
end
```

**Key points:**

- Cursor is based on current time, rounded to 20-second intervals
- Requests within the same 20-second window get the same cursor
- Collision detection only works if the request reaches the server (not from cache)

### Why Cached Responses Have Stale Cursors

When a response is cached (browser or CDN), the cursor value is "baked in" at cache time. Subsequent requests served from cache return this stale cursor, not a freshly calculated one.

---

## Electric Cloud: Why Standard Setup Triggers This Bug

Electric Cloud uses Cloudflare Workers as an edge layer for all shape requests. The Shape API Worker (`packages/workers/src/shape-api/worker.ts` in Stratovolt) enables Cloudflare edge caching:

```typescript
// Stratovolt: packages/workers/src/shape-api/worker.ts line 313-316
const response = await fetch(originUrl.toString(), {
  headers: headersClone,
  cf: { cacheEverything: true }, // Enables Cloudflare edge cache
})
```

### The Caching Architecture

```
Client → Cloudflare Edge Cache → Electric Server
              ↑
              cacheEverything: true
              (always enabled)
```

### Cache Key Includes Cursor

The `cursor` query parameter is forwarded to the origin (line 279-283):

```typescript
url.searchParams.forEach((value, key) => {
  if (![`secret`, `source_secret`, `token`].includes(key)) {
    originUrl.searchParams.set(key, value) // cursor IS included
  }
})
```

This means:

- Request with `cursor=X` → cached with key including `cursor=X`
- Next request with `cursor=X` → cache HIT → same response with `cursor=X`

### Why This Creates an INDEFINITE Infinite Loop

The loop is self-reinforcing because the cache key includes the cursor parameter, and the client keeps sending the same cursor:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   THE SELF-REINFORCING CACHE LOOP                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Client State                           Cache State                         │
│   ────────────                           ───────────                         │
│   #liveCacheBuster = "X"                 Key: ...cursor=X...                │
│   #lastSeenCursor = "X"                  Value: response with cursor=X      │
│                                                                              │
│   1. Client sends: GET /shape?cursor=X                                       │
│      ↓                                                                       │
│   2. Cloudflare: cache key = "...cursor=X..."                               │
│      ↓                                                                       │
│   3. Cache HIT → response with header: electric-cursor: X                   │
│      ↓                                                                       │
│   4. Client: #liveCacheBuster = "X" (from response)                         │
│      ↓                                                                       │
│   5. Client: X === X → SUPPRESS (but don't clear #lastSeenCursor!)          │
│      ↓                                                                       │
│   6. #liveCacheBuster stays "X" → next request sends cursor=X               │
│      ↓                                                                       │
│   7. SAME CACHE KEY → SAME CACHED RESPONSE → GOTO 1 (FOREVER)              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Critical insight:** Even if the cache entry expires and Cloudflare revalidates with the origin:

- Electric returns 304 Not Modified (same ETag for unchanged data)
- Cloudflare extends the cache TTL
- The cached response (with stale cursor=X) continues to be served
- The cache entry never truly expires while being actively hit

### Why Cache TTLs Don't Break the Loop

You might expect the 5-10 second cache TTL to break the loop, but it doesn't:

| Mechanism                  | Why It Fails to Break the Loop                               |
| -------------------------- | ------------------------------------------------------------ |
| **Cache expiry**           | Loop hits cache continuously, keeping it warm                |
| **stale-while-revalidate** | Serves stale content while revalidating in background        |
| **304 Not Modified**       | Electric returns 304 for unchanged shapes, extending cache   |
| **ETag matching**          | Same ETag (for unchanged data) = same cached response served |

### The 304 Revalidation Trap

When the cache entry goes stale:

1. Cloudflare sends `If-None-Match: <etag>` to Electric origin
2. Electric returns `304 Not Modified` (data hasn't changed)
3. Cloudflare **extends the TTL** of the existing cached response
4. The cached response still contains `electric-cursor: X`
5. **Even if Electric sends a new cursor header with the 304, the cache KEY remains cursor=X**
6. Client keeps requesting `cursor=X` → same cache key → same loop

**The cache key is the trap:** Because the client keeps sending `cursor=X` in the request, it keeps hitting the same cache entry, regardless of whether that entry's headers are updated.

---

## Why the Stall Is Indefinite (Not Just 5-10 Seconds)

### The Cache Key Trap

The most critical insight is that the **cache key includes the cursor parameter**. This creates a self-reinforcing loop:

1. **Client sends `cursor=X`** in the request URL
2. **Cache key** = `GET /shape?...cursor=X...`
3. **Cache HIT** → response with `electric-cursor: X` header
4. **Client reads cursor from response** → `#liveCacheBuster = X`
5. **Client suppresses** (X === X) but keeps `#liveCacheBuster = X`
6. **Next request**: client sends `cursor=X` (same as step 1)
7. **Same cache key** → same cache entry → same response → **forever**

### Why 304 Revalidation Doesn't Help

Even when the cache entry expires and Cloudflare revalidates:

| Step | What Happens                                 | Result                 |
| ---- | -------------------------------------------- | ---------------------- |
| 1    | Cache entry expires (stale)                  | Revalidation triggered |
| 2    | Cloudflare sends `If-None-Match` to Electric | Conditional request    |
| 3    | Electric computes current cursor (maybe `Y`) | New cursor calculated  |
| 4    | Electric returns 304 + new cursor header?    | Data unchanged         |
| 5    | Cloudflare extends cache TTL                 | Cache stays warm       |
| 6    | Client still sends `cursor=X`                | Same cache key!        |
| 7    | Cloudflare serves cached response            | Same cursor=X          |

**Key point:** Even if Cloudflare updates the cached response headers on 304 (which is RFC-compliant but not guaranteed), the client is still requesting with `cursor=X`, which means it hits the same cache entry.

### The Only Ways to Break the Loop

| Method                     | Why It Works                                        |
| -------------------------- | --------------------------------------------------- |
| **Clear localStorage**     | Client doesn't enter replay mode, exits loop        |
| **Clear server/CDN cache** | Forces cache MISS, fresh response with new cursor   |
| **Shape data changes**     | Different ETag, full response (not 304), new cursor |
| **Deploy fix**             | Client exits replay mode after first suppression    |

### Clarification: Does Cloudflare Update Headers on 304?

Per RFC 7234, caches SHOULD update stored response headers when receiving a 304. However:

1. **It doesn't matter for this bug** - the cache KEY is based on the REQUEST (`cursor=X`), not the response
2. **Cloudflare behavior varies** - some users have reported custom headers not updating
3. **The loop is self-sustaining** - client keeps sending same cursor regardless

The fundamental issue is that the client keeps requesting the same cache key, so even a perfectly RFC-compliant cache would serve the same (or header-updated) entry with the same cursor value baked into the original response body's context.

---

### Server Collision Detection Is Bypassed

The Electric server has collision detection:

```elixir
# When calculated cursor matches request cursor, add random offset
if "#{next_interval}" == prev_interval do
  next_interval + Enum.random(1..3_600)
end
```

But with Cloudflare caching:

- Request never reaches Electric server
- Collision detection never runs
- Stale cursor is served from cache

### This Is Standard Electric Cloud Behavior

- `cf: { cacheEverything: true }` is **always enabled**
- There's no configuration to disable it
- This is intentional for performance
- **Any Electric Cloud user can trigger this bug**

### Why Multiple Machines Get Stuck Together

Multiple clients hitting the same Cloudflare edge location:

1. Share the same edge cache
2. Get identical cached responses
3. Record the same cursor in their respective localStorage
4. All enter replay mode with the same `lastSeenCursor`
5. All get stuck in the same loop

---

## When the Bug Does NOT Occur

### Direct Connection to Electric (No CDN)

With a direct connection (no Cloudflare/CDN):

1. Initial sync cached by **browser** (1 week) with `cursor=X`
2. Page refresh → browser serves cached initial sync
3. Client suppresses first up-to-date (cursor matches)
4. Live request goes to **server** (different URL, not in browser cache)
5. Server sees `cursor=X` in request, calculates same interval
6. **Server collision detection adds random offset**
7. Returns `cursor=X+random` (different!)
8. Client exits replay mode ✓

The server's collision detection breaks the loop because:

- Live requests have different URLs than initial sync (not cached)
- Server receives the cursor parameter and detects collision
- Server returns a different cursor value

### When Collision Detection Works

| Setup                        | Bug Likely? | Why                              |
| ---------------------------- | ----------- | -------------------------------- |
| Direct to Electric           | **No**      | Server collision detection works |
| Electric Cloud               | **Yes**     | Cloudflare cache bypasses server |
| Custom CDN/Proxy             | **Yes**     | Cache bypasses server            |
| Proxy stripping cursor param | **Yes**     | Cache key doesn't vary           |

---

## Why the Workarounds Fix It

### Workaround 1: Clear localStorage

**Action:** Clear browser localStorage (removes `electric_up_to_date_tracker`)

**Why it works:**

```typescript
// In #fetchShape:
if (!this.#isUpToDate && !this.#replayMode) {
  const shapeKey = canonicalShapeKey(opts.fetchUrl)
  const lastSeenCursor = upToDateTracker.shouldEnterReplayMode(shapeKey)
  if (lastSeenCursor) {
    this.#lastSeenCursor = lastSeenCursor // <-- Never happens if localStorage is empty
  }
}
```

Without the localStorage entry, `shouldEnterReplayMode()` returns `null`, the client never enters replay mode, and the suppression logic is never triggered.

### Workaround 2: Clear Electric Server Cache

**Action:** Reset all shapes on Electric server

**Why it works:**

1. Clears CDN/proxy caches (cached responses are invalidated)
2. Forces fresh responses from server
3. Fresh responses have cursor based on **current time**
4. Current cursor ≠ stale localStorage cursor
5. `currentCursor !== lastSeenCursor` → exits replay mode

**Example:**

- User stuck with `cursor=400` (from 5 minutes ago)
- Server cache cleared
- Fresh response has `cursor=600` (current time)
- `"600" !== "400"` → replay mode exits → loop breaks

---

## Multiple Machines Scenario

### Why Two Machines Get Stuck Simultaneously

When multiple machines sync the same shape:

```
Machine A ──┐                    ┌── localStorage: cursor=400
            ├──► CDN ──► Electric│
Machine B ──┘    Cache    Cache  └── localStorage: cursor=400
```

1. **Shared caching**: Both machines hit the same CDN/Electric cache
2. **Same cursor**: Both receive identical responses with same cursor value
3. **Same localStorage entries**: Both record the same cursor
4. **Both enter replay mode**: On refresh, both enter replay mode with same `lastSeenCursor`
5. **Both get stuck**: Both receive cached responses with matching cursor

### Why This Is Expected

- Cursor is deterministic (based on time, rounded to 20-second intervals)
- CDN cache is shared across all clients
- Electric server cache is shared across all clients
- Clients syncing within the same time window get identical cursor values

### Why Server Cache Clear Fixes Both

When Electric server cache is cleared:

- Both machines' next requests get fresh responses
- Fresh cursor based on current time (different from stale value)
- Both machines exit replay mode simultaneously

---

## The Fix

### Primary Fix

In `packages/typescript-client/src/client.ts`, modify the suppression logic to exit replay mode after the first suppression:

```typescript
if (currentCursor === this.#lastSeenCursor) {
  // Same cursor = still replaying cached responses
  // Suppress this up-to-date notification, but exit replay mode
  // to prevent infinite loops when cached responses have stale cursors
  this.#lastSeenCursor = undefined // <-- ADD THIS LINE
  return
}
```

**Why this works:**

1. First cached up-to-date IS suppressed (preserves intended behavior)
2. Replay mode exits immediately (`#lastSeenCursor = undefined`)
3. Any subsequent up-to-dates are delivered normally
4. No infinite loop possible, regardless of caching behavior

### Secondary Fix (Belt and Suspenders)

Also clear `#lastSeenCursor` in the `#reset()` method:

```typescript
#reset(handle?: string) {
  this.#lastOffset = `-1`
  this.#liveCacheBuster = ``
  this.#shapeHandle = handle
  this.#isUpToDate = false
  this.#isMidStream = true
  this.#connected = false
  this.#schema = undefined
  this.#activeSnapshotRequests = 0
  this.#consecutiveShortSseConnections = 0
  this.#sseFallbackToLongPolling = false
  this.#lastSeenCursor = undefined  // <-- ADD THIS LINE
}
```

This ensures replay mode is also exited when a shape is reset (e.g., after a 409 response).

---

## Additional Considerations

## Verification Notes (Post‑Review)

### Confirmed by code inspection

- **Replay mode is latched by `#lastSeenCursor`.** It is set from localStorage on start and only cleared after the suppression block. This makes replay mode persist if the suppression early‑returns.
- **Suppression early‑return skips replay‑mode exit.** When `currentCursor === #lastSeenCursor`, the function returns before the cleanup that clears `#lastSeenCursor`.
- **Successful fetches loop immediately.** `#requestShape()` calls itself after each successful fetch with no delay, so any repeated cached response can turn into a tight loop.
- **LocalStorage clearing breaks the loop.** Without a recent entry, `shouldEnterReplayMode()` returns `null`, replay mode is never entered, and suppression never triggers.
- **Cloudflare worker caches all shape responses.** Stratovolt’s shape API worker forwards params and fetches with `cf: { cacheEverything: true }`, which makes cursor‑based cache keys realistic in production.

### Corrected from earlier conclusions

- **`#isUpToDate` is still set to `true` even when suppression happens.** The loop is caused by replay mode never exiting (not by `#isUpToDate` staying false).
- **“Indefinite” loop duration depends on caching behavior.** The loop can persist as long as the edge keeps serving the same cursor. It will break if the cache revalidates and the origin returns a new cursor.

### ExpiredShapesCache Performance Issue

The `ExpiredShapesCache.getExpiredHandle()` method updates `lastUsed` and writes to localStorage on **every access**:

```typescript
getExpiredHandle(shapeUrl: string): string | null {
  const entry = this.data[shapeUrl]
  if (entry) {
    entry.lastUsed = Date.now()
    this.save()  // Synchronous localStorage write on EVERY call!
    return entry.expiredHandle
  }
  return null
}
```

This is called in `#constructUrl` for every request. During the infinite loop, this causes thousands of synchronous localStorage writes per second, exacerbating the CPU usage and main thread blocking.

**Recommendation:** Add write throttling similar to `UpToDateTracker.scheduleSave()`.

---

## Summary

| Aspect              | Details                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| **Bug**             | Replay mode doesn't exit when cursor matches, causing infinite loop                              |
| **Trigger**         | Page refresh within 60 seconds + cached responses with matching cursor                           |
| **Symptoms**        | 100% CPU, frozen UI, rapid (invisible) HTTP requests                                             |
| **Duration**        | Can persist until cache serves a new cursor (may appear indefinite with aggressive edge caching) |
| **Root cause**      | `#lastSeenCursor` not cleared when suppressing up-to-date                                        |
| **Why it persists** | Client sends same cursor → cache can return identical cursor repeatedly                          |
| **Fix**             | Clear `#lastSeenCursor` after first suppression                                                  |
| **Workarounds**     | Clear localStorage OR clear Electric server cache                                                |
