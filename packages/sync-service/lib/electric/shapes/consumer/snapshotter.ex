defmodule Electric.Shapes.Consumer.Snapshotter do
  use GenServer, restart: :temporary

  alias Electric.ShapeCache.Storage
  alias Electric.Shapes
  alias Electric.Shapes.Querying
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  def name(%{
        stack_id: stack_id,
        shape_handle: shape_handle
      }) do
    name(stack_id, shape_handle)
  end

  def name(stack_id, shape_handle) when is_binary(shape_handle) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, shape_handle)
  end

  def start_link(config) do
    GenServer.start_link(__MODULE__, config, name: name(config))
  end

  def init(config) do
    Process.set_label({:snapshotter, config.shape_handle})
    metadata = [stack_id: config.stack_id, shape_handle: config.shape_handle]
    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

    {:ok, config, {:continue, :start_snapshot}}
  end

  def handle_continue(:start_snapshot, state) do
    %{
      shape_handle: shape_handle,
      shape: shape,
      stack_id: stack_id
    } =
      state

    case Shapes.Consumer.whereis(stack_id, shape_handle) do
      consumer when is_pid(consumer) ->
        if not Storage.snapshot_started?(state.storage) do
          %{
            db_pool: pool,
            storage: storage,
            create_snapshot_fn: create_snapshot_fn,
            publication_manager: {publication_manager, publication_manager_opts},
            stack_id: stack_id,
            chunk_bytes_threshold: chunk_bytes_threshold
          } = state

          OpenTelemetry.with_span(
            "shape_snapshot.create_snapshot_task",
            shape_attrs(shape_handle, shape),
            stack_id,
            fn ->
              try do
                OpenTelemetry.with_span(
                  "shape_snapshot.prepare_tables",
                  shape_attrs(shape_handle, shape),
                  stack_id,
                  fn ->
                    publication_manager.add_shape(shape, publication_manager_opts)
                  end
                )

                apply(create_snapshot_fn, [
                  consumer,
                  shape_handle,
                  shape,
                  pool,
                  storage,
                  stack_id,
                  chunk_bytes_threshold
                ])
              rescue
                error ->
                  GenServer.cast(
                    consumer,
                    {:snapshot_failed, shape_handle, error, __STACKTRACE__}
                  )
              end
            end
          )
        else
          # Let the shape cache know that the snapshot is available. When the
          # shape cache starts and restores the shapes from disk, it doesn't
          # know about the snapshot status of each shape, and because the
          # storage does some clean up on start, e.g. in the case of a format
          # upgrade, we only know the actual on-disk state of the shape data
          # once things are running.
          GenServer.cast(consumer, {:snapshot_exists, shape_handle})
        end

        {:stop, :normal, state}

      nil ->
        Logger.error(
          "Unable to start snapshot - invalid ShapeCache reference #{inspect(state.shape_cache)}"
        )

        {:stop, {:error, "shape cache server invalid"}, state}
    end
  end

  @doc false
  # wrap DBConnection.run/2 with an infinite timeout. Required because you
  # can't pass captures in NimbleOptions schemas.
  def run_with_conn(conn, fun) do
    DBConnection.run(conn, fun, timeout: :infinity)
  end

  @doc false
  def query_in_readonly_txn(
        parent,
        shape_handle,
        shape,
        db_pool,
        storage,
        stack_id,
        chunk_bytes_threshold
      ) do
    shape_attrs = shape_attrs(shape_handle, shape)

    Postgrex.transaction(
      db_pool,
      fn conn ->
        OpenTelemetry.with_span(
          "shape_snapshot.query_in_readonly_txn",
          shape_attrs,
          stack_id,
          fn ->
            query_span!(
              conn,
              "shape_snapshot.start_readonly_txn",
              shape_attrs,
              "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
              [],
              stack_id
            )

            %{rows: [[xmin]]} =
              query_span!(
                conn,
                "shape_snapshot.get_snapshot_xmin",
                shape_attrs,
                "SELECT pg_snapshot_xmin(pg_current_snapshot())",
                [],
                stack_id
              )

            GenServer.cast(parent, {:snapshot_xmin_known, shape_handle, xmin})

            # Enforce display settings *before* querying initial data to maintain consistent
            # formatting between snapshot and live log entries.
            OpenTelemetry.with_span(
              "shape_snapshot.set_display_settings",
              shape_attrs,
              stack_id,
              fn ->
                Enum.each(Electric.Postgres.display_settings(), &Postgrex.query!(conn, &1, []))
              end
            )

            stream = Querying.stream_initial_data(conn, stack_id, shape, chunk_bytes_threshold)

            GenServer.cast(parent, {:snapshot_started, shape_handle})

            # could pass the shape and then make_new_snapshot! can pass it to row_to_snapshot_item
            # that way it has the relation, but it is still missing the pk_cols
            Storage.make_new_snapshot!(stream, storage)
          end
        )
      end,
      timeout: :infinity
    )
  end

  defp query_span!(conn, span_name, span_attrs, query, params, stack_id) do
    OpenTelemetry.with_span(
      span_name,
      span_attrs,
      stack_id,
      fn -> Postgrex.query!(conn, query, params) end
    )
  end

  defp shape_attrs(shape_handle, shape) do
    [
      "shape.handle": shape_handle,
      "shape.root_table": shape.root_table,
      "shape.where": shape.where
    ]
  end
end
