# Retry Strategy: Balancing Offline Support and Server Protection

## The Challenge

Electric clients need to handle two opposing requirements:

1. **Offline resilience**: Retry indefinitely when clients go offline (laptop closes, network drops, etc.)
2. **Server protection**: Don't amplify load during server overload with retry storms

Traditional retry strategies fail at one or both:
- ❌ Fixed retry limit (e.g., "retry 10 times") → breaks offline clients
- ❌ Unlimited retries without backoff → amplifies server load during outages

## Our Solution: Retry Budget + Server-Driven Backoff

Electric uses a **multi-layered strategy** that retries forever while protecting the server:

### Layer 1: Infinite Retries (Offline Support)
```typescript
maxRetries: Infinity  // Default - retry forever
```

Clients retry indefinitely, allowing them to reconnect after:
- Network disconnects
- Laptop sleep/wake
- Temporary infrastructure issues
- Long-running operations

### Layer 2: Retry Budget (Rate Limiting)
```typescript
retryBudgetPercent: 0.1  // Only 10% of traffic can be retries
```

**How it works:**
- Track: Total requests vs retry requests in 60-second windows
- Limit: Retries can be at most 10% of total traffic
- Result: Even with 1000 concurrent clients, max 100 retry requests/window

**Example:**
```
Window 1: 1000 requests, 50 retries   → 5% retry rate   → ✅ Allowed
Window 2: 1000 requests, 150 retries  → 15% retry rate  → ❌ Throttled
Window 3: 1000 requests, 80 retries   → 8% retry rate   → ✅ Allowed
```

**When budget exhausted:**
- Client waits `maxDelay` (60 seconds) before trying again
- Doesn't give up - just backs off
- Budget resets every 60 seconds

### Layer 3: Server-Driven Backoff (Retry-After)
```http
HTTP/1.1 503 Service Unavailable
Retry-After: 10
```

**How it works:**
- Server returns `Retry-After` header when overloaded
- Client honors it: waits at least that long before retry
- Server controls timing: can tell clients "wait 10s" or "wait 60s"

**Server signals:**
- Stack not ready → `Retry-After: 5`
- Database down → `Retry-After: 10`
- Heavy overload → `Retry-After: 30` (adaptive in Priority 2)

### Layer 4: Exponential Backoff with Jitter
```typescript
initialDelay: 100ms → 130ms → 169ms → ... → 60s (capped)
+ jitter: random(0, currentDelay)
```

**Benefits:**
- Spreads retry attempts across time
- Prevents thundering herd (synchronized retries)
- Caps at 60s: reasonable for long-lived connections
- Jitter: prevents multiple clients from synchronizing

### Layer 5: Admission Control (Server-Side)
```elixir
max_concurrent_requests: 1000  # Per stack
```

**How it works:**
- Server tracks concurrent requests in ETS
- When at capacity: return 503 + `Retry-After: 5-10`
- Clients back off, spreading load over time

---

## How It All Works Together

### Scenario 1: Client Goes Offline
```
Client → Server: GET /shape
         (network drops)
Client → retry after 100ms (fails - no network)
Client → retry after 130ms (fails - no network)
Client → retry after 169ms (fails - no network)
...
Client → retry after 60s (fails - no network)
Client → retry after 60s (fails - no network)
         (network returns)
Client → retry after 60s ✅ SUCCESS
```

**Result:** Client eventually reconnects when network returns

### Scenario 2: Server Overload
```
1000 Clients → Server: GET /shape (all at once)

Server: Only 1000 concurrent slots available
Server → 1000 clients: 200 OK ✅
Server → other clients: 503 + Retry-After: 5-10

Clients honor Retry-After:
  - Wait 5-10 seconds (varies per client due to jitter)
  - Spread out retry attempts
  - Server has time to process existing requests

Server → returning clients: 200 OK ✅ (as capacity becomes available)
```

**Result:** Load spreads over time, server doesn't collapse

### Scenario 3: Database Outage (30 seconds)
```
1000 Clients → Server → Database (down)
Server → Clients: 503 + Retry-After: 10

Clients wait 10 seconds

1000 Clients → Server → Database (still down)
Server → Clients: 503 + Retry-After: 10

But wait! Retry budget kicks in:
  - Only 100 retry requests allowed (10% of 1000)
  - 900 clients hit budget, wait 60s
  - 100 clients retry immediately

100 Clients → Server → Database (still down)
Server → 100 Clients: 503 + Retry-After: 10

After 30s, database recovers:

100 Clients → Server → Database: ✅ SUCCESS
(60s window resets, more clients can retry)
```

**Result:** Retry budget prevents amplification, but clients eventually reconnect

### Scenario 4: Boot Storm (1000 clients start at once)
```
1000 Clients → Server: GET /shape (t=0)

Server admission control: 1000 concurrent limit
Server → 1000 clients: 200 OK ✅
Server → 0 rejected (under limit)

Without jitter (what NOT to do):
  - All 1000 retry at same time if they fail
  - Thundering herd

With jitter (what we do):
  - Client 1 retries after 100ms
  - Client 2 retries after 87ms
  - Client 3 retries after 143ms
  - ... spread across 0-100ms
```

**Result:** Jitter prevents synchronized retries

---

## Configuration

### Client (TypeScript)

**Default (recommended for most use cases):**
```typescript
import { ShapeStream } from '@electric-sql/client'

const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  // Uses defaults - retry forever with retry budget
})
```

**Custom (advanced users):**
```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  backoff: {
    initialDelay: 100,           // Start with 100ms
    maxDelay: 60_000,            // Cap at 60s
    multiplier: 1.3,             // Exponential backoff
    maxRetries: Infinity,        // Retry forever (default)
    retryBudgetPercent: 0.1,     // 10% retry budget (default)
    debug: true                  // Log retry attempts
  }
})
```

**Disable retry budget (NOT recommended):**
```typescript
// Only do this if you really know what you're doing!
// Without retry budget, you can amplify server load 10-100x during outages
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  backoff: {
    retryBudgetPercent: 1.0  // Allow 100% retries (no budget)
  }
})
```

**Hard limit retries (for specific use cases):**
```typescript
// E.g., one-off sync that should give up after 5 attempts
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  backoff: {
    maxRetries: 5  // Give up after 5 attempts
  }
})
```

### Server (Elixir)

**Environment variable:**
```bash
export ELECTRIC_MAX_CONCURRENT_REQUESTS=1000
```

**Config file:**
```elixir
config :electric, :max_concurrent_requests, 1000
```

**Adjust based on memory:**
```elixir
# Formula: (available_memory_mb * 0.7) / avg_request_memory_mb
# Example: (8000 MB * 0.7) / 5 MB = ~1120 concurrent requests
config :electric, :max_concurrent_requests, 1000
```

---

## Why This Works

### Mathematical Properties

**Without retry budget:**
```
Outage scenario:
- 1000 clients experience error
- Each retries 10 times
- 1000 * 10 = 10,000 requests
- 10x amplification! 🔥
```

**With retry budget:**
```
Same outage scenario:
- 1000 clients experience error
- Retry budget: max 10% of traffic
- 1000 * 0.1 = 100 retry requests
- 0.1x amplification ✅
```

**With Retry-After + Jitter:**
```
Boot storm:
- 1000 clients start at t=0
- Server says: Retry-After: 10s
- With jitter: retries spread across 10-11s window
- Each second receives ~100 requests
- Server can handle them ✅

Without jitter:
- All 1000 retry at exactly t=10s
- Server overloaded again 🔥
- Repeat until collapse
```

### Load Under Different Conditions

| Scenario | Retry Budget | Retry-After | Result |
|----------|-------------|-------------|---------|
| Normal operation | Not triggered | Not sent | Full throughput |
| Intermittent errors | Caps at 10% | Not needed | Slight backoff |
| Server overload | Caps at 10% | Spreads load | Server recovers |
| Database outage | Caps at 10% | Server-driven | No amplification |
| Client offline | Not triggered | Not applicable | Eventual reconnect |

---

## Best Practices

### ✅ Do:
- Use default settings (infinite retries + 10% budget)
- Let server control timing via Retry-After
- Monitor retry rates in your observability stack
- Adjust `max_concurrent_requests` based on memory

### ❌ Don't:
- Set `maxRetries` to a low number (breaks offline support)
- Disable retry budget (`retryBudgetPercent: 1.0`)
- Ignore Retry-After headers
- Set `maxDelay` too low (< 10s) or too high (> 120s)

### 🔍 Monitor:
- Retry rate (should be < 10% steady state)
- 503 responses with Retry-After (indicates overload)
- Admission control rejects (tune `max_concurrent_requests`)
- Client success rate (should recover after transient errors)

---

## Comparison to Other Strategies

### Traditional: Fixed Retry Limit
```typescript
// Bad: Breaks offline support
maxRetries: 10  // Gives up after 10 tries
```
- ❌ Client goes offline → gives up after 10 tries
- ❌ Long outage → client never recovers
- ✅ Simple to understand

### Traditional: Unlimited Retries
```typescript
// Bad: No load shedding
maxRetries: Infinity
retryBudgetPercent: 1.0  // No budget
```
- ✅ Client offline → eventually reconnects
- ❌ Server outage → 10-100x amplification
- ❌ Can DOS your own server

### Electric's Approach
```typescript
// Best: Offline support + load shedding
maxRetries: Infinity
retryBudgetPercent: 0.1  // + Retry-After + Jitter
```
- ✅ Client offline → eventually reconnects
- ✅ Server outage → capped at 10% amplification
- ✅ Server controls timing
- ✅ Jitter prevents thundering herd

---

## References

- **AWS**: [Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- **Google SRE**: [Handling Overload](https://sre.google/sre-book/handling-overload/)
- **Finagle**: [Retry Budgets](https://twitter.github.io/finagle/guide/Clients.html#retries)
- **HTTP RFC 9110**: [503 Service Unavailable](https://www.rfc-editor.org/rfc/rfc9110.html#name-503-service-unavailable)
- **HTTP RFC 6585**: [429 Too Many Requests](https://www.rfc-editor.org/rfc/rfc6585.html#section-4)
