defmodule Electric.Plug.ServeShapePlug do
  @moduledoc """
  Plug pipeline for serving shape requests.

  `call/2` is overridden to wrap the whole pipeline in a telemetry span, an
  explicit `try`/`catch` that invokes `handle_errors/2` on uncaught errors,
  and a `try`/`after` that always releases the admission control permit and
  ends the OTEL span.

  Error handling is inspired by `Plug.ErrorHandler`'s pattern but adapts to a
  subtle limitation: `Plug.Builder` does not wrap individual plugs in
  error-capturing frames, so the `conn` visible from the `catch` clause is
  the one passed into `call/2` — not the accumulated conn at the point of
  raise. This means we cannot rely on a `register_before_send` callback on
  the error-handler's conn for admission release. Instead, `check_admission`
  stashes the acquired permit in the process dictionary and the `after`
  clause in `call/2` releases it — firing for success, halt, and exception
  paths alike.

  Admission classification uses only `conn.query_params["handle"]` and a
  single ETS membership check: requests with no handle or an unknown handle
  are classified as `:initial`; requests with a known handle are `:existing`.
  This avoids any SQLite access on the admission-control hot path.

  Using `after` (rather than `register_before_send`) is also what makes the
  streaming path correct: `before_send` fires when `send_chunked` starts
  streaming, not when it finishes, which would end the telemetry span before
  chunk reduction completes and lose `duration` + `streaming_bytes_sent`.
  The `after` clause runs only once `super(conn, opts)` returns, i.e. after
  `Api.Response.send_stream/2` has synchronously drained the body.
  """

  use Plug.Builder

  alias Electric.Plug.TraceContextPlug
  alias Electric.ShapeCache
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes.Api
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Utils
  alias Plug.Conn

  require Logger

  @admission_permit_key {__MODULE__, :admission_permit}
  @subquery_compaction_error "can't be enabled for shapes with subqueries"

  # These plugs are invoked inside the `call/2` function below, after `conn` has been preloaded with
  # query params and an OTEL span.

  # put_resp_content_type runs first so admission rejections (503) still
  # carry `Content-Type: application/json`.
  plug :put_resp_content_type, "application/json"
  plug :check_admission
  plug :parse_body
  plug :validate_request
  plug :reject_subquery_shape_compaction_request
  plug :load_shape
  plug :hold_initial_until_snapshot_started
  # Reclassify off :initial so the :initial admission slot becomes available
  # for new requests while the current handler streams the response.
  plug :reclassify_admission_kind
  plug :serve_shape_response

  @impl Plug
  def call(conn, opts) do
    conn =
      conn
      |> assign(:config, opts)
      |> fetch_query_params()
      |> start_telemetry_span()

    try do
      try do
        conn
        |> super(opts)
        |> emit_shape_telemetry()
      catch
        kind, reason ->
          stack = __STACKTRACE__

          handled_conn =
            conn
            |> handle_caught(kind, reason, stack)
            |> emit_shape_telemetry()

          # Wrap `:error` reasons in Plug.Conn.WrapperError so outer layers
          # (Sentry.PlugCapture, any upstream Plug.ErrorHandler) see the
          # already-sent conn instead of the pre-super conn. `:throw` and
          # `:exit` pass through unchanged.
          Plug.Conn.WrapperError.reraise(handled_conn, kind, reason, stack)
      end
    after
      # Must run unconditionally on every path:
      # - The `memory.end.*` snapshot needs to land on the root span even when
      #   we re-raise mid-stream (the path where emit_shape_telemetry/1 is
      #   skipped) — that's exactly when memory data is most useful.
      # - OpentelemetryTelemetry keeps span contexts on a per-process stack, so
      #   a missed end_telemetry_span call would leak the span to the next
      #   request handled by this worker process (and grow the stack over time).
      # - Admission permits acquired in check_admission must be returned
      #   on success, halt, and uncaught exception paths alike.
      OpenTelemetry.add_process_memory_attributes(:end)
      OpentelemetryTelemetry.end_telemetry_span(OpenTelemetry, %{})
      release_admission_permit()
    end
  end

  # If the response was already sent (e.g. send_chunked partway through a
  # stream), we can't meaningfully recover — re-raise so the caller sees the
  # original error. Otherwise normalize and delegate to handle_errors/2.
  #
  # Pre-existing limitation on the re-raise path: the
  # [:electric, :plug, :serve_shape] telemetry event is NOT emitted when we
  # re-raise. This is inherited from Plug.ErrorHandler's identical
  # {:plug_conn, :sent} check — earlier approaches (outer/inner split;
  # register_before_send) had the same behaviour, because once the response
  # has been committed we no longer have access to the accumulated conn.
  #
  # The admission permit is still released and the OTEL span is still popped
  # via the `after` clause in call/2 — only the aggregate metric is lost.
  # This triggers only when Plug.Conn.chunk/2 raises mid-stream; client
  # disconnects are already handled explicitly as {:error, "closed"} in
  # Api.Response.send_stream/2 without raising.
  defp handle_caught(conn, kind, reason, stack) do
    receive do
      {:plug_conn, :sent} -> :erlang.raise(kind, reason, stack)
    after
      0 -> :ok
    end

    normalized_reason = Exception.normalize(kind, reason, stack)
    status = if kind == :error, do: Plug.Exception.status(normalized_reason), else: 500

    conn
    |> Conn.put_status(status)
    |> handle_error(kind, normalized_reason, stack)
  end

  defp handle_error(conn, kind, exception, stack) do
    OpenTelemetry.record_exception(kind, exception, stack)
    error_str = Exception.format(kind, exception)

    conn
    |> assign(:error_str, error_str)
    |> handle_specific_error(kind, exception)
  end

  defp handle_specific_error(conn, :error, exception)
       when is_exception(exception, DBConnection.ConnectionError) do
    conn
    |> put_resp_header("retry-after", "10")
    |> put_resp_header("cache-control", "no-store")
    |> put_resp_header("surrogate-control", "no-store")
    |> send_resp(
      503,
      Jason.encode!(%{code: "database_unreachable", error: "Database is unreachable"})
    )
  end

  # Catch-all: never echo the formatted exception (which carries the full
  # stacktrace, internal module paths, library versions, and partial query
  # text) back to the client. The detail is preserved server-side via
  # OpenTelemetry.record_exception/3 in handle_error/4 and the `error.type`
  # span attribute, so no observability is lost.
  defp handle_specific_error(conn, _kind, _reason) do
    send_resp(conn, conn.status, Jason.encode!(%{error: "Internal server error"}))
  end

  # Parse JSON body for POST requests to support subset parameters in body
  # This allows clients to send longer subset queries that would exceed URL length limits
  defp parse_body(%Conn{method: "POST"} = conn, _) do
    case Conn.read_body(conn) do
      {:ok, "", conn} ->
        assign(conn, :body_params, %{})

      {:ok, body, conn} ->
        case Jason.decode(body) do
          {:ok, body_params} when is_map(body_params) ->
            assign(conn, :body_params, body_params)

          {:ok, _} ->
            Logger.debug("Received non-object JSON body from client")

            conn
            |> send_resp(400, Jason.encode!(%{error: "Request body must be a JSON object"}))
            |> halt()

          {:error, %Jason.DecodeError{} = error} ->
            Logger.debug("Invalid JSON in request body: #{Exception.message(error)}")

            conn
            |> send_resp(
              400,
              Jason.encode!(%{
                error: "Invalid JSON in request body",
                details: Exception.message(error)
              })
            )
            |> halt()
        end

      {:more, _, conn} ->
        Logger.warning("Request body exceeded size limit")

        conn
        |> send_resp(413, Jason.encode!(%{error: "Request body too large"}))
        |> halt()

      {:error, reason} ->
        Logger.warning("Failed to read request body: #{inspect(reason)}")

        conn
        |> send_resp(400, Jason.encode!(%{error: "Failed to read request body"}))
        |> halt()
    end
  end

  defp parse_body(conn, _), do: assign(conn, :body_params, %{})

  @subset_keys ~w(where order_by limit offset params where_expr order_by_expr)

  defp validate_request(%Conn{assigns: %{config: config, body_params: body_params}} = conn, _) do
    Logger.debug("Query String: #{Electric.Plug.Utils.redact_query_string(conn.query_string)}")

    query_params = Utils.extract_prefixed_keys_into_map(conn.query_params, "subset", "__")
    merged_params = merge_body_params(query_params, body_params)

    api = Access.fetch!(config, :api)

    all_params =
      Map.merge(merged_params, conn.path_params)
      |> Map.update("live", "false", &(&1 != "false"))
      |> Map.update(
        "live_sse",
        # TODO: remove experimental_live_sse after proper deprecation
        Map.get(merged_params, "experimental_live_sse", "false"),
        &(&1 != "false")
      )

    case Api.validate_params(api, all_params) do
      {:ok, request} ->
        assign(conn, :request, request)

      {:error, response} ->
        conn
        |> Api.Response.send(response)
        |> halt()
    end
  end

  # Merge body params into query params, handling subset params specially
  defp merge_body_params(query_params, body_params) when map_size(body_params) == 0 do
    query_params
  end

  defp merge_body_params(query_params, %{"subset" => subset_params} = body_params)
       when is_map(subset_params) do
    existing_subset = Map.get(query_params, "subset", %{})

    query_params
    |> Map.merge(body_params)
    |> Map.put("subset", Map.merge(existing_subset, subset_params))
  end

  defp merge_body_params(query_params, body_params) do
    {subset_params, other_params} = Map.split(body_params, @subset_keys)

    if map_size(subset_params) > 0 do
      existing_subset = Map.get(query_params, "subset", %{})

      query_params
      |> Map.merge(other_params)
      |> Map.put("subset", Map.merge(existing_subset, subset_params))
    else
      Map.merge(query_params, body_params)
    end
  end

  defp reject_subquery_shape_compaction_request(%{assigns: %{request: request}} = conn, _) do
    if Api.Params.compaction_enabled?(request.params) and
         request.params.shape_definition.shape_dependencies != [] do
      conn
      |> Api.Response.send(
        Api.Response.invalid_request(request,
          errors: %{experimental_compaction: [@subquery_compaction_error]}
        )
      )
      |> halt()
    else
      conn
    end
  end

  defp check_admission(%Conn{assigns: %{config: config}} = conn, _) do
    stack_id = get_in(config, [:stack_id])
    kind = admission_kind(conn, stack_id)
    max_concurrent = Map.fetch!(config[:api].max_concurrent_requests, kind)

    case Electric.AdmissionControl.try_acquire(stack_id, kind, max_concurrent: max_concurrent) do
      :ok ->
        # Stash the acquired permit in the process dictionary so the `after`
        # clause in call/2 releases it on every code path (success, halt, or
        # uncaught exception).
        Process.put(@admission_permit_key, {stack_id, kind})
        conn

      {:error, :overloaded} ->
        retry_after = calculate_retry_after(stack_id, max_concurrent)

        response =
          Api.Response.error(
            get_in(config, [:api]),
            %{
              code: "concurrent_request_limit_exceeded",
              message:
                "Concurrent #{kind} request limit exceeded (limit: #{max_concurrent}), please retry"
            },
            status: 503,
            known_error: true,
            retry_after: retry_after
          )

        conn
        |> put_resp_header("cache-control", "no-store")
        |> put_resp_header("surrogate-control", "no-store")
        |> Api.Response.send(response)
        |> halt()
    end
  end

  defp admission_kind(conn, stack_id) do
    handle = conn.query_params["handle"]

    cond do
      is_nil(handle) -> :initial
      ShapeStatus.has_shape_handle?(stack_id, handle) -> :existing
      # Handle is present but unknown locally (stale from another instance,
      # or for a shape this node has not yet recovered/created).
      true -> :initial
    end
  rescue
    # Per-stack shape_meta_table may not exist yet during startup.
    ArgumentError -> :initial
  end

  defp calculate_retry_after(_stack_id, _max_concurrent) do
    # Simple version: random 5-10 seconds with jitter
    # This spreads out retry attempts to prevent thundering herd
    # TODO: Make adaptive based on actual metrics (P95 latency, queue depth, etc.)
    base = 5
    jitter = :rand.uniform(5)
    base + jitter
  end

  defp release_admission_permit do
    case Process.delete(@admission_permit_key) do
      {stack_id, kind} -> Electric.AdmissionControl.release(stack_id, kind)
      nil -> :ok
    end
  end

  # This keeps the :initial permit held across Snapshotter PG-pool checkout so saturation of
  # the snapshot pool turns into admission rejections at the gate rather than an unbounded
  # Postgrex queue.
  #
  # The await outcome is stashed in `request.snapshot_status` and consumed by
  # `Shapes.get_merged_log_stream` instead of being awaited again on the streaming path.
  defp hold_initial_until_snapshot_started(
         %Conn{assigns: %{request: %{handle: handle} = request}} = conn,
         _
       )
       when is_binary(handle) do
    case Process.get(@admission_permit_key) do
      {stack_id, :initial} ->
        result = ShapeCache.await_snapshot_start(handle, stack_id)
        assign(conn, :request, %{request | snapshot_status: result})

      _ ->
        conn
    end
  end

  defp hold_initial_until_snapshot_started(conn, _), do: conn

  # Moves the handler out of :initial so the :initial bucket can admit the next
  # validate-and-load wave while this request is still streaming the response body
  # to the client.
  defp reclassify_admission_kind(%Conn{assigns: %{config: config}} = conn, _) do
    with {stack_id, :initial} <- Process.get(@admission_permit_key),
         max = Map.fetch!(config[:api].max_concurrent_requests, :existing),
         :ok <-
           Electric.AdmissionControl.try_swap(stack_id, :initial, :existing, max_concurrent: max) do
      Process.put(@admission_permit_key, {stack_id, :existing})
    end

    conn
  end

  defp load_shape(%Conn{assigns: %{request: request}} = conn, _) do
    case Api.load_shape_info(request) do
      {:ok, request} ->
        assign(conn, :request, request)

      {:error, response} ->
        conn
        |> Api.Response.send(response)
        |> halt()
    end
  end

  defp serve_shape_response(%Conn{assigns: %{request: request}} = conn, _) do
    Api.serve_shape_response(conn, request)
  end

  #
  ### Telemetry
  #

  # Below, OpentelemetryTelemetry does the heavy lifting of setting up the span context in the
  # current Elixir process to correctly attribute subsequent calls to OpenTelemetry.with_span()
  # in this module as descendants of the root span, as they are all invoked in the same process
  # unless a new process is spawned explicitly.

  defp start_telemetry_span(conn) do
    OpentelemetryTelemetry.start_telemetry_span(OpenTelemetry, "Plug_shape_get", %{}, %{})
    OpenTelemetry.add_process_memory_attributes(:start)

    conn
    |> add_span_attrs_from_conn()
    |> put_private(:electric_telemetry_span, %{start_time: System.monotonic_time()})
  end

  # Emit the shape-request telemetry event and set final root-span attributes.
  #
  # Counterpart to start_telemetry_span/1: runs near the end of call/2 after all plugs (or
  # handle_errors) have finished, so attributes captured here reflect the final state of the
  # request — including `streaming_bytes_sent` assigned by Api.Response.send_stream/2 on the
  # success path.
  defp emit_shape_telemetry(%Conn{assigns: assigns} = conn) do
    start_time = get_in(conn.private, [:electric_telemetry_span, :start_time])
    now = System.monotonic_time()
    bytes_sent = assigns[:streaming_bytes_sent] || 0
    is_live = get_live_mode(assigns)
    stack_id = get_in(conn.assigns, [:config, :stack_id])

    OpenTelemetry.execute(
      [:electric, :plug, :serve_shape],
      %{
        count: 1,
        bytes: bytes_sent,
        monotonic_time: now,
        duration: if(start_time, do: now - start_time, else: 0)
      },
      %{
        live: is_live,
        shape_handle: get_handle(assigns) || conn.query_params["handle"],
        client_ip: conn.remote_ip,
        status: conn.status,
        stack_id: stack_id,
        known_error: Api.Response.conn_has_known_error?(conn)
      }
    )

    # Per-shape response size histogram. Tagged by `root_table`, `is_live`
    # and `stack_id` so operators can attribute payload volume to individual
    # shapes and tell initial snapshots apart from live long-polls.
    :telemetry.execute(
      [:electric, :shape, :response_size],
      %{bytes: bytes_sent},
      %{
        root_table: get_root_table(assigns, conn),
        is_live: is_live,
        stack_id: stack_id
      }
    )

    add_span_attrs_from_conn(conn)
  end

  defp get_handle(%{response: %{shape_handle: shape_handle}}), do: shape_handle
  defp get_handle(%{request: %{shape_handle: shape_handle}}), do: shape_handle
  defp get_handle(_), do: nil

  defp get_live_mode(%{response: %{params: %{live: live}}}), do: live
  defp get_live_mode(%{request: %{params: %{live: live}}}), do: live
  defp get_live_mode(_), do: false

  # Used as a metric label for the response-size histogram. The goal is low
  # cardinality (one value per configured shape root table), so we only emit
  # the validated `table` from request params. If validation never ran (e.g.
  # the request was rejected before parse), fall back to nil rather than
  # echoing back attacker-controlled query string values.
  defp get_root_table(%{request: %{params: %{table: table}}}, _conn) when is_binary(table),
    do: table

  defp get_root_table(_assigns, _conn), do: nil

  # Put the request's span attributes — the usual conn-derived attributes plus the
  # `SampleRate` sampling weight when an upstream rate hint applies — onto the root span.
  #
  # Successful responses carry the upstream rate `N` (parsed from the client request's
  # `tracestate` header), 5xx responses carry `1`. When the remote parent was not sampled
  # the parent-based sampler left no recording span, so `add_span_attributes` is a no-op
  # and nothing is stamped or exported.
  #
  # Called both at span start (status not yet known: the rate hint is stamped as-is) and
  # at emit time, when the final attribute values overwrite the initial ones.
  defp add_span_attrs_from_conn(conn) do
    conn
    |> open_telemetry_attrs()
    |> Map.merge(TraceContextPlug.sample_rate_attrs(conn, conn.status))
    |> OpenTelemetry.add_span_attributes()

    conn
  end

  defp open_telemetry_attrs(%Conn{assigns: assigns} = conn) do
    request = Map.get(assigns, :request, %{}) |> bare_map()
    params = Map.get(request, :params, %{}) |> bare_map()
    response = (Map.get(assigns, :response) || Map.get(request, :response) || %{}) |> bare_map()
    attrs = Map.get(response, :trace_attrs, %{})
    maybe_up_to_date = Map.get(response, :up_to_date, false)

    is_live_req =
      if is_nil(params[:live]),
        do: !is_nil(conn.query_params["live"]) && conn.query_params["live"] != "false",
        else: params[:live]

    replica =
      if is_nil(params[:replica]),
        do: conn.query_params["replica"],
        else: to_string(params[:replica])

    columns =
      if is_nil(params[:columns]),
        do: conn.query_params["columns"],
        else: Enum.join(params[:columns], ",")

    OpenTelemetry.get_stack_span_attrs(get_in(conn.assigns, [:config, :stack_id]))
    |> Map.merge(Electric.Plug.Utils.common_open_telemetry_attrs(conn))
    |> Map.merge(%{
      "shape.handle" => conn.query_params["handle"] || params[:handle] || request[:handle],
      "shape.where" => conn.query_params["where"] || params[:where],
      "shape.root_table" => conn.query_params["table"] || params[:table],
      "shape.columns" => columns,
      # # Very verbose info to add to spans - keep out unless we explicitly need it
      # "shape.definition" =>
      #   if(not is_nil(params[:shape_definition]),
      #     do: Electric.Shapes.Shape.to_json_safe(params[:shape_definition])
      #   ),
      "shape.replica" => replica,
      "shape_req.is_live" => is_live_req,
      "shape_req.offset" => conn.query_params["offset"],
      "shape_req.is_shape_rotated" => attrs[:ot_is_shape_rotated] || false,
      "shape_req.is_long_poll_timeout" => attrs[:ot_is_long_poll_timeout] || false,
      "shape_req.is_empty_response" => attrs[:ot_is_empty_response] || false,
      "shape_req.is_immediate_response" => attrs[:ot_is_immediate_response] || true,
      "shape_req.is_cached" => if(conn.status, do: conn.status == 304),
      "shape_req.is_error" => if(conn.status, do: conn.status >= 400),
      "shape_req.is_up_to_date" => maybe_up_to_date
    })
  end

  defp bare_map(%_{} = struct), do: Map.from_struct(struct)
  defp bare_map(map) when is_map(map), do: map
end
