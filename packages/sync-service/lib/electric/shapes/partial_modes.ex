defmodule Electric.Shapes.PartialModes do
  alias Electric.Shapes.Shape
  alias Electric.Postgres.Lsn
  alias Electric.Shapes.Querying
  alias Electric.Connection.Manager
  alias Electric.Postgres.SnapshotQuery
  alias Electric.Telemetry.OpenTelemetry

  def query_subset(shape_handle, %Shape{} = shape, subset, opts) when is_map(opts) do
    stack_id = Map.fetch!(opts, :stack_id)
    pool = Manager.pool_name(stack_id, :snapshot)
    mark = Enum.random(0..(2 ** 31 - 1))
    headers = %{snapshot_mark: mark}

    SnapshotQuery.execute_for_shape(pool, shape_handle, shape,
      snapshot_info_fn: fn _, pg_snapshot, lsn ->
        send(self(), {:pg_snapshot_info, pg_snapshot, lsn})
      end,
      query_fn: fn conn, _, _ ->
        conn
        |> Querying.query_subset(stack_id, shape_handle, shape, subset, headers)
        |> record_subset_metrics(stack_id, shape_handle, shape)
        |> Enum.to_list()
      end,
      stack_id: opts[:stack_id],
      query_reason: "subset_query"
    )
    |> case do
      {:ok, result} ->
        metadata =
          receive do
            {:pg_snapshot_info, pg_snapshot, lsn} -> make_metadata(pg_snapshot, lsn, mark)
          after
            0 ->
              raise "failed to execute snapshot query for shape #{shape_handle}: missing pg_snapshot_info"
          end

        {:ok, {metadata, result}}

      {:error, error} ->
        {:error, error}
    end
  rescue
    e in Querying.QueryError ->
      {:error, {:where, e.message}}
  end

  defp make_metadata({xmin, xmax, xip_list}, lsn, mark) do
    %{
      xmin: xmin,
      xmax: xmax,
      xip_list: xip_list,
      database_lsn: to_string(Lsn.to_integer(lsn)),
      snapshot_mark: mark
    }
  end

  defp record_subset_metrics(stream, stack_id, shape_handle, shape) do
    Stream.transform(
      stream,
      fn -> {System.monotonic_time(:microsecond), 0, 0} end,
      fn row, {start_time, bytes, rows} ->
        {[row], {start_time, bytes + IO.iodata_length(row), rows + 1}}
      end,
      fn {start_time, bytes, rows} ->
        OpenTelemetry.execute(
          [:electric, :subqueries, :subset_result],
          %{
            duration: System.monotonic_time(:microsecond) - start_time,
            bytes: bytes,
            count: 1,
            rows: rows
          },
          %{
            stack_id: stack_id,
            "shape.handle": shape_handle,
            "shape.root_table": shape.root_table
          }
        )

        OpenTelemetry.add_span_attributes(%{
          "subset.rows" => rows,
          "subset.result_bytes" => bytes
        })
      end
    )
  end

  @doc """
  Asynchronous version of query_move_in that doesn't block on snapshot.
  Sends {:pg_snapshot_known, name, snapshot} immediately when snapshot is known.
  Sends {:query_move_in_complete, name, key_set, snapshot} when query completes.
  """
  def query_move_in_async(supervisor, shape_handle, %Shape{} = shape, where, opts) do
    consumer_pid = Access.fetch!(opts, :consumer_pid)
    pool = Manager.pool_name(opts[:stack_id], :snapshot)
    results_fn = Access.fetch!(opts, :results_fn)

    :telemetry.execute([:electric, :subqueries, :move_in_triggered], %{count: 1}, %{
      stack_id: opts[:stack_id]
    })

    # Propagate OTel context so spans created inside the task are linked to the
    # caller's trace. OTel context is per-process, so without this any
    # `with_child_span` calls in the task would be silently dropped.
    trace_context = OpenTelemetry.get_current_context()

    Task.Supervisor.start_child(supervisor, fn ->
      OpenTelemetry.set_current_context(trace_context)

      try do
        SnapshotQuery.execute_for_shape(pool, shape_handle, shape,
          stack_id: opts[:stack_id],
          query_reason: "move_in_query",
          snapshot_info_fn: fn _, pg_snapshot, _ ->
            # Send snapshot notification immediately instead of blocking
            send(consumer_pid, {:pg_snapshot_known, opts[:move_in_name], pg_snapshot})
          end,
          query_fn: fn conn, pg_snapshot, _ ->
            result =
              Querying.query_move_in(conn, opts[:stack_id], shape_handle, shape, where)
              |> results_fn.(pg_snapshot)

            {key_set, snapshot} = result
            send(consumer_pid, {:query_move_in_complete, opts[:move_in_name], key_set, snapshot})
          end
        )
      rescue
        error ->
          send(consumer_pid, {:query_move_in_error, opts[:move_in_name], error, __STACKTRACE__})
      end
    end)

    :ok
  end

  def query_move_in(supervisor, shape_handle, %Shape{} = shape, where, opts) do
    parent = self()
    pool = Manager.pool_name(opts[:stack_id], :snapshot)
    results_fn = Access.fetch!(opts, :results_fn)

    # Propagate OTel context so spans created inside the task are linked to the
    # caller's trace. OTel context is per-process, so without this any
    # `with_child_span` calls in the task would be silently dropped.
    trace_context = OpenTelemetry.get_current_context()

    Task.Supervisor.start_child(supervisor, fn ->
      OpenTelemetry.set_current_context(trace_context)

      try do
        SnapshotQuery.execute_for_shape(pool, shape_handle, shape,
          stack_id: opts[:stack_id],
          query_reason: "move_in_query",
          snapshot_info_fn: fn _, pg_snapshot, _ ->
            send(parent, {:pg_snapshot_info, pg_snapshot})
          end,
          query_fn: fn conn, _, _ ->
            result =
              Querying.query_move_in(conn, opts[:stack_id], shape_handle, shape, where)
              |> results_fn.()

            send(parent, {:query_move_in_complete, opts[:move_in_name], result})
          end
        )
      rescue
        error ->
          send(parent, {:query_move_in_error, opts[:move_in_name], error, __STACKTRACE__})
      end
    end)

    receive do
      {:query_move_in_error, _, error, stacktrace} ->
        # {:error, error, stacktrace}
        reraise(error, stacktrace)

      {:pg_snapshot_info, pg_snapshot} ->
        # {:ok, pg_snapshot}
        pg_snapshot
    end
  end
end
