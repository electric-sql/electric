defmodule Electric.Plug.ServeShapePlug do
  require Logger
  alias Electric.Shapes
  alias Electric.Schema
  alias Electric.Replication.LogOffset
  alias Plug.Conn
  use Plug.Builder

  # Aliasing for pattern matching
  @before_all_offset LogOffset.before_all()

  # Control messages
  @up_to_date [Jason.encode!(%{headers: %{control: "up-to-date"}})]
  @must_refetch Jason.encode!([%{headers: %{control: "must-refetch"}}])
  @shape_mismatch "The provided shape ID does not match the shape definition."

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
  plug :cors
  plug :put_resp_content_type, "application/json"
  plug :validate_query_params
  plug :load_shape_info
  plug :put_schema_header

  # We're starting listening as soon as possible to not miss stuff that was added since we've asked for last offset
  plug :listen_for_new_changes
  plug :determine_log_chunk_offset
  plug :generate_etag
  plug :validate_and_put_etag
  plug :put_resp_cache_headers
  plug :serve_log_or_snapshot

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
    shape_info = get_or_create_shape_id(conn.assigns)
    handle_shape_info(conn, shape_info)
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

  defp handle_shape_info(%Conn{} = conn, nil) do
    # Shape not found, return 400 because the user came in with a shape ID
    # but there are no shapes matching the shape definition
    # so the shape ID cannot match the shape definition
    conn
    |> send_resp(400, @shape_mismatch)
    |> halt()
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
    |> put_resp_header("x-electric-shape-id", active_shape_id)
  end

  defp handle_shape_info(
         %Conn{assigns: %{shape_id: shape_id, config: config}} = conn,
         {active_shape_id, _}
       ) do
    if Shapes.has_shape?(config, shape_id) do
      # The shape with the provided ID exists but does not match the shape definition
      # otherwise we would have found it and it would have matched the previous function clause
      conn
      |> send_resp(400, @shape_mismatch)
      |> halt()
    else
      # The requested shape_id is not found, returns 409 along with a location redirect for clients to
      # re-request the shape from scratch with the new shape id which acts as a consistent cache buster
      # e.g. GET /v1/shape/{root_table}?shape_id={new_shape_id}&offset=-1

      # TODO: discuss returning a 307 redirect rather than a 409, the client
      # will have to detect this and throw out old data
      conn
      |> put_resp_header("x-electric-shape-id", active_shape_id)
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
    put_resp_header(conn, "x-electric-schema", schema(shape))
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
    |> put_resp_header("x-electric-chunk-last-offset", "#{chunk_end_offset}")
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

  defp put_resp_cache_headers(%Conn{} = conn, _) do
    if conn.assigns.live do
      put_resp_header(
        conn,
        "cache-control",
        "max-age=5, stale-while-revalidate=5"
      )
    else
      put_resp_header(
        conn,
        "cache-control",
        "max-age=#{conn.assigns.config[:max_age]}, stale-while-revalidate=#{conn.assigns.config[:stale_age]}"
      )
    end
  end

  def cors(conn, _opts) do
    conn
    |> Conn.put_resp_header("access-control-allow-origin", "*")
    |> Conn.put_resp_header("access-control-expose-headers", "*")
    |> Conn.put_resp_header("access-control-allow-methods", "GET, POST, OPTIONS")
  end

  # If offset is -1, we're serving a snapshot
  defp serve_log_or_snapshot(
         %Conn{
           assigns: %{
             offset: @before_all_offset,
             chunk_end_offset: chunk_end_offset,
             active_shape_id: shape_id
           }
         } = conn,
         _
       ) do
    case Shapes.get_snapshot(conn.assigns.config, shape_id) do
      {:ok, {offset, snapshot}} ->
        log =
          Shapes.get_log_stream(conn.assigns.config, shape_id,
            since: offset,
            up_to: chunk_end_offset
          )

        [snapshot, log, maybe_up_to_date(conn)]
        |> Stream.concat()
        |> to_json_stream()
        |> Stream.chunk_every(500)
        |> send_stream(conn, 200)

      {:error, reason} ->
        Logger.warning("Could not serve a snapshot because of #{inspect(reason)}")

        send_resp(
          conn,
          500,
          Jason.encode_to_iodata!(%{error: "Failed creating or fetching the snapshot"})
        )
    end
  end

  # Otherwise, serve log since that offset
  defp serve_log_or_snapshot(
         %Conn{
           assigns: %{
             offset: offset,
             chunk_end_offset: chunk_end_offset,
             active_shape_id: shape_id
           }
         } = conn,
         _
       ) do
    log =
      Shapes.get_log_stream(conn.assigns.config, shape_id, since: offset, up_to: chunk_end_offset)

    if Enum.take(log, 1) == [] and conn.assigns.live do
      hold_until_change(conn, shape_id)
    else
      [log, maybe_up_to_date(conn)]
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
    conn = Conn.send_chunked(conn, status)

    Enum.reduce_while(stream, conn, fn chunk, conn ->
      case Conn.chunk(conn, chunk) do
        {:ok, conn} ->
          {:cont, conn}

        {:error, "closed"} ->
          {:halt, conn}

        {:error, reason} ->
          Logger.error("Error while streaming response: #{inspect(reason)}")
          {:halt, conn}
      end
    end)
  end

  defp maybe_up_to_date(%Conn{
         assigns: %{chunk_end_offset: chunk_end_offset, last_offset: last_offset}
       }) do
    if LogOffset.compare(chunk_end_offset, last_offset) == :lt do
      []
    else
      [@up_to_date]
    end
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
        |> put_resp_header("x-electric-chunk-last-offset", "#{latest_log_offset}")
        |> serve_log_or_snapshot([])

      {^ref, :shape_rotation} ->
        # We may want to notify the client better that the shape ID had changed, but just closing the response
        # and letting the client handle it on reconnection is good enough.
        send_resp(conn, 200, ["[", @up_to_date, "]"])
    after
      # If we timeout, return an empty body and 204 as there's no response body.
      long_poll_timeout -> send_resp(conn, 204, ["[", @up_to_date, "]"])
    end
  end
end
