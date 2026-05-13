defmodule Electric.Plug.MetadataSnapshotPlug do
  @moduledoc """
  Plug to create a comprehensive snapshot of the source's metadata for debugging purposes.

  Returns a JSON object containing:

  ## Global Metadata
  - `database`: Current PostgreSQL snapshot information
    - `xmin`: Oldest visible transaction ID
    - `xmax`: Next transaction ID to be assigned
    - `xip_list`: List of in-progress transaction IDs
    - `lsn`: Current WAL log sequence number (as string)
  - `status`: Service connection status
  - `shape_count`: Total number of active shapes

  ## Per-Shape Metadata (in `shapes` array)
  - `handle`: Unique shape identifier
  - `definition`: Shape definition including table, where clause, columns
  - `status`: Shape status (snapshot_started, snapshot_completed)
  - `latest_offset`: Current log offset for this shape
  - `pg_snapshot`: PostgreSQL snapshot at shape creation time (if available)
  """

  use Plug.Builder

  alias Plug.Conn
  alias Electric.Connection.Manager
  alias Electric.Postgres.Lsn
  alias Electric.ShapeCache
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.StatusMonitor
  alias Electric.Replication.LogOffset

  plug :fetch_query_params
  plug :get_snapshot_metadata
  plug :put_resp_content_type, "application/json"
  plug :put_cache_headers
  plug :send_response

  defp get_snapshot_metadata(%Conn{assigns: %{config: config}} = conn, _) do
    stack_id = config[:stack_id]

    try do
      metadata = build_metadata(stack_id)

      conn
      |> assign(:metadata, metadata)
      |> assign(:status_code, 200)
    rescue
      e ->
        conn
        |> assign(:error, %{message: "Failed to get metadata snapshot: #{Exception.message(e)}"})
        |> assign(:status_code, 500)
    catch
      :exit, {_, {DBConnection.Holder, :checkout, _}} ->
        conn
        |> assign(:error, %{message: "Database connection not available"})
        |> assign(:status_code, 503)
    end
  end

  defp build_metadata(stack_id) do
    # Get global database snapshot
    database_info = get_database_snapshot(stack_id)

    # Get service status
    status = get_service_status(stack_id)

    # Get shape count
    shape_count = get_shape_count(stack_id)

    # Get per-shape metadata
    shapes = get_shapes_metadata(stack_id)

    %{
      database: database_info,
      status: status,
      shape_count: shape_count,
      shapes: shapes
    }
  end

  defp get_database_snapshot(stack_id) do
    pool = Manager.snapshot_pool(stack_id)

    result =
      Postgrex.transaction(
        pool,
        fn pg_conn ->
          Postgrex.query!(
            pg_conn,
            "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
            []
          )

          Postgrex.query!(pg_conn, "SELECT pg_current_snapshot(), pg_current_wal_lsn()", [])
        end,
        timeout: 30_000
      )

    case result do
      {:ok, %Postgrex.Result{rows: [[{xmin, xmax, xip_list}, lsn]]}} ->
        %{
          xmin: xmin,
          xmax: xmax,
          xip_list: xip_list,
          lsn: to_string(Lsn.to_integer(lsn))
        }

      {:error, _error} ->
        nil
    end
  end

  defp get_service_status(stack_id) do
    case StatusMonitor.status(stack_id) do
      %{conn: conn_status, shape: shape_status} ->
        %{
          connection: to_string(conn_status),
          shape: to_string(shape_status)
        }

      _ ->
        %{connection: "unknown", shape: "unknown"}
    end
  end

  defp get_shape_count(stack_id) do
    case ShapeCache.count_shapes(stack_id) do
      count when is_integer(count) -> count
      _ -> 0
    end
  end

  defp get_shapes_metadata(stack_id) do
    case ShapeCache.list_shapes(stack_id) do
      shapes when is_list(shapes) ->
        storage = Storage.for_stack(stack_id)

        Enum.map(shapes, fn {handle, shape} ->
          build_shape_metadata(stack_id, handle, shape, storage)
        end)

      _ ->
        []
    end
  end

  defp build_shape_metadata(stack_id, handle, shape, storage) do
    shape_storage = Storage.for_shape(handle, storage)

    # Get shape status
    snapshot_started = ShapeStatus.snapshot_started?(stack_id, handle)
    snapshot_completed = ShapeStatus.snapshot_complete?(stack_id, handle)

    # Get latest offset
    latest_offset =
      case Storage.fetch_latest_offset(shape_storage) do
        {:ok, %LogOffset{} = offset} -> LogOffset.to_iolist(offset) |> IO.iodata_to_binary()
        {:ok, offset} when is_binary(offset) -> offset
        _ -> nil
      end

    # Get pg_snapshot for the shape
    pg_snapshot =
      case Storage.fetch_pg_snapshot(shape_storage) do
        {:ok, %{xmin: xmin, xmax: xmax, xip_list: xip_list}} ->
          %{xmin: xmin, xmax: xmax, xip_list: xip_list}

        _ ->
          nil
      end

    %{
      handle: handle,
      definition: serialize_shape_definition(shape),
      status: %{
        snapshot_started: snapshot_started,
        snapshot_completed: snapshot_completed
      },
      latest_offset: latest_offset,
      pg_snapshot: pg_snapshot
    }
  end

  defp serialize_shape_definition(shape) do
    {schema, table} = shape.root_table

    base = %{
      table: "#{schema}.#{table}",
      root_table_id: shape.root_table_id,
      primary_key: shape.root_pk,
      replica: to_string(shape.replica),
      log_mode: to_string(shape.log_mode)
    }

    # Add selected columns if not all columns
    base =
      if shape.selected_columns && shape.selected_columns != [] do
        Map.put(base, :columns, shape.selected_columns)
      else
        base
      end

    # Add where clause if present
    base =
      if shape.where && shape.where != nil do
        where_str = serialize_where_clause(shape.where)

        if where_str do
          Map.put(base, :where, where_str)
        else
          base
        end
      else
        base
      end

    # Add flags if any are set
    base =
      if shape.flags && map_size(shape.flags) > 0 do
        Map.put(base, :flags, shape.flags)
      else
        base
      end

    # Add storage config
    base =
      if shape.storage do
        Map.put(base, :storage, shape.storage)
      else
        base
      end

    # Add dependency handles if any
    base =
      if shape.shape_dependencies_handles && shape.shape_dependencies_handles != [] do
        Map.put(base, :dependency_handles, shape.shape_dependencies_handles)
      else
        base
      end

    base
  end

  defp serialize_where_clause(nil), do: nil
  defp serialize_where_clause(%{query: query}) when is_binary(query), do: query

  defp serialize_where_clause(where) do
    # Try to get a string representation of the where clause
    try do
      if is_struct(where) and Map.has_key?(where, :query) do
        where.query
      else
        inspect(where)
      end
    rescue
      _ -> nil
    end
  end

  defp put_cache_headers(conn, _) do
    put_resp_header(conn, "cache-control", "no-cache, no-store, must-revalidate")
  end

  defp send_response(%Conn{assigns: %{metadata: metadata, status_code: status_code}} = conn, _) do
    send_resp(conn, status_code, Jason.encode!(metadata))
  end

  defp send_response(%Conn{assigns: %{error: error, status_code: status_code}} = conn, _) do
    send_resp(conn, status_code, Jason.encode!(error))
  end
end
