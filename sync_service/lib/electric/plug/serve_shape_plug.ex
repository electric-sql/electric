defmodule Electric.Plug.ServeShapePlug do
  require Logger
  alias Electric.Shapes
  use Plug.Builder

  defmodule Params do
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key false
    embedded_schema do
      field(:shape_definition, :string)
      field(:offset, :integer)
      field(:shape_id, :string)
      field(:live, :boolean, default: false)
    end

    def validate(params, opts) do
      %__MODULE__{}
      |> cast(params, __schema__(:fields), message: fn _, _ -> "must be %{type}" end)
      |> validate_number(:offset, greater_than_or_equal_to: -1)
      |> validate_required([:shape_definition, :offset])
      |> cast_shape_definition(:shape_definition, opts)
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

    def cast_shape_definition(%Ecto.Changeset{} = changeset, field, opts) do
      value = fetch_change!(changeset, field)

      case Shapes.Shape.from_string(value, opts) do
        {:ok, result} ->
          put_change(changeset, field, result)

        {:error, reasons} ->
          Enum.reduce(reasons, changeset, fn
            {message, keys}, changeset -> add_error(changeset, field, message, keys)
            message, changeset when is_binary(message) -> add_error(changeset, field, message)
          end)
      end
    end
  end

  plug :fetch_query_params
  plug :put_resp_content_type, "application/json"
  plug :validate_query_params
  plug :load_shape_info
  plug :validate_and_put_etag
  plug :put_resp_cache_headers
  plug :serve_log_or_snapshot

  defp validate_query_params(%Plug.Conn{} = conn, _) do
    all_params =
      Map.merge(conn.query_params, conn.path_params)
      |> Map.update("live", "false", &(&1 != "false"))

    case Params.validate(all_params, []) do
      {:ok, params} ->
        %{conn | assigns: Map.merge(conn.assigns, params)}

      {:error, error_map} ->
        conn
        |> send_resp(400, Jason.encode_to_iodata!(error_map))
        |> halt()
    end
  end

  defp load_shape_info(%Plug.Conn{} = conn, _) do
    {shape_id, last_offset} = Shapes.get_or_create_shape_id(conn.assigns.shape_definition)

    conn
    |> assign(:active_shape_id, shape_id)
    |> assign(:last_offset, last_offset)
    |> assign(:etag, "#{shape_id}:#{last_offset}")
    |> put_resp_header("x-electric-shape-id", shape_id)
  end

  defp validate_and_put_etag(%Plug.Conn{} = conn, _) do
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

  defp put_resp_cache_headers(%Plug.Conn{} = conn, _) do
    if conn.assigns.live do
      conn
      |> put_resp_header("cache-control", "no-store, no-cache, must-revalidate, max-age=0")
      |> put_resp_header("pragma", "no-cache")
      |> put_resp_header("expires", "0")
    else
      put_resp_header(conn, "cache-control", "max-age=60, stale-while-revalidate=300")
    end
  end

  @up_to_date [%{headers: %{control: "up-to-date"}}]

  # If offset is -1, we're serving a snapshot
  defp serve_log_or_snapshot(
         %Plug.Conn{assigns: %{offset: -1, active_shape_id: shape_id}} = conn,
         _
       ) do
    {offset, snapshot} =
      Shapes.get_snapshot(conn.assigns.config, shape_id, conn.assigns.shape_definition)

    log =
      Shapes.get_log_stream(conn.assigns.config, shape_id, since: offset)
      |> Enum.to_list()

    send_resp(conn, 200, Jason.encode_to_iodata!(snapshot ++ log ++ @up_to_date))
  end

  # Otherwise, serve log since that offset
  defp serve_log_or_snapshot(
         %Plug.Conn{assigns: %{offset: offset, active_shape_id: shape_id}} = conn,
         _
       ) do
    log = Shapes.get_log_stream(conn.assigns.config, shape_id, since: offset) |> Enum.to_list()

    if log == [] and conn.assigns.live do
      hold_until_change(conn, shape_id)
    else
      send_resp(conn, 200, Jason.encode_to_iodata!(log ++ @up_to_date))
    end
  end

  def hold_until_change(conn, shape_id) do
    Logger.debug("Client is waiting for changes to #{shape_id}")
    registry = conn.assigns.config[:registry]
    ref = make_ref()
    Registry.register(registry, shape_id, ref)

    receive do
      {^ref, :new_changes, _new_lsn} ->
        # Stream new log since currently "held" offset
        serve_log_or_snapshot(assign(conn, :live, false), [])

      {^ref, :shape_rotation} ->
        # We may want to notify the client better that the shape ID had changed, but just closing the response
        # and letting the client handle it on reconnection is good enough.
        send_resp(conn, 200, Jason.encode_to_iodata!(@up_to_date))
    after
      5000 -> send_resp(conn, 200, Jason.encode_to_iodata!(@up_to_date))
    end
  end
end
