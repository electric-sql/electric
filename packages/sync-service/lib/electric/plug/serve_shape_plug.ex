defmodule Electric.Plug.ServeShapePlug do
  use Plug.Builder
  use Plug.ErrorHandler

  # The halt/1 function is redefined further down below
  import Plug.Conn, except: [halt: 1]

  alias OpenTelemetry.SemanticConventions, as: SC

  alias Electric.Shapes
  alias Electric.Schema
  alias Electric.Replication.LogOffset
  alias Electric.Telemetry.OpenTelemetry
  alias Plug.Conn

  require Logger
  require SC.Trace

  # Aliasing for pattern matching
  @before_all_offset LogOffset.before_all()

  # Control messages
  @up_to_date [Jason.encode!(%{headers: %{control: "up-to-date"}})]
  @must_refetch Jason.encode!([%{headers: %{control: "must-refetch"}}])

  defmodule Params do
    use Ecto.Schema
    import Ecto.Changeset
    alias Electric.Replication.LogOffset

    @primary_key false
    embedded_schema do
      field(:root_table, :string)
      field(:offset, :string)
      field(:shape_id, :string)
      field(:live, :boolean, default: false)
      field(:where, :string)
      field(:shape_definition, :string)
    end

    def validate(params, opts) do
      %__MODULE__{}
      |> cast(params, __schema__(:fields) -- [:shape_definition],
        message: fn _, _ -> "must be %{type}" end
      )
      |> validate_required([:root_table, :offset])
      |> cast_offset()
      |> validate_shape_id_with_offset()
      |> validate_live_with_offset()
      |> cast_root_table(opts)
      |> apply_action(:validate)
      |> case do
        {:ok, params} ->
          {:ok, Map.from_struct(params)}

        {:error, changeset} ->
          {:error,
           Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
             Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
               opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
             end)
           end)}
      end
    end

    def cast_offset(%Ecto.Changeset{valid?: false} = changeset), do: changeset

    def cast_offset(%Ecto.Changeset{} = changeset) do
      offset = fetch_change!(changeset, :offset)

      case LogOffset.from_string(offset) do
        {:ok, offset} ->
          put_change(changeset, :offset, offset)

        {:error, message} ->
          add_error(changeset, :offset, message)
      end
    end

    def validate_shape_id_with_offset(%Ecto.Changeset{valid?: false} = changeset), do: changeset

    def validate_shape_id_with_offset(%Ecto.Changeset{} = changeset) do
      offset = fetch_change!(changeset, :offset)

      if offset == LogOffset.before_all() do
        changeset
      else
        validate_required(changeset, [:shape_id], message: "can't be blank when offset != -1")
      end
    end

    def validate_live_with_offset(%Ecto.Changeset{valid?: false} = changeset), do: changeset

    def validate_live_with_offset(%Ecto.Changeset{} = changeset) do
      offset = fetch_change!(changeset, :offset)

      if offset != LogOffset.before_all() do
        changeset
      else
        validate_exclusion(changeset, :live, [true], message: "can't be true when offset == -1")
      end
    end

    def cast_root_table(%Ecto.Changeset{} = changeset, opts) do
      table = fetch_change!(changeset, :root_table)
      where = fetch_field!(changeset, :where)

      case Shapes.Shape.new(table, opts ++ [where: where]) do
        {:ok, result} ->
          put_change(changeset, :shape_definition, result)

        {:error, reasons} ->
          Enum.reduce(List.wrap(reasons), changeset, fn
            {message, keys}, changeset ->
              add_error(changeset, :root_table, message, keys)

            message, changeset when is_binary(message) ->
              add_error(changeset, :root_table, message)
          end)
      end
    end
  end

  plug :fetch_query_params

  # start_telemetry_span needs to always be the first plug after fetching query params.
  plug :start_telemetry_span

  plug :cors
  plug :put_resp_content_type, "application/json"
  plug :validate_query_params
  plug :load_shape_info
  plug :put_schema_header
  # We're starting listening as soon as possible to not miss stuff that was added since we've
  # asked for last offset
  plug :listen_for_new_changes
  plug :determine_log_chunk_offset
  plug :determine_up_to_date
  plug :generate_etag
  plug :validate_and_put_etag
  plug :put_resp_cache_headers
  plug :serve_log_or_snapshot

  # end_telemetry_span needs to always be the last plug here.
  plug :end_telemetry_span

  defp validate_query_params(%Conn{} = conn, _) do
    Logger.info("Query String: #{conn.query_string}")

    all_params =
      Map.merge(conn.query_params, conn.path_params)
      |> Map.update("live", "false", &(&1 != "false"))

    case Params.validate(all_params, inspector: conn.assigns.config[:inspector]) do
      {:ok, params} ->
        %{conn | assigns: Map.merge(conn.assigns, params)}

      {:error, error_map} ->
        conn
        |> send_resp(400, Jason.encode_to_iodata!(error_map))
        |> halt()
    end
  end

  defp load_shape_info(%Conn{} = conn, _) do
    OpenTelemetry.with_span("shape_get.plug.load_shape_info", [], fn ->
      shape_info = get_or_create_shape_id(conn.assigns)
      handle_shape_info(conn, shape_info)
    end)
  end

  # No shape_id is provided so we can get the existing one for this shape
  # or create a new shape if it does not yet exist
  defp get_or_create_shape_id(%{shape_definition: shape, config: config, shape_id: nil}) do
    Shapes.get_or_create_shape_id(config, shape)
  end

  # A shape ID is provided so we need to return the shape that matches the shape ID and the shape definition
  defp get_or_create_shape_id(%{shape_definition: shape, config: config}) do
    Shapes.get_shape(config, shape)
  end

  defp handle_shape_info(
         %Conn{assigns: %{shape_definition: shape, config: config, shape_id: shape_id}} = conn,
         nil
       ) do
    # There is no shape that matches the shape definition (because shape info is `nil`)
    if shape_id != nil && Shapes.has_shape?(config, shape_id) do
      # but there is a shape that matches the shape ID
      # thus the shape ID does not match the shape definition
      # and we return a 400 bad request status code
      conn
      |> send_resp(400, @must_refetch)
      |> halt()
    else
      # The shape ID does not exist or no longer exists
      # e.g. it may have been deleted.
      # Hence, create a new shape for this shape definition
      # and return a 409 with a redirect to the newly created shape.
      # (will be done by the recursive `handle_shape_info` call)
      shape_info = Shapes.get_or_create_shape_id(config, shape)
      handle_shape_info(conn, shape_info)
    end
  end

  defp handle_shape_info(
         %Conn{assigns: %{shape_id: shape_id}} = conn,
         {active_shape_id, last_offset}
       )
       when is_nil(shape_id) or shape_id == active_shape_id do
    # We found a shape that matches the shape definition
    # and the shape has the same ID as the shape ID provided by the user
    conn
    |> assign(:active_shape_id, active_shape_id)
    |> assign(:last_offset, last_offset)
    |> put_resp_header("electric-shape-id", active_shape_id)
  end

  defp handle_shape_info(
         %Conn{assigns: %{shape_id: shape_id, config: config}} = conn,
         {active_shape_id, _}
       ) do
    if Shapes.has_shape?(config, shape_id) do
      # The shape with the provided ID exists but does not match the shape definition
      # otherwise we would have found it and it would have matched the previous function clause
      IO.puts("400 - SHAPE ID NOT FOUND")

      conn
      |> send_resp(400, @must_refetch)
      |> halt()
    else
      # The requested shape_id is not found, returns 409 along with a location redirect for clients to
      # re-request the shape from scratch with the new shape id which acts as a consistent cache buster
      # e.g. GET /v1/shape/{root_table}?shape_id={new_shape_id}&offset=-1

      # TODO: discuss returning a 307 redirect rather than a 409, the client
      # will have to detect this and throw out old data
      conn
      |> put_resp_header("electric-shape-id", active_shape_id)
      |> put_resp_header(
        "location",
        "#{conn.request_path}?shape_id=#{active_shape_id}&offset=-1"
      )
      |> send_resp(409, @must_refetch)
      |> halt()
    end
  end

  defp schema(shape) do
    shape.table_info
    |> Map.fetch!(shape.root_table)
    |> Map.fetch!(:columns)
    |> Schema.from_column_info()
    |> Jason.encode!()
  end

  # Only adds schema header when not in live mode
  defp put_schema_header(conn, _) when not conn.assigns.live do
    shape = conn.assigns.shape_definition
    put_resp_header(conn, "electric-schema", schema(shape))
  end

  defp put_schema_header(conn, _), do: conn

  # If chunk offsets are available, use those instead of the latest available offset
  # to optimize for cache hits and response sizes
  defp determine_log_chunk_offset(%Conn{assigns: assigns} = conn, _) do
    %{config: config, active_shape_id: shape_id, offset: offset} = assigns

    chunk_end_offset =
      Shapes.get_chunk_end_log_offset(config, shape_id, offset) || assigns.last_offset

    conn
    |> assign(:chunk_end_offset, chunk_end_offset)
    |> put_resp_header("electric-chunk-last-offset", "#{chunk_end_offset}")
  end

  defp determine_up_to_date(
         %Conn{
           assigns: %{chunk_end_offset: chunk_end_offset, last_offset: last_offset}
         } = conn,
         _
       ) do
    if LogOffset.compare(chunk_end_offset, last_offset) == :lt do
      conn
      |> assign(:up_to_date, [])
      # header might have been added on first pass but no longer valid
      # if listening to live changes and an incomplete chunk is formed
      |> delete_resp_header("electric-chunk-up-to-date")
    else
      conn
      |> assign(:up_to_date, [@up_to_date])
      |> put_resp_header("electric-chunk-up-to-date", "")
    end
  end

  defp generate_etag(%Conn{} = conn, _) do
    %{
      offset: offset,
      active_shape_id: active_shape_id,
      chunk_end_offset: chunk_end_offset
    } = conn.assigns

    conn
    |> assign(
      :etag,
      "#{active_shape_id}:#{offset}:#{chunk_end_offset}"
    )
  end

  defp validate_and_put_etag(%Conn{} = conn, _) do
    if_none_match =
      get_req_header(conn, "if-none-match")
      |> Enum.flat_map(&String.split(&1, ","))
      |> Enum.map(&String.trim/1)
      |> Enum.map(&String.trim(&1, ~S|"|))

    cond do
      conn.assigns.etag in if_none_match ->
        conn
        |> send_resp(304, "")
        |> halt()

      not conn.assigns.live ->
        put_resp_header(conn, "etag", conn.assigns.etag)

      true ->
        conn
    end
  end

  defp put_resp_cache_headers(%Conn{assigns: %{config: config, live: live}} = conn, _) do
    if live do
      put_resp_header(
        conn,
        "cache-control",
        "max-age=5, stale-while-revalidate=5"
      )
    else
      put_resp_header(
        conn,
        "cache-control",
        "max-age=#{config[:max_age]}, stale-while-revalidate=#{config[:stale_age]}"
      )
    end
  end

  def cors(conn, _opts) do
    conn
    |> put_resp_header("access-control-allow-origin", "*")
    |> put_resp_header("access-control-expose-headers", "*")
    |> put_resp_header("access-control-allow-methods", "GET, POST, OPTIONS")
  end

  # If offset is -1, we're serving a snapshot
  defp serve_log_or_snapshot(%Conn{assigns: %{offset: @before_all_offset}} = conn, _) do
    OpenTelemetry.with_span("shape_get.plug.serve_snapshot", [], fn -> serve_snapshot(conn) end)
  end

  # Otherwise, serve log since that offset
  defp serve_log_or_snapshot(conn, _) do
    OpenTelemetry.with_span("shape_get.plug.serve_shape_log", [], fn -> serve_shape_log(conn) end)
  end

  defp serve_snapshot(
         %Conn{
           assigns: %{
             chunk_end_offset: chunk_end_offset,
             active_shape_id: shape_id,
             up_to_date: maybe_up_to_date
           }
         } = conn
       ) do
    case Shapes.get_snapshot(conn.assigns.config, shape_id) do
      {:ok, {offset, snapshot}} ->
        log =
          Shapes.get_log_stream(conn.assigns.config, shape_id,
            since: offset,
            up_to: chunk_end_offset
          )

        [snapshot, log, maybe_up_to_date]
        |> Stream.concat()
        |> to_json_stream()
        |> Stream.chunk_every(500)
        |> send_stream(conn, 200)

      {:error, reason} ->
        error_msg = "Could not serve a snapshot because of #{inspect(reason)}"

        Logger.warning(error_msg)
        OpenTelemetry.record_exception(error_msg)

        send_resp(
          conn,
          500,
          Jason.encode_to_iodata!(%{error: "Failed creating or fetching the snapshot"})
        )
    end
  end

  defp serve_shape_log(
         %Conn{
           assigns: %{
             offset: offset,
             chunk_end_offset: chunk_end_offset,
             active_shape_id: shape_id,
             up_to_date: maybe_up_to_date
           }
         } = conn
       ) do
    log =
      Shapes.get_log_stream(conn.assigns.config, shape_id,
        since: offset,
        up_to: chunk_end_offset
      )

    if Enum.take(log, 1) == [] and conn.assigns.live do
      conn
      |> assign(:ot_is_immediate_response, false)
      |> hold_until_change(shape_id)
    else
      [log, maybe_up_to_date]
      |> Stream.concat()
      |> to_json_stream()
      |> Stream.chunk_every(500)
      |> send_stream(conn, 200)
    end
  end

  @json_list_start "["
  @json_list_end "]"
  @json_item_separator ","
  defp to_json_stream(items) do
    Stream.concat([
      [@json_list_start],
      Stream.intersperse(items, @json_item_separator),
      [@json_list_end]
    ])
  end

  defp send_stream(stream, conn, status) do
    conn = send_chunked(conn, status)

    {conn, bytes_sent} =
      Enum.reduce_while(stream, {conn, 0}, fn chunk, {conn, bytes_sent} ->
        chunk_size = IO.iodata_length(chunk)

        OpenTelemetry.with_span("shape_get.plug.stream_chunk", [chunk_size: chunk_size], fn ->
          case chunk(conn, chunk) do
            {:ok, conn} ->
              {:cont, {conn, bytes_sent + chunk_size}}

            {:error, "closed"} ->
              error_str = "Connection closed unexpectedly while streaming response"
              conn = assign(conn, :error_str, error_str)
              {:halt, {conn, bytes_sent}}

            {:error, reason} ->
              error_str = "Error while streaming response: #{inspect(reason)}"
              Logger.error(error_str)
              conn = assign(conn, :error_str, error_str)
              {:halt, {conn, bytes_sent}}
          end
        end)
      end)

    assign(conn, :streaming_bytes_sent, bytes_sent)
  end

  defp listen_for_new_changes(%Conn{} = conn, _) when not conn.assigns.live, do: conn

  defp listen_for_new_changes(%Conn{assigns: assigns} = conn, _) do
    # Only start listening when we know there is a possibility that nothing is going to be returned
    if LogOffset.compare(assigns.offset, assigns.last_offset) != :lt do
      shape_id = assigns.shape_id

      ref = make_ref()
      registry = conn.assigns.config[:registry]
      Registry.register(registry, shape_id, ref)
      Logger.debug("Client #{inspect(self())} is registered for changes to #{shape_id}")

      assign(conn, :new_changes_ref, ref)
    else
      conn
    end
  end

  def hold_until_change(conn, shape_id) do
    long_poll_timeout = conn.assigns.config[:long_poll_timeout]
    Logger.debug("Client #{inspect(self())} is waiting for changes to #{shape_id}")
    ref = conn.assigns.new_changes_ref

    receive do
      {^ref, :new_changes, latest_log_offset} ->
        # Stream new log since currently "held" offset
        conn
        |> assign(:last_offset, latest_log_offset)
        |> assign(:chunk_end_offset, latest_log_offset)
        # update last offset header
        |> put_resp_header("electric-chunk-last-offset", "#{latest_log_offset}")
        |> determine_up_to_date([])
        |> serve_shape_log()

      {^ref, :shape_rotation} ->
        # We may want to notify the client better that the shape ID had changed, but just closing the response
        # and letting the client handle it on reconnection is good enough.
        conn
        |> assign(:ot_is_shape_rotated, true)
        |> assign(:ot_is_empty_response, true)
        |> send_resp(200, ["[", @up_to_date, "]"])
    after
      # If we timeout, return an empty body and 204 as there's no response body.
      long_poll_timeout ->
        conn
        |> assign(:ot_is_long_poll_timeout, true)
        |> assign(:ot_is_empty_response, true)
        |> send_resp(204, ["[", @up_to_date, "]"])
    end
  end

  defp open_telemetry_attrs(%Conn{assigns: assigns} = conn) do
    shape_id =
      if is_struct(conn.query_params, Plug.Conn.Unfetched) do
        assigns[:active_shape_id] || assigns[:shape_id]
      else
        conn.query_params["shape_id"] || assigns[:active_shape_id] || assigns[:shape_id]
      end

    query_params_map =
      if is_struct(conn.query_params, Plug.Conn.Unfetched) do
        %{}
      else
        Map.new(conn.query_params, fn {k, v} -> {"http.query_param.#{k}", v} end)
      end

    maybe_up_to_date = if up_to_date = assigns[:up_to_date], do: up_to_date != []

    %{
      "shape.id" => shape_id,
      "shape.where" => assigns[:where],
      "shape.root_table" => assigns[:root_table],
      "shape.definition" => assigns[:shape_definition],
      "shape_req.is_live" => assigns[:live],
      "shape_req.offset" => assigns[:offset],
      "shape_req.is_shape_rotated" => assigns[:ot_is_shape_rotated] || false,
      "shape_req.is_long_poll_timeout" => assigns[:ot_is_long_poll_timeout] || false,
      "shape_req.is_empty_response" => assigns[:ot_is_empty_response] || false,
      "shape_req.is_immediate_response" => assigns[:ot_is_immediate_response] || true,
      "shape_req.is_cached" => if(conn.status, do: conn.status == 304),
      "shape_req.is_error" => if(conn.status, do: conn.status >= 400),
      "shape_req.is_up_to_date" => maybe_up_to_date,
      "error.type" => assigns[:error_str],
      "http.request_id" => assigns[:plug_request_id],
      "http.query_string" => conn.query_string,
      SC.Trace.http_client_ip() => client_ip(conn),
      SC.Trace.http_scheme() => conn.scheme,
      SC.Trace.net_peer_name() => conn.host,
      SC.Trace.net_peer_port() => conn.port,
      SC.Trace.http_target() => conn.request_path,
      SC.Trace.http_method() => conn.method,
      SC.Trace.http_status_code() => conn.status,
      SC.Trace.http_response_content_length() => assigns[:streaming_bytes_sent],
      SC.Trace.net_transport() => :"IP.TCP",
      SC.Trace.http_user_agent() => user_agent(conn),
      SC.Trace.http_url() =>
        %URI{
          scheme: to_string(conn.scheme),
          host: conn.host,
          port: conn.port,
          path: conn.request_path,
          query: conn.query_string
        }
        |> to_string()
    }
    |> Map.filter(fn {_k, v} -> not is_nil(v) end)
    |> Map.merge(query_params_map)
    |> Map.merge(Map.new(conn.req_headers, fn {k, v} -> {"http.request.header.#{k}", v} end))
    |> Map.merge(Map.new(conn.resp_headers, fn {k, v} -> {"http.response.header.#{k}", v} end))
  end

  defp client_ip(%Conn{remote_ip: remote_ip} = conn) do
    case get_req_header(conn, "x-forwarded-for") do
      [] ->
        remote_ip
        |> :inet_parse.ntoa()
        |> to_string()

      [ip_address | _] ->
        ip_address
    end
  end

  defp user_agent(%Conn{} = conn) do
    case get_req_header(conn, "user-agent") do
      [] -> ""
      [head | _] -> head
    end
  end

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
    conn
  end

  # Assign root span attributes based on the latest state of Plug.Conn and end the root span.
  #
  # We want to have all the relevant HTTP and shape request attributes on the root span. This
  # is the place to assign them because we keep this plug last in the "plug pipeline" defined
  # in this module.
  defp end_telemetry_span(conn, _ \\ nil) do
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
    OpenTelemetry.record_exception(error.reason, error.stack)

    error_str = Exception.format(error.kind, error.reason)

    conn
    |> assign(:error_str, error_str)
    |> end_telemetry_span()

    conn
  end
end
