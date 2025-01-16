defmodule Electric.Plug.ServeShapePlug do
  use Plug.Builder, copy_opts_to_assign: :config
  use Plug.ErrorHandler

  # The halt/1 function is redefined further down below
  import Plug.Conn, except: [halt: 1]
  import Electric.Replication.LogOffset, only: [is_log_offset_lt: 2]

  alias Electric.Plug.Utils
  import Electric.Plug.Utils, only: [hold_conn_until_stack_ready: 2]
  alias Electric.Shapes
  alias Electric.Schema
  alias Electric.Replication.LogOffset
  alias Electric.Telemetry.OpenTelemetry
  alias Plug.Conn

  require Logger

  # Aliasing for pattern matching
  @before_all_offset LogOffset.before_all()

  # Control messages
  @up_to_date [Jason.encode!(%{headers: %{control: "up-to-date"}})]
  @must_refetch Jason.encode!([%{headers: %{control: "must-refetch"}}])
  @shape_definition_mismatch Jason.encode!(%{
                               message:
                                 "The specified shape definition and handle do not match. " <>
                                   "Please ensure the shape definition is correct or omit the shape handle from the request to obtain a new one."
                             })
  @offset_out_of_bounds Jason.encode!(%{
                          offset: ["out of bounds for this shape"]
                        })

  defmodule Params do
    use Ecto.Schema
    import Ecto.Changeset
    alias Electric.Replication.LogOffset

    @primary_key false
    embedded_schema do
      field(:table, :string)
      field(:offset, :string)
      field(:handle, :string)
      field(:live, :boolean, default: false)
      field(:where, :string)
      field(:columns, :string)
      field(:shape_definition, :string)
      field(:replica, Ecto.Enum, values: [:default, :full], default: :default)
    end

    def validate(params, opts) do
      %__MODULE__{}
      |> cast(params, __schema__(:fields) -- [:shape_definition],
        message: fn _, _ -> "must be %{type}" end
      )
      |> validate_required([:table, :offset])
      |> cast_offset()
      |> cast_columns()
      |> validate_handle_with_offset()
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

    def cast_columns(%Ecto.Changeset{valid?: false} = changeset), do: changeset

    def cast_columns(%Ecto.Changeset{} = changeset) do
      case fetch_field!(changeset, :columns) do
        nil ->
          changeset

        columns ->
          case Electric.Plug.Utils.parse_columns_param(columns) do
            {:ok, parsed_cols} -> put_change(changeset, :columns, parsed_cols)
            {:error, reason} -> add_error(changeset, :columns, reason)
          end
      end
    end

    def validate_handle_with_offset(%Ecto.Changeset{valid?: false} = changeset),
      do: changeset

    def validate_handle_with_offset(%Ecto.Changeset{} = changeset) do
      offset = fetch_change!(changeset, :offset)

      if offset == LogOffset.before_all() do
        changeset
      else
        validate_required(changeset, [:handle], message: "can't be blank when offset != -1")
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

    def cast_root_table(%Ecto.Changeset{valid?: false} = changeset, _), do: changeset

    def cast_root_table(%Ecto.Changeset{} = changeset, opts) do
      table = fetch_change!(changeset, :table)
      where = fetch_field!(changeset, :where)
      columns = get_change(changeset, :columns, nil)
      replica = fetch_field!(changeset, :replica)

      case Shapes.Shape.new(
             table,
             opts ++ [where: where, columns: columns, replica: replica]
           ) do
        {:ok, result} ->
          put_change(changeset, :shape_definition, result)

        {:error, {field, reasons}} ->
          Enum.reduce(List.wrap(reasons), changeset, fn
            {message, keys}, changeset ->
              add_error(changeset, field, message, keys)

            message, changeset when is_binary(message) ->
              add_error(changeset, field, message)
          end)
      end
    end
  end

  plug :fetch_query_params

  # start_telemetry_span needs to always be the first plug after fetching query params.
  plug :start_telemetry_span
  plug :put_resp_content_type, "application/json"
  plug :hold_conn_until_stack_ready

  plug :validate_query_params
  plug :load_shape_info
  plug :put_schema_header
  # We're starting listening as soon as possible to not miss stuff that was added since we've
  # asked for last offset
  plug :listen_for_new_changes
  plug :determine_log_chunk_offset
  plug :determine_up_to_date
  plug :put_resp_cache_headers
  plug :generate_etag
  plug :validate_and_put_etag
  plug :serve_shape_log

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

  defp load_shape_info(%Conn{assigns: %{config: config}} = conn, _) do
    OpenTelemetry.with_span("shape_get.plug.load_shape_info", [], config[:stack_id], fn ->
      shape_info = get_or_create_shape_handle(conn.assigns)
      handle_shape_info(conn, shape_info)
    end)
  end

  # No handle is provided so we can get the existing one for this shape
  # or create a new shape if it does not yet exist
  defp get_or_create_shape_handle(%{shape_definition: shape, config: config, handle: nil}) do
    Shapes.get_or_create_shape_handle(config, shape)
  end

  # A shape handle is provided so we need to return the shape that matches the shape handle and the shape definition
  defp get_or_create_shape_handle(%{shape_definition: shape, config: config}) do
    Shapes.get_shape(config, shape)
  end

  defp handle_shape_info(
         %Conn{assigns: %{shape_definition: shape, config: config, handle: shape_handle}} =
           conn,
         nil
       ) do
    # There is no shape that matches the shape definition (because shape info is `nil`)
    if shape_handle != nil && Shapes.has_shape?(config, shape_handle) do
      # but there is a shape that matches the shape handle
      # thus the shape handle does not match the shape definition
      # and we return a 400 bad request status code
      conn
      |> send_resp(400, @shape_definition_mismatch)
      |> halt()
    else
      # The shape handle does not exist or no longer exists
      # e.g. it may have been deleted.
      # Hence, create a new shape for this shape definition
      # and return a 409 with a redirect to the newly created shape.
      # (will be done by the recursive `handle_shape_info` call)
      shape_info = Shapes.get_or_create_shape_handle(config, shape)
      handle_shape_info(conn, shape_info)
    end
  end

  defp handle_shape_info(
         %Conn{assigns: %{handle: shape_handle, offset: offset}} = conn,
         {active_shape_handle, last_offset}
       )
       when (is_nil(shape_handle) or shape_handle == active_shape_handle) and
              is_log_offset_lt(last_offset, offset) do
    # We found a shape that matches the shape definition
    # and the shape has the same ID as the shape handle provided by the user
    # but the provided offset is wrong as it is greater than the last offset for this shape
    conn
    |> send_resp(400, @offset_out_of_bounds)
    |> halt()
  end

  defp handle_shape_info(
         %Conn{assigns: %{handle: shape_handle}} = conn,
         {active_shape_handle, last_offset}
       )
       when is_nil(shape_handle) or shape_handle == active_shape_handle do
    # We found a shape that matches the shape definition
    # and the shape has the same ID as the shape handle provided by the user
    conn
    |> assign(:active_shape_handle, active_shape_handle)
    |> assign(:last_offset, last_offset)
    |> put_resp_header("electric-handle", active_shape_handle)
  end

  defp handle_shape_info(
         %Conn{assigns: %{config: config, handle: shape_handle, table: table}} = conn,
         {active_shape_handle, _}
       ) do
    if Shapes.has_shape?(config, shape_handle) do
      # The shape with the provided ID exists but does not match the shape definition
      # otherwise we would have found it and it would have matched the previous function clause
      conn
      |> send_resp(400, @shape_definition_mismatch)
      |> halt()
    else
      # The requested shape_handle is not found, returns 409 along with a location redirect for clients to
      # re-request the shape from scratch with the new shape id which acts as a consistent cache buster
      # e.g. GET /v1/shape?table={root_table}&handle={new_shape_handle}&offset=-1

      # TODO: discuss returning a 307 redirect rather than a 409, the client
      # will have to detect this and throw out old data
      conn
      |> put_resp_header("electric-handle", active_shape_handle)
      |> put_resp_header(
        "location",
        "#{conn.request_path}?table=#{table}&handle=#{active_shape_handle}&offset=-1"
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
    %{config: config, active_shape_handle: shape_handle, offset: offset} =
      assigns

    chunk_end_offset =
      Shapes.get_chunk_end_log_offset(config, shape_handle, offset) ||
        assigns.last_offset

    conn
    |> assign(:chunk_end_offset, chunk_end_offset)
    |> put_resp_header("electric-offset", "#{chunk_end_offset}")
  end

  defp determine_up_to_date(
         %Conn{
           assigns: %{
             offset: offset,
             chunk_end_offset: chunk_end_offset,
             last_offset: last_offset
           }
         } = conn,
         _
       ) do
    # The log can't be up to date if the last_offset is not the actual end.
    # Also if client is requesting the start of the log, we don't set `up-to-date`
    # here either as we want to set a long max-age on the cache-control.
    if LogOffset.compare(chunk_end_offset, last_offset) == :lt or
         offset == @before_all_offset do
      conn
      |> assign(:up_to_date, [])
      # header might have been added on first pass but no longer valid
      # if listening to live changes and an incomplete chunk is formed
      |> delete_resp_header("electric-up-to-date")
    else
      conn
      |> assign(:up_to_date, [@up_to_date])
      |> put_resp_header("electric-up-to-date", "")
    end
  end

  defp generate_etag(%Conn{} = conn, _) do
    %{
      offset: offset,
      active_shape_handle: active_shape_handle,
      chunk_end_offset: chunk_end_offset
    } = conn.assigns

    conn
    |> assign(
      :etag,
      "#{active_shape_handle}:#{offset}:#{chunk_end_offset}"
    )
  end

  defp validate_and_put_etag(%Conn{} = conn, _) do
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

      not conn.assigns.live ->
        put_resp_header(conn, "etag", conn.assigns.etag)

      true ->
        conn
    end
  end

  # If the offset is -1, set a 1 week max-age, 1 hour s-maxage (shared cache) and 1 month stale-while-revalidate
  # We want private caches to cache the initial offset for a long time but for shared caches to frequently revalidate
  # so they're serving a fairly fresh copy of the initials shape log.
  defp put_resp_cache_headers(%Conn{assigns: %{offset: @before_all_offset}} = conn, _),
    do:
      conn
      |> put_resp_header(
        "cache-control",
        "public, max-age=604800, s-maxage=3600, stale-while-revalidate=2629746"
      )

  # For live requests we want short cache lifetimes and to update the live cursor
  defp put_resp_cache_headers(%Conn{assigns: %{live: true}} = conn, _),
    do:
      conn
      |> put_resp_header(
        "cache-control",
        "public, max-age=5, stale-while-revalidate=5"
      )
      |> put_resp_header(
        "electric-cursor",
        conn.assigns.config[:long_poll_timeout]
        |> Utils.get_next_interval_timestamp(conn.query_params["cursor"])
        |> Integer.to_string()
      )

  # For all other requests use the configured cache lifetimes
  defp put_resp_cache_headers(%Conn{assigns: %{config: config, live: false}} = conn, _),
    do:
      conn
      |> put_resp_header(
        "cache-control",
        "public, max-age=#{config[:max_age]}, stale-while-revalidate=#{config[:stale_age]}"
      )

  defp serve_shape_log(%Conn{assigns: %{config: config}} = conn, _) do
    OpenTelemetry.with_span("shape_get.plug.serve_shape_log", [], config[:stack_id], fn ->
      do_serve_shape_log(conn)
    end)
  end

  defp do_serve_shape_log(
         %Conn{
           assigns: %{
             offset: offset,
             chunk_end_offset: chunk_end_offset,
             active_shape_handle: shape_handle,
             up_to_date: maybe_up_to_date
           }
         } = conn
       ) do
    log =
      Shapes.get_merged_log_stream(conn.assigns.config, shape_handle,
        since: offset,
        up_to: chunk_end_offset
      )

    if Enum.take(log, 1) == [] and conn.assigns.live do
      conn
      |> assign(:ot_is_immediate_response, false)
      |> hold_until_change(shape_handle)
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
    stack_id = conn.assigns.config[:stack_id]
    conn = send_chunked(conn, status)

    {conn, bytes_sent} =
      Enum.reduce_while(stream, {conn, 0}, fn chunk, {conn, bytes_sent} ->
        chunk_size = IO.iodata_length(chunk)

        OpenTelemetry.with_span(
          "shape_get.plug.stream_chunk",
          [chunk_size: chunk_size],
          stack_id,
          fn ->
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
          end
        )
      end)

    assign(conn, :streaming_bytes_sent, bytes_sent)
  end

  defp listen_for_new_changes(%Conn{} = conn, _) when not conn.assigns.live, do: conn

  defp listen_for_new_changes(%Conn{assigns: assigns} = conn, _) do
    # Only start listening when we know there is a possibility that nothing is going to be returned
    # There is an edge case in that the snapshot is served in chunks but `last_offset` is not updated
    # by that process. In that case, we'll start listening for changes but not receive any updates.
    if LogOffset.compare(assigns.offset, assigns.last_offset) != :lt or
         assigns.last_offset == LogOffset.last_before_real_offsets() do
      shape_handle = assigns.handle

      ref = make_ref()
      registry = conn.assigns.config[:registry]
      Registry.register(registry, shape_handle, ref)

      Logger.debug("Client #{inspect(self())} is registered for changes to #{shape_handle}")

      assign(conn, :new_changes_ref, ref)
    else
      conn
    end
  end

  def hold_until_change(conn, shape_handle) do
    long_poll_timeout = conn.assigns.config[:long_poll_timeout]
    Logger.debug("Client #{inspect(self())} is waiting for changes to #{shape_handle}")
    ref = conn.assigns.new_changes_ref

    receive do
      {^ref, :new_changes, latest_log_offset} ->
        # Stream new log since currently "held" offset
        conn
        |> assign(:last_offset, latest_log_offset)
        |> assign(:chunk_end_offset, latest_log_offset)
        # update last offset header
        |> put_resp_header("electric-offset", "#{latest_log_offset}")
        |> determine_up_to_date([])
        |> do_serve_shape_log()

      {^ref, :shape_rotation} ->
        # We may want to notify the client better that the shape handle had changed, but just closing the response
        # and letting the client handle it on reconnection is good enough.
        conn
        |> assign(:ot_is_shape_rotated, true)
        |> assign(:ot_is_empty_response, true)
        |> send_resp(204, ["[", @up_to_date, "]"])
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
    shape_handle =
      conn.query_params["handle"] || assigns[:active_shape_handle] || assigns[:handle]

    maybe_up_to_date = if up_to_date = assigns[:up_to_date], do: up_to_date != []

    Electric.Telemetry.OpenTelemetry.get_stack_span_attrs(
      get_in(conn.assigns, [:config, :stack_id])
    )
    |> Map.merge(Electric.Plug.Utils.common_open_telemetry_attrs(conn))
    |> Map.merge(%{
      "shape.handle" => shape_handle,
      "shape.where" => assigns[:where],
      "shape.root_table" => assigns[:table],
      "shape.definition" => assigns[:shape_definition],
      "shape.replica" => assigns[:replica],
      "shape_req.is_live" => assigns[:live],
      "shape_req.offset" => assigns[:offset],
      "shape_req.is_shape_rotated" => assigns[:ot_is_shape_rotated] || false,
      "shape_req.is_long_poll_timeout" => assigns[:ot_is_long_poll_timeout] || false,
      "shape_req.is_empty_response" => assigns[:ot_is_empty_response] || false,
      "shape_req.is_immediate_response" => assigns[:ot_is_immediate_response] || true,
      "shape_req.is_cached" => if(conn.status, do: conn.status == 304),
      "shape_req.is_error" => if(conn.status, do: conn.status >= 400),
      "shape_req.is_up_to_date" => maybe_up_to_date
    })
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
  defp end_telemetry_span(%Conn{assigns: assigns} = conn, _ \\ nil) do
    :telemetry.execute(
      [:electric, :plug, :serve_shape],
      %{
        count: 1,
        bytes: assigns[:streaming_bytes_sent] || 0,
        monotonic_time: System.monotonic_time()
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
    OpenTelemetry.record_exception(error.kind, error.reason, error.stack)

    error_str = Exception.format(error.kind, error.reason)

    conn
    |> fetch_query_params()
    |> assign(:error_str, error_str)
    |> end_telemetry_span()

    conn
  end
end
