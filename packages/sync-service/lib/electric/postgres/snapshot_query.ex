defmodule Electric.Postgres.SnapshotQuery do
  alias Electric.Postgres.Lsn
  alias Electric.SnapshotError
  alias Electric.Shapes.{Querying, Shape}
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
    query_reason = Access.get(opts, :query_reason, "initial_snapshot")
    span_attrs = Shape.otel_attrs(shape_handle, shape, query_reason: query_reason)
    stack_id = Access.fetch!(opts, :stack_id)

    OpenTelemetry.with_child_span(
      "shape_snapshot.execute_for_shape",
      span_attrs,
      stack_id,
      fn ->
        OpenTelemetry.start_interval(:"shape_snapshot.checkout_wait.duration_µs")

        Postgrex.transaction(
          pool,
          fn conn ->
            OpenTelemetry.start_interval(:"shape_snapshot.setup.duration_µs")

            ctx = %{
              conn: conn,
              stack_id: stack_id,
              span_attrs: span_attrs
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

            OpenTelemetry.start_interval(:"shape_snapshot.query.duration_µs")

            result =
              OpenTelemetry.with_child_span(
                "shape_snapshot.query_fn",
                span_attrs,
                stack_id,
                fn -> query_fn.(conn, pg_snapshot, lsn) end
              )

            OpenTelemetry.stop_and_save_intervals(
              total_attribute: :"shape_snapshot.total.duration_µs"
            )

            result
          end,
          timeout: :infinity
        )
      end
    )
  catch
    :exit, {_, {DBConnection.Holder, :checkout, _}} ->
      raise SnapshotError.connection_not_available()
  end

  @spec query!(map(), String.t() | [String.t()], Keyword.t()) :: [Postgrex.Result.t(), ...]
  defp query!(
         %{conn: conn, stack_id: stack_id, span_attrs: span_attrs},
         query_or_queries,
         opts
       ) do
    OpenTelemetry.with_child_span(
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

  def execute_for_subset(shape_handle, %Shape{} = shape, subset, opts) when is_map(opts) do
    stack_id = Map.fetch!(opts, :stack_id)
    pool = Electric.Connection.Manager.pool_name(stack_id, :snapshot)
    mark = Enum.random(0..(2 ** 31 - 1))
    headers = %{snapshot_mark: mark}

    execute_for_shape(pool, shape_handle, shape,
      snapshot_info_fn: fn _, pg_snapshot, lsn ->
        send(self(), {:pg_snapshot_info, pg_snapshot, lsn})
      end,
      query_fn: fn conn, _, _ ->
        conn
        |> Querying.query_subset(stack_id, shape_handle, shape, subset, headers)
        |> record_subset_metrics(stack_id, shape_handle, shape)
        |> Enum.to_list()
      end,
      stack_id: stack_id,
      query_reason: "subset_query"
    )
    |> case do
      {:ok, result} ->
        metadata =
          receive do
            {:pg_snapshot_info, pg_snapshot, lsn} -> make_subset_metadata(pg_snapshot, lsn, mark)
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

  defp make_subset_metadata({xmin, xmax, xip_list}, lsn, mark) do
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
end
