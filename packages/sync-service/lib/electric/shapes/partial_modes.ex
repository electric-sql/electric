defmodule Electric.Shapes.PartialModes do
  alias Electric.Shapes.Shape
  alias Electric.Postgres.Lsn
  alias Electric.Shapes.Querying
  alias Electric.Connection.Manager
  alias Electric.Postgres.SnapshotQuery

  def query_subset(shape_handle, %Shape{} = shape, subset, opts) do
    pool = Manager.pool_name(opts[:stack_id], :snapshot)
    headers = %{snapshot_mark: Enum.random(1..(2 ** 31))}

    result =
      SnapshotQuery.execute_for_shape(pool, shape_handle, shape,
        snapshot_info_fn: fn _, pg_snapshot, lsn ->
          send(self(), {:pg_snapshot_info, pg_snapshot, lsn})
        end,
        query_fn: fn conn, _, _ ->
          Querying.query_subset(conn, shape, subset, headers)
          |> Enum.to_list()
        end,
        stack_id: opts[:stack_id],
        query_reason: "subset_query"
      )

    metadata =
      receive(do: ({:pg_snapshot_info, pg_snapshot, lsn} -> make_metadata(pg_snapshot, lsn)))

    {metadata, result}
  end

  defp make_metadata({xmin, xmax, xip_list}, lsn) do
    %{
      xmin: xmin,
      xmax: xmax,
      xip_list: xip_list,
      database_lsn: to_string(Lsn.to_integer(lsn))
    }
  end

  def query_move_in(supervisor, shape_handle, %Shape{} = shape, where, opts) do
    parent = self()
    pool = Manager.pool_name(opts[:stack_id], :snapshot)
    results_fn = Access.fetch!(opts, :results_fn)

    Task.Supervisor.start_child(supervisor, fn ->
      try do
        SnapshotQuery.execute_for_shape(pool, shape_handle, shape,
          stack_id: opts[:stack_id],
          query_reason: "move_in_query",
          snapshot_info_fn: fn _, pg_snapshot, _ ->
            send(parent, {:pg_snapshot_info, pg_snapshot})
          end,
          query_fn: fn conn, _, _ ->
            result =
              Querying.query_move_in(conn, shape, where)
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
