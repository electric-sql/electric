defmodule Electric.InMemShapeCache do
  require Logger
  alias Electric.Shapes
  use GenServer
  @ets_table :shape_cache
  @ets_shape_xmins :shape_xmins

  def start_link(_) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  def fetch_snapshot(shape_definition) do
    case :ets.lookup(@ets_table, :erlang.phash2(shape_definition)) do
      [] -> :error
      [{_, shape_id, snapshot}] -> {:ok, shape_id, snapshot}
    end
  end

  def list_active_shapes() do
    :ets.tab2list(@ets_shape_xmins)
  end

  @doc """
  Does multiple things:

  1. Query DB for actual snapshot
  2. Start tracking that shape, so we're building a log

  ## Querying

  There is a possible race where multiple clients request a nonexistent
  snapshot concurrently, and we want to create it only once - so we're
  feeding it through a GenServer which will create it only once and duplicate
  the response to everyone who's waiting for it.

  ## Tracking

  Once we query initial data, we need to start building a log for this
  shape. There is a window between querying and logical replication stream
  where we may have already seen/processed transactions that come AFTER
  the queried data. We need to be able to "backfill" the log of a shape
  so that this window between first snapshot and current head of the PG
  replication stream is not lost.
  """
  @spec create_or_wait_snapshot(GenServer.name(), term()) :: :ready | {:error, term()}
  def create_or_wait_snapshot(server \\ __MODULE__, shape_definition) do
    GenServer.call(server, {:create_or_wait_snapshot, shape_definition})
  end

  def init(_) do
    table = :ets.new(@ets_table, [:named_table, :public, :ordered_set])

    xmins =
      :ets.new(@ets_shape_xmins, [:named_table, :public, :ordered_set, read_concurrency: true])

    {:ok, %{table: table, xmins_table: xmins, waiting_for_creation: %{}}}
  end

  def handle_call({:create_or_wait_snapshot, shape_definition}, from, state) do
    hash = :erlang.phash2(shape_definition)
    shape_id = to_string(hash)

    if is_map_key(state.waiting_for_creation, hash) do
      {:noreply, update_in(state, [:waiting_for_creation, hash], &[from | &1])}
    else
      parent = self()

      Task.start(fn ->
        try do
          # FIXME: Should do streaming into a on-disk snapshot
          {:ok, snapshot} =
            Postgrex.transaction(Electric.DbPool, fn conn ->
              Postgrex.query!(
                conn,
                "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
                []
              )

              %{rows: [[xmin]]} =
                Postgrex.query!(conn, "SELECT pg_snapshot_xmin(pg_current_snapshot())", [])

              :ets.insert(@ets_shape_xmins, {shape_id, shape_definition, xmin})
              Shapes.query_snapshot(conn, shape_definition)
            end)

          :ets.insert(@ets_table, {hash, shape_id, snapshot})
          GenServer.cast(parent, {:snapshot_ready, hash})
        rescue
          error -> GenServer.cast(parent, {:snapshot_failed, hash, error})
        end
      end)

      {:noreply, put_in(state, [:waiting_for_creation, hash], [from])}
    end
  end

  def handle_cast({:snapshot_ready, hash}, state) do
    {waiting, state} = pop_in(state, [:waiting_for_creation, hash])
    for client <- waiting, do: GenServer.reply(client, :ready)
    {:noreply, state}
  end

  def handle_cast({:snapshot_failed, hash, error}, state) do
    {waiting, state} = pop_in(state, [:waiting_for_creation, hash])
    for client <- waiting, do: GenServer.reply(client, {:error, error})
    {:noreply, state}
  end

  def handle_cast({:truncate, shape_id, shape_hash}, state) do
    :ets.delete(@ets_table, shape_hash)
    :ets.delete(@ets_shape_xmins, shape_id)

    {:noreply, state}
  end
end
