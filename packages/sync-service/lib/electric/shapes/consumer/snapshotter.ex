defmodule Electric.Shapes.Consumer.Snapshotter do
  use GenServer, restart: :temporary

  alias Electric.ShapeCache.Storage
  alias Electric.Shapes
  alias Electric.Shapes.Querying
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Utils

  require Logger

  def name(%{shape_id: shape_id}) do
    name(shape_id)
  end

  def name(shape_id) when is_binary(shape_id) do
    Electric.Application.process_name(__MODULE__, shape_id)
  end

  def start_link(config) do
    GenServer.start_link(__MODULE__, config, name: name(config))
  end

  def init(config) do
    {:ok, config, {:continue, :start_snapshot}}
  end

  def handle_continue(:start_snapshot, state) do
    %{shape_id: shape_id, shape: shape} = state

    case Shapes.Consumer.whereis(shape_id) do
      parent when is_pid(parent) ->
        if not Storage.snapshot_started?(state.storage) do
          %{
            db_pool: pool,
            storage: storage,
            create_snapshot_fn: create_snapshot_fn,
            prepare_tables_fn: prepare_tables_fn_or_mfa
          } = state

          affected_tables = Shape.affected_tables(shape)

          OpenTelemetry.with_span(
            "shape_cache.create_snapshot_task",
            [],
            fn ->
              try do
                Utils.apply_fn_or_mfa(prepare_tables_fn_or_mfa, [pool, affected_tables])
                apply(create_snapshot_fn, [parent, shape_id, shape, pool, storage])
              rescue
                error ->
                  GenServer.cast(parent, {:snapshot_failed, shape_id, error, __STACKTRACE__})
              end
            end
          )
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
        OpenTelemetry.with_span("shape_cache.query_in_readonly_txn", [], fn ->
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
        end)
      end,
      timeout: :infinity
    )
  end
end
