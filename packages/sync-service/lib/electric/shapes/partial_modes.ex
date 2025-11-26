defmodule Electric.Shapes.PartialModes do
  alias Electric.Postgres.Lsn
  alias Electric.Shapes.Querying
  alias Electric.Connection.Manager

  def query_subset(shape, subset, opts) do
    pool = Manager.pool_name(opts[:stack_id], :snapshot)

    Postgrex.transaction(pool, fn conn ->
      Postgrex.query!(conn, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")

      %{rows: [[{xmin, xmax, xip_list}, lsn]]} =
        Postgrex.query!(conn, "SELECT pg_current_snapshot(), pg_current_wal_lsn()")

      mark = Enum.random(1..(2 ** 31))

      metadata = %{
        xmin: xmin,
        xmax: xmax,
        xip_list: xip_list,
        snapshot_mark: mark,
        database_lsn: to_string(Lsn.to_integer(lsn))
      }

      # TODO: This is required for now to avoid abstraction leaks - we can't send this as a chunk response
      #       after closing the transaction, so we can't return a stream here, we'd need to pass in the reducer.
      {metadata, Querying.query_subset(conn, shape, subset, mark) |> Enum.to_list()}
    end)
  rescue
    e in Querying.QueryError ->
      {:error, {:where, e.message}}
  end
end
