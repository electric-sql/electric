defmodule Electric.ShapeCacheBehaviour do
  @moduledoc """
  Behaviour defining the ShapeCache functions to be used in mocks
  """
  alias Electric.Shapes.Shape

  @type shape_id :: String.t()
  @type shape_def :: Shape.t()
  @type xmin :: non_neg_integer()
  @doc "Append changes from one transaction to the log"
  @callback append_to_log!(
              shape_id(),
              Lsn.t(),
              non_neg_integer(),
              [Changes.change()],
              keyword()
            ) :: :ok

  @callback get_or_create_shape_id(shape_def(), opts :: keyword()) ::
              {shape_id(), current_snapshot_offset :: non_neg_integer()}

  @callback list_active_shapes(opts :: keyword()) :: [{shape_id(), shape_def(), xmin()}]
  @callback wait_for_snapshot(GenServer.name(), shape_id(), shape_def()) ::
              :ready | {:error, term()}
  @callback handle_truncate(GenServer.name(), shape_id()) :: :ok
end

defmodule Electric.ShapeCache do
  require Logger
  alias Electric.Postgres.Lsn
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Querying
  alias Electric.Shapes.Shape
  use GenServer
  @behaviour Electric.ShapeCacheBehaviour

  @type shape_id :: String.t()

  @default_shape_meta_table :shape_meta_table

  @shape_meta_data :shape_meta_data
  @shape_hash_lookup :shape_hash_lookup
  @shape_meta_xmin_pos 3
  @shape_meta_latest_offset_pos 4

  @genserver_name_schema {:or, [:atom, {:tuple, [:atom, :atom, :any]}]}
  @schema NimbleOptions.new!(
            name: [
              type: @genserver_name_schema,
              default: __MODULE__
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

    # Get or create the shape ID and fire a snapshot if necessary
    case :ets.lookup(table, {@shape_hash_lookup, Shape.hash(shape)}) do
      [{_, shape_id}] ->
        {shape_id,
         :ets.lookup_element(table, {@shape_meta_data, shape_id}, @shape_meta_latest_offset_pos)}

      [] ->
        GenServer.call(server, {:create_or_wait_shape_id, shape})
    end
  end

  def append_to_log!(shape_id, lsn, xid, relevant_changes, opts) do
    :ok = Storage.append_to_log!(shape_id, lsn, xid, relevant_changes, opts[:storage])

    update_shape_latest_offset(shape_id, Lsn.to_integer(lsn), opts)
    :ok
  end

  defp update_shape_latest_offset(shape_id, latest_offset, opts) do
    meta_table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)

    if :ets.update_element(meta_table, {@shape_meta_data, shape_id}, {
         @shape_meta_latest_offset_pos,
         latest_offset
       }) do
      :ok
    else
      Logger.warning("Tried to update latest offset #{shape_id} when it doesn't exist")
      :error
    end
  end

  def list_active_shapes(opts \\ []) do
    table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)

    :ets.select(table, [
      {
        {{@shape_meta_data, :"$1"}, :"$2", :"$3", :_},
        [{:"=/=", :"$3", nil}],
        [{{:"$1", :"$2", :"$3"}}]
      }
    ])
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
    shape_meta_table =
      :ets.new(opts.shape_meta_table, [:named_table, :public, :ordered_set])

    # TODO: when Electric restarts, we're not re-filling neither xmins nor shape meta tables
    #       from persisted storage if one exists, which means persistance doesn't carry over
    #       a restart, which is not great. We should load any shape IDs we have logs for along
    #       with actual shape definition to be able to immediately start filtering PG txns after
    #       a restart.

    {:ok,
     %{
       storage: opts.storage,
       shape_meta_table: shape_meta_table,
       waiting_for_creation: %{},
       db_pool: opts.db_pool,
       create_snapshot_fn: opts.create_snapshot_fn
     }}
  end

  def handle_call({:create_or_wait_shape_id, shape}, _from, state) do
    hash = Shape.hash(shape)
    shape_id = "#{hash}-#{DateTime.utc_now() |> DateTime.to_unix(:millisecond)}"

    # fresh snapshots always start with offset 0 - only once they
    # are folded into the log do we have lsn-like non-zero offsets
    latest_offset = 0
    xmin = nil

    :ets.insert_new(
      state.shape_meta_table,
      [
        {{@shape_hash_lookup, hash}, shape_id},
        {{@shape_meta_data, shape_id}, shape, xmin, latest_offset}
      ]
    )

    # lookup to ensure concurrent calls with the same shape definition all
    # match to the same shape ID
    [{_, shape_id}] = :ets.lookup(state.shape_meta_table, {@shape_hash_lookup, hash})

    state = maybe_start_snapshot(state, shape_id, shape)

    {:reply, {shape_id, latest_offset}, state}
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

  def handle_cast({:snapshot_xmin_known, shape_id, xmin}, state) do
    if not :ets.update_element(
         state.shape_meta_table,
         {@shape_meta_data, shape_id},
         {@shape_meta_xmin_pos, xmin}
       ) do
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
    shape = :ets.lookup_element(state.shape_meta_table, {@shape_meta_data, shape_id}, 2)

    :ets.select_delete(
      state.shape_meta_table,
      [
        {{{@shape_meta_data, shape_id}, :_, :_, :_}, [], [true]},
        {{{@shape_hash_lookup, :_}, shape_id}, [], [true]}
      ]
    )

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

        GenServer.cast(parent, {:snapshot_xmin_known, shape_id, xmin})
        {query, stream} = Querying.stream_initial_data(conn, shape)

        Storage.make_new_snapshot!(shape_id, query, stream, storage)
      end)

    GenServer.cast(parent, {:snapshot_ready, shape_id})
  rescue
    error -> GenServer.cast(parent, {:snapshot_failed, shape_id, error, __STACKTRACE__})
  end
end
