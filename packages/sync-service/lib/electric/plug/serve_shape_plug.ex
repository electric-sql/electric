defmodule Electric.Plug.ServeShapePlug do
  use Plug.Builder, copy_opts_to_assign: :config
  use Plug.ErrorHandler

  # The halt/1 function is redefined further down below
  import Plug.Conn, except: [halt: 1]

  alias Electric.Utils
  alias Electric.Shapes.Api
  alias Electric.Telemetry.OpenTelemetry
  alias Plug.Conn

  require Logger

  plug :fetch_query_params
  plug :parse_body

  # start_telemetry_span needs to always be the first plug after fetching query params.
  plug :start_telemetry_span
  plug :put_resp_content_type, "application/json"

  plug :validate_request
  # Admission control is applied here, but note:
  # - /v1/health bypasses this plug (routed to HealthCheckPlug)
  # - /metrics bypasses this plug (on separate utility router/port)
  # - / (root) bypasses this plug (handled directly in router)
  # This ensures observability remains available under load
  plug :check_admission
  plug :serve_shape_response

  # end_telemetry_span needs to always be the last plug here.
  plug :end_telemetry_span

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
    Logger.debug("Query String: #{conn.query_string}")

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

    case Api.validate(api, all_params) do
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

  defp check_admission(%Conn{assigns: %{config: config}} = conn, _) do
    stack_id = get_in(config, [:stack_id])

    kind =
      if conn.query_params["offset"] == "-1",
        do: :initial,
        else: :existing

    max_concurrent = Map.fetch!(config[:api].max_concurrent_requests, kind)

    case Electric.AdmissionControl.try_acquire(stack_id, kind, max_concurrent: max_concurrent) do
      :ok ->
        # Store that we acquired a permit so we can release it later
        # register_before_send is called before ANY response (success, error, exception)
        # This ensures cleanup on all paths that send a response
        conn
        |> put_private(:admission_permit_acquired, true)
        |> put_private(:admission_stack_id, stack_id)
        |> put_private(:admission_kind, kind)
        |> register_before_send(fn conn ->
          # Release permit before sending response
          # This runs on success, error, and exception paths
          if conn.private[:admission_permit_acquired] do
            Electric.AdmissionControl.release(stack_id, conn.private[:admission_kind])
          end

          conn
        end)

      {:error, :overloaded} ->
        # Calculate adaptive retry-after based on load
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

  defp calculate_retry_after(_stack_id, _max_concurrent) do
    # Simple version: random 5-10 seconds with jitter
    # This spreads out retry attempts to prevent thundering herd
    # TODO: Make adaptive based on actual metrics (P95 latency, queue depth, etc.)
    base = 5
    jitter = :rand.uniform(5)
    base + jitter
  end

  defp serve_shape_response(%Conn{assigns: %{request: request}} = conn, _) do
    Api.serve_shape_response(conn, request)
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

  #
  ### Telemetry
  #

  # Below, OpentelemetryTelemetry does the heavy lifting of setting up the span context in the
  # current Elixir process to correctly attribute subsequent calls to OpenTelemetry.with_span()
  # in this module as descendants of the root span, as they are all invoked in the same process
  # unless a new process is spawned explicitly.

  # Start the root span for the shape request, serving as an ancestor for any subsequent
  # sub-span.
  defp start_telemetry_span(conn, _) do
    OpentelemetryTelemetry.start_telemetry_span(OpenTelemetry, "Plug_shape_get", %{}, %{})
    add_span_attrs_from_conn(conn)
    put_private(conn, :electric_telemetry_span, %{start_time: System.monotonic_time()})
  end

  # Assign root span attributes based on the latest state of Plug.Conn and end the root span.
  #
  # We want to have all the relevant HTTP and shape request attributes on the root span. This
  # is the place to assign them because we keep this plug last in the "plug pipeline" defined
  # in this module.
  defp end_telemetry_span(%Conn{assigns: assigns} = conn, _ \\ nil) do
    OpenTelemetry.execute(
      [:electric, :plug, :serve_shape],
      %{
        count: 1,
        bytes: assigns[:streaming_bytes_sent] || 0,
        monotonic_time: System.monotonic_time(),
        duration: System.monotonic_time() - conn.private[:electric_telemetry_span][:start_time]
      },
      %{
        live: get_live_mode(assigns),
        shape_handle: get_handle(assigns) || conn.query_params["handle"],
        client_ip: conn.remote_ip,
        status: conn.status,
        stack_id: get_in(conn.assigns, [:config, :stack_id])
      }
    )

    add_span_attrs_from_conn(conn)
    OpentelemetryTelemetry.end_telemetry_span(OpenTelemetry, %{})
    conn
  end

  defp get_handle(%{response: %{shape_handle: shape_handle}}), do: shape_handle
  defp get_handle(%{request: %{shape_handle: shape_handle}}), do: shape_handle
  defp get_handle(_), do: nil

  defp get_live_mode(%{response: %{params: %{live: live}}}), do: live
  defp get_live_mode(%{request: %{params: %{live: live}}}), do: live
  defp get_live_mode(_), do: false

  defp add_span_attrs_from_conn(conn) do
    conn
    |> open_telemetry_attrs()
    |> OpenTelemetry.add_span_attributes()
  end

  # This overrides Plug.Conn.halt/1 (which is deliberately "unimported" at the top of this
  # module) so that we can record the response status in the OpenTelemetry span for this
  # request.
  defp halt(conn) do
    conn
    |> end_telemetry_span()
    |> Plug.Conn.halt()
  end

  @impl Plug.ErrorHandler
  def handle_errors(conn, %{kind: :error, reason: exception, stack: stack})
      when is_exception(exception, DBConnection.ConnectionError) do
    OpenTelemetry.record_exception(:error, exception, stack)

    error_str = Exception.format(:error, exception)

    conn = fetch_query_params(conn)
    ensure_admission_control_release(conn)

    conn
    |> assign(:error_str, error_str)
    |> put_resp_header("retry-after", "10")
    |> put_resp_header("cache-control", "no-store")
    |> put_resp_header("surrogate-control", "no-store")
    |> send_resp(
      503,
      Jason.encode!(%{code: "database_unreachable", error: "Database is unreachable"})
    )
  end

  def handle_errors(conn, error) do
    OpenTelemetry.record_exception(error.kind, error.reason, error.stack)

    error_str = Exception.format(error.kind, error.reason)

    conn = fetch_query_params(conn)
    ensure_admission_control_release(conn)

    conn
    |> assign(:error_str, error_str)
    |> send_resp(conn.status, Jason.encode!(%{error: error_str}))

    # No end_telemetry_span() call here because by this point that stack of plugs has been
    # unwound to the point where the `conn` struct did not yet have any span-related properties
    # assigned to it.
  end

  defp ensure_admission_control_release(conn) do
    stack_id = get_in(conn.assigns, [:config, :stack_id])

    kind =
      if conn.query_params["offset"] == "-1",
        do: :initial,
        else: :existing

    Electric.AdmissionControl.release(stack_id, kind)
  end
end
