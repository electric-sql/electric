# HTTP/API Layer Implementation

This document provides a deep implementation dive into the HTTP/API layer in Electric's sync-service.

## Overview

The HTTP layer is built on Plug and handles shape requests through a sophisticated pipeline including authentication, admission control, long-polling, and SSE streaming.

## 1. Router Implementation

**File**: `lib/electric/plug/router.ex`

### Middleware Pipeline (Exact Order)

```elixir
plug Plug.RequestId, assign_as: :plug_request_id
plug :server_header, Electric.version()
plug :add_stack_id_to_metadata
plug Plug.Head  # Converts HEAD requests to GET
plug RemoteIp
plug :match
plug Electric.Plug.LabelProcessPlug
plug Electric.Plug.TraceContextPlug
plug Plug.Telemetry, event_prefix: [:electric, :routing]
plug Plug.Logger, log: :debug
plug Sentry.PlugContext
plug :authenticate
plug :put_cors_headers
plug :dispatch
```

### Authentication Implementation

```elixir
def authenticate(%Plug.Conn{method: "OPTIONS"} = conn, _opts), do: conn

def authenticate(%Plug.Conn{request_path: "/v1/shape"} = conn, _opts) do
  api_secret = conn.assigns.config[:secret]

  if is_nil(api_secret) do
    conn  # Insecure mode
  else
    conn = conn |> fetch_query_params()

    case conn.query_params["secret"] || conn.query_params["api_secret"] do
      ^api_secret -> conn
      _ ->
        conn
        |> send_resp(401, Jason.encode!(%{message: "Unauthorized"}))
        |> halt()
    end
  end
end
```

### CORS Handling

```elixir
def put_cors_headers(%Plug.Conn{path_info: ["v1", "shape" | _]} = conn, _opts),
  do: CORSHeaderPlug.call(conn, %{methods: ["GET", "HEAD", "DELETE", "OPTIONS"]})

def put_cors_headers(conn, _opts),
  do: CORSHeaderPlug.call(conn, %{methods: ["GET", "HEAD"]})
```

## 2. ServeShapePlug

**File**: `lib/electric/plug/serve_shape_plug.ex`

### Plug Pipeline

```elixir
plug :fetch_query_params
plug :start_telemetry_span
plug :put_resp_content_type, "application/json"
plug :validate_request
plug :check_admission
plug :serve_shape_response
plug :end_telemetry_span
```

### Request Validation

```elixir
defp validate_request(%Conn{assigns: %{config: config}} = conn, _) do
  query_params = Utils.extract_prefixed_keys_into_map(conn.query_params, "subset", "__")

  all_params =
    Map.merge(query_params, conn.path_params)
    |> Map.update("live", "false", &(&1 != "false"))
    |> Map.update("live_sse", Map.get(query_params, "experimental_live_sse", "false"),
         &(&1 != "false"))

  case Api.validate(api, all_params) do
    {:ok, request} -> assign(conn, :request, request)
    {:error, response} ->
      conn |> Api.Response.send(response) |> halt()
  end
end
```

### Admission Control

```elixir
defp check_admission(%Conn{assigns: %{config: config}} = conn, _) do
  stack_id = get_in(config, [:stack_id])

  kind = if conn.query_params["offset"] == "-1", do: :initial, else: :existing
  max_concurrent = Map.fetch!(config[:api].max_concurrent_requests, kind)

  case Electric.AdmissionControl.try_acquire(stack_id, kind, max_concurrent: max_concurrent) do
    :ok ->
      conn
      |> put_private(:admission_permit_acquired, true)
      |> put_private(:admission_stack_id, stack_id)
      |> put_private(:admission_kind, kind)
      |> register_before_send(fn conn ->
          if conn.private[:admission_permit_acquired] do
            Electric.AdmissionControl.release(stack_id, conn.private[:admission_kind])
          end
          conn
        end)

    {:error, :overloaded} ->
      retry_after = calculate_retry_after(stack_id, max_concurrent)

      conn
      |> put_resp_header("cache-control", "no-store")
      |> put_resp_header("retry-after", to_string(retry_after))
      |> send_resp(503, Jason.encode!(%{code: "overloaded", message: "..."}))
      |> halt()
  end
end
```

## 3. API Module

**File**: `lib/electric/shapes/api.ex`

### Request Validation Flow

```elixir
def validate(%Api{} = api, params) when is_configured(api) do
  with :ok <- hold_until_stack_ready(api),
       {:ok, request} <- validate_params(api, params),
       {:ok, request} <- load_shape_info(request) do
    {:ok, seek(request)}
  end
end
```

### Shape Resolution Logic

```elixir
# No handle provided - get or create
defp get_or_create_shape_handle(%Request{params: %{handle: nil}} = request) do
  %{params: %{shape_definition: shape}, api: %{stack_id: stack_id}} = request
  Shapes.get_or_create_shape_handle(stack_id, shape)
end

# Handle provided - resolve it
defp get_or_create_shape_handle(%Request{} = request) do
  %{params: %{handle: handle, shape_definition: shape}, api: %{stack_id: stack_id}} = request
  Shapes.resolve_shape_handle(stack_id, handle, shape)
end
```

### Handle Shape Info Cases

**Case 1: Handle matches**

```elixir
defp handle_shape_info({active_shape_handle, last_offset}, request)
     when is_nil(shape_handle) or shape_handle == active_shape_handle do
  {:ok, Request.update_response(%{request | handle: active_shape_handle, ...})}
end
```

**Case 2: Handle mismatch (409 redirect)**

```elixir
defp handle_shape_info({active_shape_handle, _}, request) do
  error = Api.Error.must_refetch()
  {:error, Response.error(request, error.message, handle: active_shape_handle, status: 409)}
end
```

### Offset Handling

**offset = "-1" (before_all):**

- Returns full snapshot
- Sets long max-age (1 week)

**offset = "now":**

- Returns immediately with current offset
- Up-to-date control message

**Real offset (numeric):**

- Returns changes since offset
- May long-poll or SSE stream

### Up-to-Date Determination

```elixir
defp determine_up_to_date(%Request{} = request) do
  %{last_offset: last_offset, chunk_end_offset: chunk_end_offset, params: %{offset: offset}} = request

  latest_seen_offset = LogOffset.max(last_offset, offset)

  if LogOffset.compare(chunk_end_offset, latest_seen_offset) == :lt or offset == @before_all_offset do
    Request.update_response(request, &%{&1 | up_to_date: false})
  else
    Request.update_response(request, &%{&1 | up_to_date: true})
  end
end
```

## 4. Long-Polling Implementation

### How hold_until_change Works

```elixir
defp hold_until_change(%Request{} = request) do
  %{new_changes_ref: ref, handle: shape_handle, api: %{long_poll_timeout: timeout}} = request

  receive do
    {^ref, :new_changes, latest_log_offset} ->
      %{request | last_offset: latest_log_offset}
      |> determine_global_last_seen_lsn()
      |> determine_log_chunk_offset()
      |> determine_up_to_date()
      |> do_serve_shape_log()

    {^ref, :shape_rotation, new_handle} ->
      error = Api.Error.must_refetch()
      Response.error(request, error.message, handle: new_handle, status: 409)

    {^ref, :shape_rotation} ->
      Response.error(request, error.message, status: 409)

    {^ref, :out_of_bounds_timeout} ->
      Response.invalid_request(api, errors: @offset_out_of_bounds)
  after
    timeout ->
      case Electric.StatusMonitor.status(api.stack_id) do
        %{shape: :up} -> no_change_response(request)
        _ -> Response.error(request, message, status: 503, retry_after: 10)
      end
  end
end
```

### Registry Subscription

```elixir
defp listen_for_new_changes(%Request{params: %{live: true}} = request) do
  %{last_offset: last_offset, handle: handle, params: %{offset: offset}, api: %{stack_id: stack_id}} = request

  if LogOffset.compare(offset, last_offset) != :lt or
       last_offset == LogOffset.last_before_real_offsets() do
    ref = Electric.StackSupervisor.subscribe_to_shape_events(stack_id, handle)
    %{request | new_changes_pid: self(), new_changes_ref: ref}
  else
    request
  end
end
```

### Message Types Received

```elixir
{ref, :new_changes, latest_log_offset}     # New data available
{ref, :shape_rotation, new_handle}         # Shape recreated
{ref, :shape_rotation}                     # Shape deleted
{ref, :out_of_bounds_timeout}              # Out-of-bounds check
```

## 5. SSE Streaming Implementation

### Stream.resource Implementation

```elixir
defp stream_sse_events(%Request{} = request) do
  %{new_changes_ref: ref, api: %{keepalive_interval: keepalive, sse_timeout: timeout}} = request

  keepalive_ref = Process.send_after(self(), {:sse_keepalive, ref}, keepalive)
  timeout_ref = Process.send_after(self(), {:sse_timeout, ref}, timeout)

  sse_event_stream =
    Stream.resource(
      fn ->
        %SseState{
          mode: :receive,
          request: request,
          stream: nil,
          since_offset: since_offset,
          last_message_time: System.monotonic_time(:millisecond),
          keepalive_ref: keepalive_ref
        }
      end,
      &next_sse_event/1,
      fn %SseState{keepalive_ref: ref} ->
        Process.cancel_timer(ref)
        Process.cancel_timer(timeout_ref)
      end
    )

  %{request.response | chunked: true, body: sse_event_stream}
end
```

### Keep-Alive Mechanism

```elixir
# In :receive mode
{:sse_keepalive, ^ref} ->
  current_time = System.monotonic_time(:millisecond)
  time_since_last = current_time - last_message_time

  if time_since_last >= keepalive_interval do
    new_ref = Process.send_after(self(), {:sse_keepalive, ref}, keepalive_interval)
    {[": keep-alive\n\n"], %{state | last_message_time: current_time, keepalive_ref: new_ref}}
  else
    remaining = keepalive_interval - time_since_last
    new_ref = Process.send_after(self(), {:sse_keepalive, ref}, remaining)
    {[], %{state | keepalive_ref: new_ref}}
  end
```

### SSE State Machine

```elixir
# :receive mode - Block on receive for shape changes
# :emit mode - Stream data chunks
# :done mode - Terminate stream

defp next_sse_event(%SseState{mode: :emit, stream: stream} = state) do
  case StreamSplit.take_and_drop(stream, 3) do
    {[], _} -> {[], %{state | mode: :receive, stream: nil}}
    {head, tail} -> {head, %{state | stream: tail}}
  end
end

defp next_sse_event(%SseState{mode: :done} = state), do: {:halt, state}
```

## 6. Response Building

**File**: `lib/electric/shapes/api/response.ex`

### Header Construction

```elixir
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
  |> put_retry_after_header(response)
  |> put_sse_headers(response)
end
```

### Cache Control Logic

| Request Type        | Cache-Control                                                           |
| ------------------- | ----------------------------------------------------------------------- |
| Initial (offset=-1) | `public, max-age=604800, s-maxage=3600, stale-while-revalidate=2629746` |
| Live SSE            | `public, max-age={sse_timeout - 1}`                                     |
| Live long-poll      | `public, max-age=5, stale-while-revalidate=5`                           |
| Non-live            | `public, max-age=60, stale-while-revalidate=300`                        |
| 409 redirects       | `public, max-age=60, must-revalidate`                                   |
| Errors (4xx/5xx)    | `no-store`                                                              |

### ETag Generation

```elixir
def etag(%__MODULE__{handle: handle, offset: offset, params: params, no_changes: true}, opts) do
  # Include monotonic time for empty responses
  "#{handle}:#{params.offset}:#{offset}:#{System.monotonic_time()}"
end

def etag(%__MODULE__{handle: handle, offset: offset, params: params}, opts) do
  "#{handle}:#{params.offset}:#{offset}"
end
```

### Streaming Implementation

```elixir
defp send_stream(%Plug.Conn{} = conn, %__MODULE__{status: status} = response) do
  conn = Plug.Conn.send_chunked(conn, status)

  {conn, bytes_sent} =
    response.body
    |> Enum.reduce_while({conn, 0}, fn chunk, {conn, bytes_sent} ->
      chunk_size = IO.iodata_length(chunk)

      case Plug.Conn.chunk(conn, chunk) do
        {:ok, conn} -> {:cont, {conn, bytes_sent + chunk_size}}
        {:error, reason} when reason in ["closed", :closed] ->
          {:halt, {Plug.Conn.assign(conn, :error_str, "Connection closed"), bytes_sent}}
        {:error, reason} ->
          {:halt, {Plug.Conn.assign(conn, :error_str, inspect(reason)), bytes_sent}}
      end
    end)

  Plug.Conn.assign(conn, :streaming_bytes_sent, bytes_sent)
end
```

## 7. Parameter Validation

**File**: `lib/electric/shapes/api/params.ex`

### Ecto Schema Usage

```elixir
@primary_key false
embedded_schema do
  field(:table, :string)
  field(:offset, :string)
  field(:handle, :string)
  field(:live, :boolean, default: false)
  field(:where, :string)
  field(:columns, ColumnList)
  field(:replica, Ecto.Enum, values: [:default, :full], default: :default)
  field(:params, {:map, :string}, default: %{})
  field(:live_sse, :boolean, default: false)
  field(:log, Ecto.Enum, values: [:changes_only, :full], default: :full)
  embeds_one(:subset, SubsetParams)
end
```

### Custom Types

**ColumnList:**

```elixir
defmodule ColumnList do
  use Ecto.Type

  def cast([_ | _] = columns), do: validate_column_names(columns)

  def cast(columns) when is_binary(columns) do
    Electric.Plug.Utils.parse_columns_param(columns)
  end
end
```

### Validation Pipeline

```elixir
def validate(%Electric.Shapes.Api{} = api, params) do
  params
  |> cast_params()
  |> validate_required([:offset])
  |> cast_offset()
  |> validate_handle_with_offset()
  |> validate_live_with_offset()
  |> validate_live_sse()
  |> cast_root_table(api)
  |> cast_subset(api)
  |> apply_action(:validate)
  |> convert_error(api)
end
```

### Offset Validation

```elixir
def cast_offset(%Ecto.Changeset{} = changeset) do
  offset = fetch_change!(changeset, :offset)

  case LogOffset.from_string(offset) do
    {:ok, offset} -> put_change(changeset, :offset, offset)
    {:error, message} -> add_error(changeset, :offset, message)
  end
end
```

**Accepts:**

- `"-1"` → `LogOffset.before_all()`
- `"now"` → `:now` atom
- Numeric string → Parsed LogOffset

## 8. Essential Files

| File                                    | Purpose                     |
| --------------------------------------- | --------------------------- |
| `lib/electric/plug/router.ex`           | Main router with middleware |
| `lib/electric/plug/serve_shape_plug.ex` | Request handler             |
| `lib/electric/shapes/api.ex`            | Core API logic              |
| `lib/electric/shapes/api/request.ex`    | Request struct              |
| `lib/electric/shapes/api/response.ex`   | Response building           |
| `lib/electric/shapes/api/params.ex`     | Parameter validation        |
| `lib/electric/shapes/api/encoder.ex`    | JSON/SSE encoders           |
| `lib/electric/shapes/api/sse_state.ex`  | SSE state machine           |
| `lib/electric/admission_control.ex`     | Rate limiting               |
| `lib/electric/plug/utils.ex`            | CORS, column parsing        |

## 9. Key Implementation Insights

### Request Lifecycle

```
HTTP Request
  → Router middleware (auth, CORS, logging)
  → ServeShapePlug validation
  → Admission control (ETS counters)
  → Api.validate (Ecto schema)
  → Shape resolution
  → Offset seeking
  → Response generation (immediate, long-poll, or SSE)
  → Cleanup (unregister from Registry)
```

### Long-Polling vs SSE

| Aspect         | Long-Polling           | SSE                             |
| -------------- | ---------------------- | ------------------------------- |
| Implementation | Single `receive` block | `Stream.resource` state machine |
| Timeout        | 20s                    | 60s                             |
| Response       | Single response        | Multiple events                 |
| Format         | JSON                   | `data: ...\n\n`                 |
| Keep-alive     | N/A                    | Comments every 21s              |

### Registry Pattern

- Uses Elixir Registry for pub/sub
- Duplicate keys (multiple subscribers per shape)
- Clients register with `{stack_id, shape_handle}` key
- Consumer notifies via `Registry.dispatch/3`
- Cleanup unregisters from Registry
