defmodule Electric.InMemShapeCache do
  require Logger
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes
  alias Electric.Shapes.Shape
  use GenServer

  @ets_shape_xmins :shape_xmins

  @shape_meta_table :shape_meta_table

  @genserver_name_schema {:or, [:atom, {:tuple, [:atom, :atom, :any]}]}
  @schema NimbleOptions.new!(
            name: [
              type: @genserver_name_schema,
              default: __MODULE__
            ],
            shape_meta_table: [
              type: :atom,
              default: @shape_meta_table
            ],
            storage: [type: :mod_arg, required: true]
          )

  def start_link(opts) do
    with {:ok, opts} = NimbleOptions.validate(opts, @schema) do
      GenServer.start_link(__MODULE__, Map.new(opts), name: opts[:name])
    end
  end

  def get_or_create_shape_id(shape, opts) do
    table = Keyword.get(opts, :shape_meta_table, @shape_meta_table)
    server = Keyword.get(opts, :server, __MODULE__)

    case :ets.lookup(table, Shape.hash(shape)) do
      [{_, shape_id, last_offset}] -> {shape_id, last_offset}
      [] -> GenServer.call(server, {:create_or_wait_shape_id, shape})
    end
  end

  def list_active_shapes() do
    :ets.tab2list(@ets_shape_xmins)
  end

  @spec handle_truncate(GenServer.name(), String.t()) :: :ok
  def handle_truncate(server \\ __MODULE__, shape_id) do
    GenServer.call(server, {:truncate, shape_id})
  end

  @spec wait_for_snapshot(GenServer.name(), String.t(), Shape.t()) :: :ready | {:error, term()}
  def wait_for_snapshot(server \\ __MODULE__, shape_id, shape) when is_binary(shape_id) do
    GenServer.call(server, {:wait_for_snapshot, shape_id, shape})
  end

  def init(opts) do
    xmins =
      :ets.new(@ets_shape_xmins, [:named_table, :public, :ordered_set, read_concurrency: true])

    shape_meta_table =
      :ets.new(opts.shape_meta_table, [:named_table, :public, :ordered_set])

    {:ok,
     %{
       storage: opts.storage,
       xmins_table: xmins,
       shape_meta_table: shape_meta_table,
       waiting_for_creation: %{}
     }}
  end

  def handle_call({:create_or_wait_shape_id, shape}, _from, state) do
    hash = Shape.hash(shape)
    shape_id = "#{hash}-#{DateTime.utc_now() |> DateTime.to_unix()}"

    :ets.insert_new(state.shape_meta_table, {hash, shape_id, 0})
    [{_, shape_id, last_offset}] = :ets.lookup(state.shape_meta_table, hash)

    state = maybe_start_snapshot(state, shape_id, shape)

    {:reply, {shape_id, last_offset}, state}
  end

  def handle_call({:wait_for_snapshot, shape_id, shape}, from, state) do
    if Storage.snapshot_exists?(shape_id, state.storage) do
      {:reply, :ready, state}
    else
      {:noreply, state |> maybe_start_snapshot(shape_id, shape) |> add_waiter(shape_id, from)}
    end
  end

  def handle_call({:truncate, shape_id}, _from, state) do
    shape = :ets.lookup_element(state.xmins_table, shape_id, 2)
    :ets.delete(state.xmins_table, shape_id)
    :ets.match_delete(state.shape_meta_table, {:_, shape_id, :_})
    Task.start(fn -> Storage.cleanup!(shape_id, state.storage) end)

    Logger.info(
      "Truncating and rotating shape id, previous shape id #{shape_id}, definition: #{inspect(shape)}"
    )

    {:reply, :ok, state}
  end

  def handle_cast({:snapshot_ready, shape_id}, state) do
    {waiting, state} = pop_in(state, [:waiting_for_creation, shape_id])
    for client <- waiting, not is_nil(client), do: GenServer.reply(client, :ready)
    {:noreply, state}
  end

  def handle_cast({:snapshot_failed, shape_id, error, stacktrace}, state) do
    Logger.error(
      "Snapshot creation failed for #{shape_id} because of:\n#{Exception.format(:error, error, stacktrace)}"
    )

    {waiting, state} = pop_in(state, [:waiting_for_creation, shape_id])
    for client <- waiting, not is_nil(client), do: GenServer.reply(client, {:error, error})
    {:noreply, state}
  end

  defp maybe_start_snapshot(%{waiting_for_creation: map} = state, shape_id, _)
       when is_map_key(map, shape_id),
       do: state

  defp maybe_start_snapshot(state, shape_id, shape) do
    if not Storage.snapshot_exists?(shape_id, state.storage) do
      parent = self()

      Task.start(fn ->
        try do
          {:ok, :ok} =
            Postgrex.transaction(Electric.DbPool, fn conn ->
              Postgrex.query!(
                conn,
                "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
                []
              )

              %{rows: [[xmin]]} =
                Postgrex.query!(conn, "SELECT pg_snapshot_xmin(pg_current_snapshot())", [])

              :ets.insert(state.xmins_table, {shape_id, shape, xmin})
              {query, stream} = Shapes.Querying.stream_initial_data(conn, shape)

              Storage.make_new_snapshot!(shape_id, query, stream, state.storage)
            end)

          GenServer.cast(parent, {:snapshot_ready, shape_id})
        rescue
          error -> GenServer.cast(parent, {:snapshot_failed, shape_id, error, __STACKTRACE__})
        end
      end)

      add_waiter(state, shape_id, nil)
    else
      state
    end
  end

  defp add_waiter(%{waiting_for_creation: waiters} = state, shape_id, waiter),
    do: %{
      state
      | waiting_for_creation: Map.update(waiters, shape_id, [waiter], &[waiter | &1])
    }
end
