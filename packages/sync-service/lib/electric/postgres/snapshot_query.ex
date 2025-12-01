defmodule Electric.Postgres.SnapshotQuery do
  alias Electric.SnapshotError
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry

  @type pg_snapshot() ::
          {xmin :: pos_integer(), xmax :: pos_integer(), xip_list :: [pos_integer()]}

  @doc """
  Execute a snapshot query for a shape in a isolated readonly transaction.

  This function operates on two callbacks: `snapshot_info_fn` and `query_fn`.

  `snapshot_info_fn` is called with the shape handle, the pg_snapshot, and the lsn as soon
  as the snapshot information for the started transaction is available.

  `query_fn` is called with the connection, the pg_snapshot, and the lsn and
  is expected to do all the work querying and dealing with the results.

  The query function is executed within a transaction, so it shouldn't return
  a stream (as it will fail to be read after the transaction is committed), but
  rather should execute all desired side-effects or materialize the results.

  Query will be executed within a REPEATABLE READ READ ONLY transaction, with
  correct display settings set.

  Options:
  - `:query_fn` - the function to execute the query.
  - `:snapshot_info_fn` - the function to call with the snapshot information.
  - `:stack_id` - the stack id for this shape.
  """
  @spec execute_for_shape(Postgrex.conn(), Shape.handle(), Shape.t(), [option]) ::
          {:ok, result} | {:error, any()}
        when result: term(),
             option:
               {:snapshot_info_fn, (Shape.handle(), pg_snapshot, pos_integer() -> any())}
               | {:query_fn, (Postgrex.conn(), pg_snapshot, pos_integer() -> result)}
               | {:stack_id, Electric.stack_id()},
             pg_snapshot:
               {xmin :: pos_integer(), xmax :: pos_integer(), xip_list :: [pos_integer()]}
  def execute_for_shape(pool, shape_handle, shape, opts) do
    query_fn = Access.fetch!(opts, :query_fn)
    snapshot_info_fn = Access.fetch!(opts, :snapshot_info_fn)
    shape_attrs = shape_attrs(shape_handle, shape)
    stack_id = Access.fetch!(opts, :stack_id)

    Postgrex.transaction(
      pool,
      fn conn ->
        ctx = %{
          conn: conn,
          stack_id: stack_id,
          span_attrs: shape_attrs,
          query_reason: Access.get(opts, :query_reason, "initial_snapshot")
        }

        query!(ctx, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
          span_name: "shape_snapshot.start_readonly_txn"
        )

        [%{rows: [[pg_snapshot, lsn]]}] =
          query!(ctx, "SELECT pg_current_snapshot(), pg_current_wal_lsn()",
            span_name: "shape_snapshot.get_pg_snapshot"
          )

        snapshot_info_fn.(shape_handle, pg_snapshot, lsn)

        query!(ctx, Electric.Postgres.display_settings(),
          span_name: "shape_snapshot.set_display_settings"
        )

        query_fn.(conn, pg_snapshot, lsn)
      end,
      timeout: :infinity
    )
  catch
    :exit, {_, {DBConnection.Holder, :checkout, _}} ->
      raise SnapshotError.connection_not_available()
  end

  defp shape_attrs(shape_handle, shape) do
    [
      "shape.handle": shape_handle,
      "shape.root_table": shape.root_table,
      "shape.where": shape.where
    ]
  end

  @spec query!(map(), String.t() | [String.t()], Keyword.t()) :: [Postgrex.Result.t(), ...]
  defp query!(
         %{conn: conn, stack_id: stack_id, span_attrs: span_attrs},
         query_or_queries,
         opts
       ) do
    OpenTelemetry.with_span(
      Keyword.fetch!(opts, :span_name),
      span_attrs,
      stack_id,
      fn ->
        query_or_queries
        |> List.wrap()
        |> Enum.map(fn query -> Postgrex.query!(conn, query, Keyword.get(opts, :params, [])) end)
      end
    )
  end
end
