defmodule Electric.ShapeCacheBehaviour do
  @moduledoc """
  Behaviour defining the ShapeCache functions to be used in mocks
  """
  alias Electric.Shapes.Shape

  @type shape_id :: String.t()
  @type shape_def :: Shape.t()
  @type xmin :: non_neg_integer()

  @callback get_or_create_shape_id(shape_def(), opts :: keyword()) ::
              {shape_id(), current_snapshot_offset :: non_neg_integer()}
  @callback list_active_shapes(opts :: keyword()) :: [{shape_id(), shape_def(), xmin()}]
  @callback wait_for_snapshot(GenServer.name(), shape_id(), shape_def()) ::
              :ready | {:error, term()}
  @callback handle_truncate(GenServer.name(), shape_id()) :: :ok
end

defmodule Electric.ShapeCache do
  require Logger
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Querying
  alias Electric.Shapes.Shape
  use GenServer
  @behaviour Electric.ShapeCacheBehaviour

  @type shape_id :: String.t()

  @default_shape_xmins_table :shape_xmins
  @default_shape_meta_table :shape_meta_table

  @genserver_name_schema {:or, [:atom, {:tuple, [:atom, :atom, :any]}]}
  @schema NimbleOptions.new!(
            name: [
              type: @genserver_name_schema,
              default: __MODULE__
            ],
            shape_xmins_table: [
              type: :atom,
              default: @default_shape_xmins_table
            ],
            shape_meta_table: [
              type: :atom,
              default: @default_shape_meta_table
            ],
            storage: [type: :mod_arg, required: true],
            db_pool: [type: {:or, [:atom, :pid]}, default: Electric.DbPool],
            create_snapshot_fn: [type: {:fun, 5}, default: &__MODULE__.query_in_readonly_txn/5]
          )

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      GenServer.start_link(__MODULE__, Map.new(opts), name: opts[:name])
    end
  end

  def get_or_create_shape_id(shape, opts \\ []) do
    table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)
    server = Access.get(opts, :server, __MODULE__)

    case :ets.lookup(table, Shape.hash(shape)) do
      [{_, shape_id, last_offset}] -> {shape_id, last_offset}
      [] -> GenServer.call(server, {:create_or_wait_shape_id, shape})
    end
  end

  def list_active_shapes(opts \\ []) do
    table = Access.get(opts, :shape_xmins_table, @default_shape_xmins_table)
    :ets.tab2list(table)
  end

  @spec clean_shape(GenServer.name(), String.t()) :: :ok
  def clean_shape(server \\ __MODULE__, shape_id) do
    GenServer.call(server, {:clean, shape_id})
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
      :ets.new(opts.shape_xmins_table, [
        :named_table,
        :protected,
        :ordered_set,
        read_concurrency: true
      ])

    shape_meta_table =
      :ets.new(opts.shape_meta_table, [:named_table, :protected, :set])

    {:ok,
     %{
       storage: opts.storage,
       xmins_table: xmins,
       shape_meta_table: shape_meta_table,
       waiting_for_creation: %{},
       db_pool: opts.db_pool,
       create_snapshot_fn: opts.create_snapshot_fn
     }}
  end

  def handle_call({:create_or_wait_shape_id, shape}, _from, state) do
    hash = Shape.hash(shape)
    shape_id = "#{hash}-#{DateTime.utc_now() |> DateTime.to_unix(:millisecond)}"

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
    cleaned_up_shape = clean_up_shape(state, shape_id)

    Logger.info(
      "Truncating and rotating shape id, previous shape id #{shape_id}, definition: #{inspect(cleaned_up_shape)}"
    )

    {:reply, :ok, state}
  end

  def handle_call({:clean, shape_id}, _from, state) do
    cleaned_up_shape = clean_up_shape(state, shape_id)
    Logger.info("Cleaning up shape #{shape_id}, definition: #{inspect(cleaned_up_shape)}")
    {:reply, :ok, state}
  end

  def handle_cast({:snapshot_xmin_known, shape_id, shape, xmin}, state) do
    case :ets.match(state.shape_meta_table, {:_, shape_id, :"$1"}, 1) do
      {_, _} ->
        :ets.insert(state.xmins_table, {shape_id, shape, xmin})

      _ ->
        Logger.warning(
          "Got snapshot information for a shape whose shape_id is no longer valid. Ignoring."
        )
    end

    {:noreply, state}
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

  defp clean_up_shape(state, shape_id) do
    shape = :ets.lookup_element(state.xmins_table, shape_id, 2)
    :ets.delete(state.xmins_table, shape_id)
    :ets.match_delete(state.shape_meta_table, {:_, shape_id, :_})
    Task.start(fn -> Storage.cleanup!(shape_id, state.storage) end)
    shape
  end

  defp maybe_start_snapshot(%{waiting_for_creation: map} = state, shape_id, _)
       when is_map_key(map, shape_id),
       do: state

  defp maybe_start_snapshot(state, shape_id, shape) do
    if not Storage.snapshot_exists?(shape_id, state.storage) do
      parent = self()
      %{db_pool: pool, storage: storage, create_snapshot_fn: create_snapshot_fn} = state

      Task.start(fn -> apply(create_snapshot_fn, [parent, shape_id, shape, pool, storage]) end)

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

  @doc false
  def query_in_readonly_txn(parent, shape_id, shape, db_pool, storage) do
    {:ok, _} =
      Postgrex.transaction(db_pool, fn conn ->
        Postgrex.query!(
          conn,
          "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
          []
        )

        %{rows: [[xmin]]} =
          Postgrex.query!(conn, "SELECT pg_snapshot_xmin(pg_current_snapshot())", [])

        GenServer.cast(parent, {:snapshot_xmin_known, shape_id, shape, xmin})
        # :ets.insert(state.xmins_table, {shape_id, shape, xmin})
        {query, stream} = Querying.stream_initial_data(conn, shape)

        Storage.make_new_snapshot!(shape_id, query, stream, storage)
      end)

    GenServer.cast(parent, {:snapshot_ready, shape_id})
  rescue
    error -> GenServer.cast(parent, {:snapshot_failed, shape_id, error, __STACKTRACE__})
  end
end
