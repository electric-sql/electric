defmodule Electric.Shapes.Consumer.Snapshotter do
  use GenServer, restart: :temporary

  alias Electric.ShapeCache.Storage
  alias Electric.Shapes
  alias Electric.Shapes.Querying
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Utils

  require Logger

  def name(%{electric_instance_id: electric_instance_id, shape_id: shape_id}) do
    name(electric_instance_id, shape_id)
  end

  def name(electric_instance_id, shape_id) when is_binary(shape_id) do
    Electric.Application.process_name(electric_instance_id, __MODULE__, shape_id)
  end

  def start_link(config) do
    GenServer.start_link(__MODULE__, config, name: name(config))
  end

  def init(config) do
    {:ok, config, {:continue, :start_snapshot}}
  end

  def handle_continue(:start_snapshot, state) do
    %{shape_id: shape_id, shape: shape, electric_instance_id: electric_instance_id} = state

    case Shapes.Consumer.whereis(electric_instance_id, shape_id) do
      consumer when is_pid(consumer) ->
        if not Storage.snapshot_started?(state.storage) do
          %{
            db_pool: pool,
            storage: storage,
            run_with_conn_fn: run_with_conn_fn,
            create_snapshot_fn: create_snapshot_fn,
            prepare_tables_fn: prepare_tables_fn_or_mfa
          } = state

          affected_tables = Shape.affected_tables(shape)

          OpenTelemetry.with_span(
            "shape_snapshot.create_snapshot_task",
            shape_attrs(shape_id, shape),
            fn ->
              try do
                # Grab the same connection from the pool for both operations to
                # ensure we only queue for it once.
                apply(run_with_conn_fn, [
                  pool,
                  fn pool_conn ->
                    Utils.apply_fn_or_mfa(prepare_tables_fn_or_mfa, [pool_conn, affected_tables])
                    apply(create_snapshot_fn, [consumer, shape_id, shape, pool_conn, storage])
                  end
                ])
              rescue
                error ->
                  GenServer.cast(consumer, {:snapshot_failed, shape_id, error, __STACKTRACE__})
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
          GenServer.cast(consumer, {:snapshot_exists, shape_id})
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
  def query_in_readonly_txn(parent, shape_id, shape, db_pool, storage) do
    Postgrex.transaction(
      db_pool,
      fn conn ->
        OpenTelemetry.with_span(
          "shape_snapshot.query_in_readonly_txn",
          shape_attrs(shape_id, shape),
          fn ->
            Postgrex.query!(conn, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", [])

            %{rows: [[xmin]]} =
              Postgrex.query!(conn, "SELECT pg_snapshot_xmin(pg_current_snapshot())", [])

            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, xmin})

            # Enforce display settings *before* querying initial data to maintain consistent
            # formatting between snapshot and live log entries.
            Enum.each(Electric.Postgres.display_settings(), &Postgrex.query!(conn, &1, []))

            stream = Querying.stream_initial_data(conn, shape)

            GenServer.cast(parent, {:snapshot_started, shape_id})

            # could pass the shape and then make_new_snapshot! can pass it to row_to_snapshot_item
            # that way it has the relation, but it is still missing the pk_cols
            Storage.make_new_snapshot!(stream, storage)
          end
        )
      end,
      timeout: :infinity
    )
  end

  defp shape_attrs(shape_id, shape) do
    ["shape.id": shape_id, "shape.root_table": shape.root_table, "shape.where": shape.where]
  end
end
