# Electric Load Shedding Evaluation & Implementation Plan

## Executive Summary

Based on the load shedding document and codebase analysis, Electric currently lacks critical load shedding mechanisms. The client has basic exponential backoff but **doesn't honor `Retry-After` headers**, and the server has **no admission control, rate limiting, or coordinated backoff**.

This evaluation provides concrete, prioritized recommendations to prevent thundering herd scenarios and enable graceful degradation under load.

---

## Current State Analysis

### TypeScript Client (`packages/typescript-client/src/fetch.ts`)

**What Exists:**
- Exponential backoff: 100ms initial → 10s max, 1.3x multiplier
- Retries on HTTP 429 and 5xx errors
- `onFailedAttempt` callback hook

**Critical Gaps:**
- ❌ **Does NOT honor `Retry-After` headers** from 429/503 responses
- ❌ No jitter (synchronization risk during boot storms)
- ❌ No retry budget (unlimited retries amplify load)
- ❌ Fixed backoff parameters (not adaptive)

### Sync Service (`packages/sync-service/lib/electric/`)

**What Exists:**
- Returns 503 when database unreachable (`serve_shape_plug.ex:186`)
- Returns 503 when stack not ready with timeout (`shapes/api.ex:388`)
- Has `long_poll_timeout` (20s default) and `stack_ready_timeout` (5s default)

**Critical Gaps:**
- ❌ **No rate limiting or admission control**
- ❌ No concurrency limits or bounded queues
- ❌ Never returns 429 (rate limit exceeded)
- ❌ Never returns `Retry-After` headers
- ❌ No overload detection based on CPU/memory/latency
- ❌ No per-tenant fairness or quotas
- ❌ No adaptive backoff guidance

---

## Priority 1: Ship This Week (Minimal Viable Load Shedding)

### 1.1 Client: Honor `Retry-After` Header

**File:** `packages/typescript-client/src/fetch.ts`

**Implementation:**

```typescript
// In createFetchWithBackoff, around line 62:
while (true) {
  try {
    const result = await fetchClient(...args)
    if (result.ok) return result

    const err = await FetchError.fromResponse(result, url.toString())
    throw err
  } catch (e) {
    onFailedAttempt?.()
    if (options?.signal?.aborted) {
      throw new FetchBackoffAbortError()
    } else if (
      e instanceof FetchError &&
      !HTTP_RETRY_STATUS_CODES.includes(e.status) &&
      e.status >= 400 &&
      e.status < 500
    ) {
      throw e
    } else {
      // NEW: Check for Retry-After header
      let waitMs = delay

      if (e instanceof FetchError && e.headers) {
        const retryAfter = e.headers['retry-after']
        if (retryAfter) {
          const retryAfterSec = Number(retryAfter)
          if (Number.isFinite(retryAfterSec)) {
            // Retry-After in seconds
            waitMs = retryAfterSec * 1000
          } else {
            // Retry-After as HTTP date
            const retryDate = Date.parse(retryAfter)
            if (!isNaN(retryDate)) {
              waitMs = Math.max(0, retryDate - Date.now())
            }
          }
        }
      }

      // NEW: Add full jitter (AWS recommended pattern)
      const jitter = Math.random() * Math.min(delay, maxDelay)
      waitMs = Math.max(waitMs, jitter)

      await new Promise((resolve) => setTimeout(resolve, waitMs))

      delay = Math.min(delay * multiplier, maxDelay)

      if (debug) {
        attempt++
        console.log(`Retry attempt #${attempt} after ${waitMs}ms`)
      }
    }
  }
}
```

**Why This Matters:**
- Server can now signal "I'm overloaded, don't retry for N seconds"
- Prevents retry storms from amplifying load
- Client cooperates with server-driven backoff

**Effort:** 2-4 hours
**Impact:** HIGH - Foundation for all server-side load shedding

---

### 1.2 Server: Add `Retry-After` Header to 503 Responses

**File:** `packages/sync-service/lib/electric/shapes/api.ex`

**Changes Needed:**

**Location 1: Stack Not Ready (line 388)**
```elixir
# Current:
{:error, Response.error(api, message, status: 503)}

# New:
{:error, Response.error(api, message, status: 503, retry_after: 5)}
```

**Location 2: Handle Live Request Timeout (line 791)**
```elixir
# Current:
Response.error(request, message, status: 503)

# New:
Response.error(request, message, status: 503, retry_after: 10)
```

**Location 3: Snapshot Errors (line 666)**
```elixir
# Current:
Response.error(request, message, status: 503, known_error: true)

# New:
Response.error(request, message, status: 503, known_error: true, retry_after: 10)
```

**File:** `packages/sync-service/lib/electric/shapes/api/response.ex`

**Add Header Support:**
```elixir
# Add to defstruct (around line 26):
defstruct [
  :handle,
  :offset,
  :shape_definition,
  :known_error,
  :retry_after,  # NEW
  # ... rest
]

# Add new header function (around line 230):
defp put_retry_after_header(conn, %__MODULE__{retry_after: nil}) do
  conn
end

defp put_retry_after_header(conn, %__MODULE__{retry_after: seconds}) do
  Plug.Conn.put_resp_header(conn, "retry-after", "#{seconds}")
end

# Update put_resp_headers to call it (around line 220):
defp put_resp_headers(conn, response) do
  conn
  |> put_cache_headers(response)
  |> put_cursor_headers(response)
  |> put_etag_headers(response)
  |> put_shape_handle_header(response)
  |> put_schema_header(response)
  |> put_up_to_date_header(response)
  |> put_offset_header(response)
  |> put_known_error_header(response)
  |> put_retry_after_header(response)  # NEW
  |> put_sse_headers(response)
end
```

**Why This Matters:**
- Server can now tell clients "wait N seconds before retrying"
- Prevents boot storms from overwhelming the WAL consumer
- Gives stack time to catch up during cold starts

**Effort:** 4-6 hours
**Impact:** HIGH - Immediate load reduction during overload

---

### 1.3 Server: Add Basic Admission Control (Per-Stack Concurrency Limit)

**New File:** `packages/sync-service/lib/electric/admission_control.ex`

```elixir
defmodule Electric.AdmissionControl do
  @moduledoc """
  Simple admission control using ETS-based counters to limit concurrent requests.
  """

  use GenServer
  require Logger

  @table_name :electric_admission_control

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  @doc """
  Try to acquire a permit for the given stack_id. Returns :ok if permit granted,
  {:error, :overloaded} if at capacity.
  """
  def try_acquire(stack_id, max_concurrent \\ 1000) do
    current = :ets.update_counter(@table_name, stack_id, {2, 1, max_concurrent, max_concurrent}, {stack_id, 0})

    if current >= max_concurrent do
      :ets.update_counter(@table_name, stack_id, {2, -1, 0, 0}, {stack_id, 0})
      {:error, :overloaded}
    else
      :ok
    end
  end

  @doc """
  Release a permit for the given stack_id.
  """
  def release(stack_id) do
    :ets.update_counter(@table_name, stack_id, {2, -1, 0, 0}, {stack_id, 0})
    :ok
  end

  @impl true
  def init(_) do
    :ets.new(@table_name, [:named_table, :public, :set, write_concurrency: true])
    {:ok, %{}}
  end
end
```

**File:** `packages/sync-service/lib/electric/plug/serve_shape_plug.ex`

**Add Admission Control Check:**
```elixir
# Add new plug after :validate_request (around line 22):
plug :check_admission
plug :serve_shape_response

# New function:
defp check_admission(%Conn{assigns: %{config: config}} = conn, _) do
  stack_id = get_in(config, [:stack_id])
  max_concurrent = get_in(config, [:max_concurrent_requests]) || 1000

  case Electric.AdmissionControl.try_acquire(stack_id, max_concurrent) do
    :ok ->
      # Store that we acquired a permit so we can release it later
      conn
      |> put_private(:admission_permit_acquired, true)
      |> register_before_send(fn conn ->
        if conn.private[:admission_permit_acquired] do
          Electric.AdmissionControl.release(stack_id)
        end
        conn
      end)

    {:error, :overloaded} ->
      # Calculate adaptive retry-after based on queue depth (simple version)
      retry_after = calculate_retry_after(stack_id, max_concurrent)

      response = Electric.Shapes.Api.Response.error(
        get_in(config, [:api]),
        "Server is currently overloaded, please retry",
        status: 503,
        retry_after: retry_after
      )

      conn
      |> Electric.Shapes.Api.Response.send(response)
      |> halt()
  end
end

defp calculate_retry_after(_stack_id, _max_concurrent) do
  # Simple version: random 5-10 seconds
  # TODO: Make adaptive based on actual metrics
  5 + :rand.uniform(5)
end
```

**Configuration:** Add to your config files:
```elixir
config :electric, :max_concurrent_requests, 1000
```

**Why This Matters:**
- Prevents unbounded concurrency from starving the WAL consumer
- Fails fast with 503 + Retry-After instead of queuing indefinitely
- Simple, cheap ETS-based implementation (no database)

**Effort:** 6-8 hours
**Impact:** CRITICAL - Prevents server collapse under load

---

### 1.4 Client: Add Retry Budget

**File:** `packages/typescript-client/src/fetch.ts`

**Implementation:**
```typescript
export interface BackoffOptions {
  initialDelay: number
  maxDelay: number
  multiplier: number
  onFailedAttempt?: () => void
  debug?: boolean
  // NEW:
  maxRetries?: number  // Max retry attempts
  retryBudgetPercent?: number  // % of requests that can be retries (0.1 = 10%)
}

export const BackoffDefaults = {
  initialDelay: 100,
  maxDelay: 10_000,
  multiplier: 1.3,
  maxRetries: 10,  // NEW
  retryBudgetPercent: 0.1,  // NEW: 10% retry budget
}

// Add retry budget tracking (module-level)
let totalRequests = 0
let totalRetries = 0
let budgetResetTime = Date.now() + 60_000  // Reset every minute

function checkRetryBudget(retryBudgetPercent: number): boolean {
  const now = Date.now()
  if (now > budgetResetTime) {
    totalRequests = 0
    totalRetries = 0
    budgetResetTime = now + 60_000
  }

  totalRequests++

  if (totalRequests < 10) return true  // Allow retries for first 10 requests

  const currentRetryRate = totalRetries / totalRequests
  const hasCapacity = currentRetryRate < retryBudgetPercent

  if (hasCapacity) {
    totalRetries++
  }

  return hasCapacity
}

export function createFetchWithBackoff(
  fetchClient: typeof fetch,
  backoffOptions: BackoffOptions = BackoffDefaults
): typeof fetch {
  const {
    initialDelay,
    maxDelay,
    multiplier,
    debug = false,
    onFailedAttempt,
    maxRetries = 10,
    retryBudgetPercent = 0.1,
  } = backoffOptions

  return async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const url = args[0]
    const options = args[1]

    let delay = initialDelay
    let attempt = 0

    while (true) {
      try {
        const result = await fetchClient(...args)
        if (result.ok) return result

        const err = await FetchError.fromResponse(result, url.toString())
        throw err
      } catch (e) {
        onFailedAttempt?.()

        if (options?.signal?.aborted) {
          throw new FetchBackoffAbortError()
        } else if (
          e instanceof FetchError &&
          !HTTP_RETRY_STATUS_CODES.includes(e.status) &&
          e.status >= 400 &&
          e.status < 500
        ) {
          throw e
        } else {
          // Check retry budget
          attempt++
          if (attempt >= maxRetries || !checkRetryBudget(retryBudgetPercent)) {
            if (debug) {
              console.log(`Retry budget exhausted or max retries reached (${attempt}/${maxRetries})`)
            }
            throw e
          }

          // Honor Retry-After + add jitter
          let waitMs = delay

          if (e instanceof FetchError && e.headers) {
            const retryAfter = e.headers['retry-after']
            if (retryAfter) {
              const retryAfterSec = Number(retryAfter)
              if (Number.isFinite(retryAfterSec)) {
                waitMs = Math.max(waitMs, retryAfterSec * 1000)
              } else {
                const retryDate = Date.parse(retryAfter)
                if (!isNaN(retryDate)) {
                  waitMs = Math.max(waitMs, retryDate - Date.now())
                }
              }
            }
          }

          // Add full jitter
          const jitter = Math.random() * Math.min(delay, maxDelay)
          waitMs = Math.max(waitMs, jitter)

          await new Promise((resolve) => setTimeout(resolve, waitMs))

          delay = Math.min(delay * multiplier, maxDelay)

          if (debug) {
            console.log(`Retry attempt #${attempt} after ${waitMs}ms`)
          }
        }
      }
    }
  }
}
```

**Why This Matters:**
- Prevents mass retries from amplifying load during outages
- Limits retries to 10% of total traffic (configurable)
- Reset window (1 minute) allows recovery

**Effort:** 4-6 hours
**Impact:** MEDIUM-HIGH - Prevents client-side retry storms

---

## Priority 2: Next Sprint (Adaptive & Smarter)

### 2.1 Server: Adaptive Retry-After Based on Metrics

**New File:** `packages/sync-service/lib/electric/overload_advisor.ex`

```elixir
defmodule Electric.OverloadAdvisor do
  @moduledoc """
  Computes adaptive retry-after values based on system metrics.
  Tracks moving window of request latency and replication lag.
  """

  use GenServer
  require Logger

  @table_name :electric_overload_metrics

  defstruct [
    :stack_id,
    request_latencies: [],  # Last N latencies
    max_samples: 100,
    overload_threshold_p95: 5_000,  # 5 second p95 triggers overload
  ]

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    GenServer.start_link(__MODULE__, opts, name: via(stack_id))
  end

  def record_request_latency(stack_id, latency_ms) do
    GenServer.cast(via(stack_id), {:record_latency, latency_ms})
  end

  def get_retry_after(stack_id) do
    GenServer.call(via(stack_id), :get_retry_after)
  end

  def is_overloaded?(stack_id) do
    GenServer.call(via(stack_id), :is_overloaded)
  end

  @impl true
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    state = %__MODULE__{
      stack_id: stack_id,
      max_samples: Keyword.get(opts, :max_samples, 100),
      overload_threshold_p95: Keyword.get(opts, :overload_threshold_p95, 5_000)
    }

    {:ok, state}
  end

  @impl true
  def handle_cast({:record_latency, latency_ms}, state) do
    latencies = [latency_ms | state.request_latencies]
    latencies = Enum.take(latencies, state.max_samples)
    {:noreply, %{state | request_latencies: latencies}}
  end

  @impl true
  def handle_call(:get_retry_after, _from, state) do
    retry_after = calculate_retry_after(state)
    {:reply, retry_after, state}
  end

  @impl true
  def handle_call(:is_overloaded, _from, state) do
    overloaded = is_system_overloaded?(state)
    {:reply, overloaded, state}
  end

  defp calculate_retry_after(state) do
    cond do
      length(state.request_latencies) < 10 ->
        # Not enough data, use default
        5

      is_system_overloaded?(state) ->
        # Heavy overload, back off 10-30 seconds
        p95 = percentile(state.request_latencies, 0.95)
        base_seconds = div(p95, 1000)  # Convert ms to seconds
        min(30, max(10, base_seconds))

      true ->
        # Light load, short backoff
        :rand.uniform(3) + 2  # 2-5 seconds
    end
  end

  defp is_system_overloaded?(state) do
    if length(state.request_latencies) < 10 do
      false
    else
      p95 = percentile(state.request_latencies, 0.95)
      p95 > state.overload_threshold_p95
    end
  end

  defp percentile(list, p) when p >= 0 and p <= 1 do
    sorted = Enum.sort(list)
    index = round(length(sorted) * p) - 1
    index = max(0, min(index, length(sorted) - 1))
    Enum.at(sorted, index)
  end

  defp via(stack_id) do
    {:via, Registry, {Electric.Registry, {__MODULE__, stack_id}}}
  end
end
```

**Integration:** Update admission control to use adaptive advisor:
```elixir
defp calculate_retry_after(stack_id, _max_concurrent) do
  case GenServer.whereis({:via, Registry, {Electric.Registry, {Electric.OverloadAdvisor, stack_id}}}) do
    nil -> 5  # Fallback
    _pid -> Electric.OverloadAdvisor.get_retry_after(stack_id)
  end
end
```

**Why This Matters:**
- Retry-After adapts to actual system load
- P95 latency is a strong signal of overload
- Prevents fixed backoff from being too short (overload) or too long (underutilization)

**Effort:** 8-12 hours
**Impact:** MEDIUM - Improves efficiency of backoff

---

### 2.2 Server: Per-Tenant/Shape Rate Limiting

**File:** Create `packages/sync-service/lib/electric/rate_limiter.ex`

Use token bucket or leaky bucket per tenant/shape combination:

```elixir
defmodule Electric.RateLimiter do
  @moduledoc """
  Token bucket rate limiter per tenant/shape.
  """

  use GenServer

  # Store: {tenant_id, shape_handle} => {tokens, last_refill_time}
  @table_name :electric_rate_limiter

  @doc """
  Check if request is allowed. Returns :ok or {:error, retry_after_seconds}.
  """
  def check_rate_limit(tenant_id, shape_handle, opts \\ []) do
    key = {tenant_id, shape_handle}
    burst_size = Keyword.get(opts, :burst_size, 100)
    refill_rate = Keyword.get(opts, :refill_per_second, 10)

    now = System.monotonic_time(:millisecond)

    case :ets.lookup(@table_name, key) do
      [] ->
        # First request, initialize bucket
        :ets.insert(@table_name, {key, burst_size - 1, now})
        :ok

      [{^key, tokens, last_refill}] ->
        # Refill tokens based on time elapsed
        elapsed_ms = now - last_refill
        refilled_tokens = div(elapsed_ms * refill_rate, 1000)
        current_tokens = min(burst_size, tokens + refilled_tokens)

        if current_tokens >= 1 do
          :ets.update_element(@table_name, key, [{2, current_tokens - 1}, {3, now}])
          :ok
        else
          # No tokens available, calculate retry-after
          tokens_needed = 1
          ms_until_available = div(tokens_needed * 1000, refill_rate)
          retry_after = div(ms_until_available, 1000) + 1
          {:error, retry_after}
        end
    end
  end

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  @impl true
  def init(_) do
    :ets.new(@table_name, [:named_table, :public, :set, write_concurrency: true])
    {:ok, %{}}
  end
end
```

**Integration:** Add to `serve_shape_plug.ex`:
```elixir
defp check_admission(%Conn{assigns: %{config: config, request: request}} = conn, _) do
  # ... existing admission control ...

  # Add rate limiting per tenant/shape
  tenant_id = extract_tenant_id(conn)  # From auth header or IP
  shape_handle = get_in(request, [:handle])

  case Electric.RateLimiter.check_rate_limit(tenant_id, shape_handle) do
    :ok ->
      conn
    {:error, retry_after} ->
      response = Electric.Shapes.Api.Response.error(
        get_in(config, [:api]),
        "Rate limit exceeded",
        status: 429,
        retry_after: retry_after
      )

      conn
      |> Electric.Shapes.Api.Response.send(response)
      |> halt()
  end
end
```

**Why This Matters:**
- Prevents single tenant from starving others
- Shape-specific limits protect expensive shapes
- Returns 429 (not 503) to distinguish rate limiting from overload

**Effort:** 10-14 hours
**Impact:** MEDIUM - Fairness and protection

---

### 2.3 Server: Bootstrap Coalescing Endpoint

**New File:** `packages/sync-service/lib/electric/plug/bootstrap_advice_plug.ex`

```elixir
defmodule Electric.Plug.BootstrapAdvicePlug do
  @moduledoc """
  Returns a small cacheable JSON response with retry advice.
  CDN can coalesce many identical requests during boot storms.
  """

  use Plug.Builder

  plug :fetch_query_params
  plug :serve_advice

  defp serve_advice(conn, _opts) do
    stack_id = conn.query_params["stack_id"] || "default"

    retry_after = case Electric.OverloadAdvisor.get_retry_after(stack_id) do
      seconds when is_integer(seconds) -> seconds
      _ -> 5
    end

    advice = %{
      retryAfter: retry_after,
      jitter: :rand.uniform(2) + 1,  # 1-3 seconds jitter
      notBefore: System.system_time(:millisecond) + retry_after * 1000,
      message: "Server is warming up, please wait before polling"
    }

    conn
    |> put_resp_content_type("application/json")
    |> put_resp_header("cache-control", "public, max-age=1, stale-while-revalidate=5")
    |> put_resp_header("access-control-allow-origin", "*")
    |> send_resp(200, Jason.encode!(advice))
  end
end
```

**Router Integration:** Add to your router:
```elixir
get "/v1/bootstrap-advice", Electric.Plug.BootstrapAdvicePlug, []
```

**Client Integration:** Client hits this endpoint first during cold starts, CDN collapses requests.

**Why This Matters:**
- CDN can cache and coalesce identical bootstrap requests for 1-2 seconds
- Reduces initial surge by 10-100x
- Small response (< 1KB) is cheaper than shape sync

**Effort:** 4-6 hours
**Impact:** MEDIUM - Protects against boot storms

---

## Priority 3: Infrastructure & Polish

### 3.1 Edge Rate Limiting (NGINX/Envoy)

If using NGINX:
```nginx
limit_req_zone $binary_remote_addr zone=per_ip:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=per_ip_conn:10m;

server {
  location /v1/shape {
    limit_req zone=per_ip burst=20 nodelay;
    limit_conn per_ip_conn 5;  # Max 5 concurrent connections per IP

    limit_req_status 429;
    add_header Retry-After "5" always;

    proxy_pass http://electric_backend;
  }
}
```

**Why This Matters:**
- Stops flood before it reaches application
- Cheap, fast, kernel-level enforcement
- Works even if Electric is down

**Effort:** 2-4 hours (if NGINX already in use)
**Impact:** MEDIUM - First line of defense

---

### 3.2 Metrics & Observability

Add metrics to track:
- Request concurrency (current, max)
- Admission control rejects (count, rate)
- Rate limiter rejects (count per tenant/shape)
- Retry-After histogram (what values are we sending?)
- Client retry budget exhaustion (needs client instrumentation)

Integration with Prometheus/OpenTelemetry:
```elixir
# In admission_control.ex:
:telemetry.execute(
  [:electric, :admission_control, :reject],
  %{count: 1},
  %{stack_id: stack_id, reason: :overloaded}
)

:telemetry.execute(
  [:electric, :admission_control, :concurrency],
  %{value: current_concurrent},
  %{stack_id: stack_id}
)
```

**Why This Matters:**
- Visibility into load shedding effectiveness
- Tune thresholds based on real data
- Alert on sustained overload

**Effort:** 6-10 hours
**Impact:** LOW-MEDIUM - Essential for tuning

---

## Summary: Recommended Implementation Order

### Week 1 (Must Ship):
1. ✅ Client: Honor `Retry-After` header (2-4h)
2. ✅ Server: Add `Retry-After` to 503 responses (4-6h)
3. ✅ Server: Basic admission control with concurrency limit (6-8h)
4. ✅ Client: Add retry budget (4-6h)

**Total:** ~20-24 hours, ~3 days for 1 engineer

### Week 2 (High Value):
5. ✅ Server: Adaptive `Retry-After` based on latency metrics (8-12h)
6. ✅ Server: Per-tenant/shape rate limiting with 429 responses (10-14h)

**Total:** ~18-26 hours, ~3 days for 1 engineer

### Week 3 (Polish):
7. ✅ Server: Bootstrap coalescing endpoint (4-6h)
8. ✅ Infrastructure: NGINX rate limiting (2-4h)
9. ✅ Observability: Metrics and dashboards (6-10h)

**Total:** ~12-20 hours, ~2 days for 1 engineer

---

## Testing Strategy

### Load Testing Scenarios:

1. **Boot Storm:** Simulate 1000 clients starting simultaneously
   - Before: All hit server at once, WAL consumer can't keep up
   - After: Admission control + Retry-After spreads load, no failures

2. **Single Tenant Flood:** One tenant makes 10,000 requests/sec
   - Before: Starves other tenants
   - After: Rate limiter returns 429, other tenants unaffected

3. **Database Outage:** Kill Postgres for 30 seconds
   - Before: Unlimited retries amplify load, slow recovery
   - After: Retry budgets + backoff = clean recovery

4. **Replication Lag:** WAL consumer falls behind by 10 seconds
   - Before: Long-polls pile up, OOM risk
   - After: Admission control sheds load with 503 + adaptive Retry-After

### Metrics to Track:
- P95/P99 latency before vs after
- Concurrent connections before vs after
- WAL consumer lag during overload
- Client success rate during overload
- Time to recover from overload

---

## Open Questions for Discussion

1. **Concurrency Limit:** What should `max_concurrent_requests` be per stack?
   - Recommendation: Start with 1000, tune based on memory
   - Formula: `(available_memory_mb * 0.7) / avg_request_memory_mb`

2. **Rate Limits:** Per-tenant vs per-shape vs per-tenant-per-shape?
   - Recommendation: Per-tenant-per-shape for fairness

3. **Retry Budget:** Client-side (current impl) vs server-enforced?
   - Recommendation: Both - client prevents self-DOS, server enforces policy

4. **Bootstrap Advice:** Mandatory or opt-in?
   - Recommendation: Opt-in initially, measure CDN cache hit rate

5. **Edge Rate Limiting:** Who owns NGINX config - infra team or app team?
   - Recommendation: Coordinate with infra, provide reference config

---

## Risk Assessment

### Risks of NOT Implementing:
- 🔴 **HIGH:** Thundering herd during cold starts overwhelms WAL consumer
- 🔴 **HIGH:** Single tenant can DOS entire stack
- 🟡 **MEDIUM:** No visibility into overload conditions until failure
- 🟡 **MEDIUM:** Retry storms amplify outages

### Risks of Implementing:
- 🟢 **LOW:** Admission control too aggressive = false rejects
  - Mitigation: Start with high limits (1000), tune down
- 🟢 **LOW:** Retry-After too long = poor user experience
  - Mitigation: Start with short values (5-10s), make adaptive
- 🟡 **MEDIUM:** Bug in rate limiter = legitimate traffic blocked
  - Mitigation: Feature flag, rollout gradually, monitor closely

---

## Appendix: Reference Implementations

### AWS Exponential Backoff with Jitter
https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/

### Finagle Retry Budgets
https://twitter.github.io/finagle/guide/Clients.html#retries

### Google SRE: Handling Overload
https://sre.google/sre-book/handling-overload/

### Netflix Concurrency Limits (Gradient2)
https://github.com/Netflix/concurrency-limits

### HTTP RFC 9110 (503, Retry-After)
https://www.rfc-editor.org/rfc/rfc9110.html#name-503-service-unavailable

### HTTP RFC 6585 (429 Too Many Requests)
https://www.rfc-editor.org/rfc/rfc6585.html#section-4
