defmodule Electric.Shapes.PartialModes do
  alias Electric.Shapes.Querying
  alias Electric.Connection.Manager

  def query_subset(shape, opts) do
    pool = Manager.pool_name(opts[:stack_id])

    Postgrex.transaction(pool, fn conn ->
      Postgrex.query!(conn, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
      %{rows: [[{xmin, xmax, xip_list}]]} = Postgrex.query!(conn, "SELECT pg_current_snapshot()")

      metadata = %{xmin: xmin, xmax: xmax, xip_list: xip_list}

      # TODO: This is required for now to avoid abstraction leaks - we can't send this as a chunk response
      #       after closing the transaction, so we can't return a stream here, we'd need to pass in the reducer.
      {metadata, Querying.query_subset(conn, shape, opts) |> Enum.to_list()}
    end)
  end
end
