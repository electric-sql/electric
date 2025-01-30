defmodule Electric.Plug.ServeShapePlug do
  use Plug.Builder, copy_opts_to_assign: :config
  use Plug.ErrorHandler

  # The halt/1 function is redefined further down below
  import Plug.Conn, except: [halt: 1]

  alias Electric.Plug.Utils
  alias Electric.Shapes.Request
  alias Electric.Shapes.Response
  alias Electric.Schema
  alias Electric.Replication.LogOffset
  alias Electric.Telemetry.OpenTelemetry
  alias Plug.Conn

  require Logger

  defguardp is_live_request(conn) when conn.assigns.request.params.live

  # Aliasing for pattern matching
  @before_all_offset LogOffset.before_all()

  plug :fetch_query_params

  # start_telemetry_span needs to always be the first plug after fetching query params.
  plug :start_telemetry_span
  plug :put_resp_content_type, "application/json"

  plug :validate_request
  plug :put_schema_header
  plug :put_resp_cache_headers
  plug :generate_etag
  plug :validate_and_put_etag
  plug :serve_shape_log

  # end_telemetry_span needs to always be the last plug here.
  plug :end_telemetry_span

  defp validate_request(%Conn{assigns: %{config: config}} = conn, _) do
    Logger.info("Query String: #{conn.query_string}")
    request = Access.fetch!(config, :request)

    all_params =
      Map.merge(conn.query_params, conn.path_params)
      |> Map.update("live", "false", &(&1 != "false"))

    case Request.validate(request, all_params) do
      {:ok, request} ->
        assign(conn, :request, request)

      {:error, response} ->
        conn
        |> Response.send(response)
        |> halt()
    end
  end

  defp schema(shape) do
    shape.table_info
    |> Map.fetch!(shape.root_table)
    |> Map.fetch!(:columns)
    |> Schema.from_column_info(shape.selected_columns)
    |> Jason.encode!()
  end

  # Only adds schema header when not in live mode
  defp put_schema_header(conn, _) when not is_live_request(conn) do
    %{assigns: %{request: request}} = conn
    shape = request.params.shape_definition
    put_resp_header(conn, "electric-schema", schema(shape))
  end

  defp put_schema_header(conn, _), do: conn

  defp generate_etag(%Conn{} = conn, _) do
    %{assigns: %{request: request}} = conn

    %{
      handle: active_shape_handle,
      offset: chunk_end_offset
    } = request.response

    conn
    |> assign(
      :etag,
      "#{active_shape_handle}:#{request.params.offset}:#{chunk_end_offset}"
    )
  end

  defp validate_and_put_etag(%Conn{} = conn, _) do
    %{assigns: %{request: request}} = conn

    if_none_match =
      get_req_header(conn, "if-none-match")
      |> Enum.flat_map(&String.split(&1, ","))
      |> Enum.map(&String.trim/1)
      |> Enum.map(&String.trim(&1, <<?">>))

    cond do
      conn.assigns.etag in if_none_match ->
        conn
        |> send_resp(304, "")
        |> halt()

      not request.params.live ->
        put_resp_header(conn, "etag", conn.assigns.etag)

      true ->
        conn
    end
  end

  defp put_resp_cache_headers(%Conn{} = conn, _) do
    %{assigns: %{request: request}} = conn

    case request do
      # If the offset is -1, set a 1 week max-age, 1 hour s-maxage (shared cache)
      # and 1 month stale-while-revalidate We want private caches to cache the
      # initial offset for a long time but for shared caches to frequently
      # revalidate so they're serving a fairly fresh copy of the initials shape
      # log.
      %{params: %{offset: @before_all_offset}} ->
        conn
        |> put_resp_header(
          "cache-control",
          "public, max-age=604800, s-maxage=3600, stale-while-revalidate=2629746"
        )

      # For live requests we want short cache lifetimes and to update the live cursor
      %{params: %{live: true}, config: config} ->
        conn
        |> put_resp_header(
          "cache-control",
          "public, max-age=5, stale-while-revalidate=5"
        )
        |> put_resp_header(
          "electric-cursor",
          config.long_poll_timeout
          |> Utils.get_next_interval_timestamp(conn.query_params["cursor"])
          |> Integer.to_string()
        )

      %{params: %{live: false}, config: config} ->
        conn
        |> put_resp_header(
          "cache-control",
          "public, max-age=#{config.max_age}, stale-while-revalidate=#{config.stale_age}"
        )
    end
  end

  defp serve_shape_log(%Conn{assigns: %{request: request}} = conn, _) do
    response = Request.serve_shape_log(request)

    conn
    |> assign(:response, response)
    |> Response.send(response)
  end

  defp open_telemetry_attrs(%Conn{assigns: assigns} = conn) do
    request = Map.get(assigns, :request, %{}) |> bare_map()
    params = Map.get(request, :params, %{}) |> bare_map()
    response = (Map.get(assigns, :response) || Map.get(request, :response) || %{}) |> bare_map()
    attrs = Map.get(response, :trace_attrs, %{})

    shape_handle =
      conn.query_params["handle"] || params[:handle] || request[:handle]

    maybe_up_to_date = Map.get(response, :up_to_date, false)

    Electric.Telemetry.OpenTelemetry.get_stack_span_attrs(
      get_in(conn.assigns, [:config, :stack_id])
    )
    |> Map.merge(Electric.Plug.Utils.common_open_telemetry_attrs(conn))
    |> Map.merge(%{
      "shape.handle" => shape_handle,
      "shape.where" => get_in(params, [:shape, :where]),
      "shape.root_table" => get_in(params, [:shape, :root_table]),
      "shape.definition" => get_in(params, [:shape]),
      "shape.replica" => get_in(params, [:shape, :replica]),
      "shape_req.is_live" => params[:live],
      "shape_req.offset" => params[:offset],
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
    :telemetry.execute(
      [:electric, :plug, :serve_shape],
      %{
        count: 1,
        bytes: assigns[:streaming_bytes_sent] || 0,
        monotonic_time: System.monotonic_time(),
        duration: System.monotonic_time() - conn.private[:electric_telemetry_span][:start_time]
      },
      %{
        live: assigns[:live],
        shape_handle:
          conn.query_params["handle"] || assigns[:active_shape_handle] || assigns[:handle],
        client_ip: conn.remote_ip,
        status: conn.status,
        stack_id: get_in(conn.assigns, [:config, :stack_id])
      }
    )

    add_span_attrs_from_conn(conn)
    OpentelemetryTelemetry.end_telemetry_span(OpenTelemetry, %{})
    conn
  end

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
  def handle_errors(conn, error) do
    dbg(error)
    OpenTelemetry.record_exception(error.kind, error.reason, error.stack)

    error_str = Exception.format(error.kind, error.reason)

    conn
    |> fetch_query_params()
    |> assign(:error_str, error_str)

    # |> end_telemetry_span()

    conn
  end
end
