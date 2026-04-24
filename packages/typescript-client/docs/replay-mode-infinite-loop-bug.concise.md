# Replay Mode Infinite Loop Bug (Concise)

## Summary (Quick Read)

The TypeScript client’s replay mode can enter a tight request loop that freezes the UI when cached responses keep returning the same cursor as the one stored in localStorage. The loop happens because replay mode suppresses up‑to‑date notifications but never exits when the cursor is unchanged. Clearing localStorage or clearing the server cache breaks the loop by preventing replay mode or forcing a new cursor.

**Confirmed facts**

- Replay mode is triggered by a recent cursor stored in localStorage.
- If a cached response returns the same cursor, the suppression logic returns early and never clears replay mode.
- The stream immediately re‑requests on success, producing a tight loop with no backoff.
- Clearing localStorage prevents replay mode, stopping the loop.
- Electric Cloud’s worker uses aggressive edge caching (`cacheEverything: true`) and forwards query params, making cursor‑based cache keys realistic.

**Scope**

- Most likely with CDN/proxy caching (Electric Cloud default).
- Most likely for static or low‑activity shapes.
- Reproducible on refresh within ~60 seconds of the last successful sync.

---

## How to Reproduce (Minimal)

1. Open app, sync succeeds, cursor is saved to localStorage.
2. Refresh within 60 seconds.
3. Cached response returns the same cursor.
4. Replay mode suppresses up‑to‑date and never exits → infinite loop.

**The 60‑second window resets on every successful sync** because the up‑to‑date timestamp is overwritten each time.

---

## What Replay Mode Is For

**Problem it solves**

- Cached responses can trigger multiple up‑to‑date notifications during initial sync, causing unnecessary renders.

**How it works**

- On startup, if localStorage has a recent cursor (< 60s), replay mode activates.
- While replaying cached responses, up‑to‑date notifications are suppressed until a new cursor is observed.

**The bug**

- When the cursor **does not change**, suppression returns early and replay mode is never cleared.

---

## Root Cause (Code‑Level)

**Where it breaks**

- In `ShapeStream.#onMessages`, suppression returns early on cursor equality, skipping the cleanup that clears replay mode.

**Key behaviors**

- Replay mode is “on” whenever `#lastSeenCursor` is set.
- `#lastSeenCursor` is only cleared _after_ the suppression branch.
- The request loop has no success backoff; it immediately re‑requests.

---

## Infinite Loop Flow (Step‑By‑Step)

**Prerequisites**

- Recent up‑to‑date entry in localStorage.
- Cached responses return the same cursor.

**Flow**

1. Start stream → replay mode enters with `lastSeenCursor`.
2. Cached response returns `cursor = lastSeenCursor`.
3. Suppression returns early → replay mode stays active.
4. `#requestShape()` immediately runs again.
5. Same cached response → same suppression → repeat.

**Why it hits 100% CPU**

- The loop is asynchronous but tight; successful responses have no backoff, so the event loop stays saturated.

---

## Server‑Side Caching Behavior

**Electric server headers**

- Live requests get short cache lifetimes and an `electric-cursor` header.
- Cursor is computed from the previous cursor (to advance over time).

**Why cached responses can stall**

- Edge cache can serve a response with the same cursor repeatedly.
- If the edge does not revalidate or revalidation returns the same cursor, the loop persists.

---

## Electric Cloud: Why Default Setup Triggers It

**Caching architecture**

- Stratovolt shape worker forwards params and enables caching:
  - `cf: { cacheEverything: true }`
- Query params (including `cursor`) are part of the cache key by default.

**Result**

- “Same cursor” responses can be served repeatedly from edge cache.
- Static shapes are especially vulnerable (no new writes to advance the cursor).

---

## Why the Loop Can Persist

**Important clarification**

- The loop is guaranteed if the same cursor keeps being served.
- It is _not_ strictly “forever” unless the cache never delivers a new cursor.

**Practical effect**

- With aggressive edge caching and static data, it can appear indefinite.
- If a new cursor eventually arrives (fresh origin response), replay mode exits.

---

## When the Bug Does NOT Occur

- **Direct connection to Electric** (no CDN/proxy caching).
- **Active shapes** with frequent writes (cursor advances quickly).
- **Refresh after the 60‑second TTL** (replay mode not entered).
- **First‑time client** with empty localStorage.

---

## Why the Workarounds Fix It

**Workaround 1: Clear localStorage**

- Removes the replay‑mode trigger entry.
- Replay mode is never entered, suppression never triggers.

**Workaround 2: Clear Electric server cache**

- Forces fresh responses with new cursors.
- Replay mode exits once cursor changes.

---

## Multiple Machines Scenario

**Why two machines can get stuck together**

- Edge cache is shared per region.
- If the cache stores a single cursor, all clients at that edge see the same cursor.

**Why a single cache clear fixes all**

- Cache invalidation forces a fresh cursor for all clients at that edge.

---

## The Fix

**Primary fix**

- Clear `#lastSeenCursor` when suppression occurs so replay mode exits after the first suppression.

**Secondary fix**

- Also clear `#lastSeenCursor` in `#reset()` to avoid replay mode persisting across resets.

---

## Additional Considerations

**ExpiredShapesCache performance**

- `getExpiredHandle()` writes to localStorage on _every_ access.
- During a tight loop this multiplies main‑thread pressure.
- Recommended: add write throttling similar to `UpToDateTracker`.

---

## Verification Notes (Post‑Review)

**Confirmed**

- Replay mode is latched by `#lastSeenCursor`.
- Suppression returns early before replay mode exits.
- Request loop is immediate on success.
- localStorage clearing prevents replay mode.
- Cloudflare worker caches all shape responses (`cacheEverything: true`).

**Corrected from earlier assumptions**

- `#isUpToDate` is set to `true` even when suppression happens.
- “Indefinite” loop depends on cache behavior, not guaranteed by client logic alone.

---

## Summary Table

| Aspect          | Details                                               |
| --------------- | ----------------------------------------------------- |
| **Bug**         | Replay mode never exits when cursor matches           |
| **Trigger**     | Refresh within 60s + cached response with same cursor |
| **Symptoms**    | 100% CPU, frozen UI, rapid (invisible) HTTP requests  |
| **Duration**    | Persists while cache keeps serving same cursor        |
| **Root cause**  | `#lastSeenCursor` not cleared on suppression          |
| **Fix**         | Clear `#lastSeenCursor` on first suppression          |
| **Workarounds** | Clear localStorage or server cache                    |
