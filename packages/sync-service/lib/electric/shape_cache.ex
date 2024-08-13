defmodule Electric.ShapeCacheBehaviour do
  @moduledoc """
  Behaviour defining the ShapeCache functions to be used in mocks
  """
  alias Electric.Shapes.Shape
  alias Electric.Replication.LogOffset
  alias Electric.Postgres.LogicalReplication.Messages

  @type shape_id :: String.t()
  @type shape_def :: Shape.t()
  @type xmin :: non_neg_integer()

  @doc "Update a shape's status with a new log offset"
  @callback update_shape_latest_offset(shape_id(), LogOffset.t(), keyword()) :: :ok

  @callback get_or_create_shape_id(shape_def(), opts :: keyword()) ::
              {shape_id(), current_snapshot_offset :: LogOffset.t()}

  @callback list_active_shapes(opts :: keyword()) :: [{shape_id(), shape_def(), xmin()}]
  @callback store_relation(Relation.t(), opts :: keyword()) :: :ok
  @callback get_relation(Messages.relation_id(), opts :: keyword()) :: Relation.t() | nil
  @callback await_snapshot_start(shape_id(), opts :: keyword()) :: :started | {:error, term()}
  @callback handle_truncate(shape_id(), keyword()) :: :ok
  @callback clean_shape(shape_id(), keyword()) :: :ok
  @callback has_shape?(shape_id(), keyword()) :: boolean()
end

defmodule Electric.ShapeCache do
  use GenServer

  alias Electric.Replication.Changes.{Relation, Column}
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes

  require Logger

  @behaviour Electric.ShapeCacheBehaviour

  @type shape_id :: Electric.ShapeCacheBehaviour.shape_id()

  @default_shape_meta_table :shape_meta_table

  # GARRY-TODO: relation data in shape status
  @relation_data :relation_data

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
            log_producer: [
              type: {:or, [:atom, :pid]},
              default: Electric.Replication.ShapeLogCollector
            ],
            storage: [type: :mod_arg, required: true],
            registry: [type: {:or, [:atom, :pid]}, required: true],
            # NimbleOptions has no "implementation of protocol" type
            persistent_kv: [type: :any, required: true],
            db_pool: [type: {:or, [:atom, :pid]}, default: Electric.DbPool],
            prepare_tables_fn: [type: {:or, [:mfa, {:fun, 2}]}, required: true],
            create_snapshot_fn: [
              type: {:fun, 5},
              default: &Shapes.Snapshotter.query_in_readonly_txn/5
            ]
          )

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      GenServer.start_link(__MODULE__, Map.new(opts), name: opts[:name])
    end
  end

  @impl Electric.ShapeCacheBehaviour
  def get_or_create_shape_id(shape, opts \\ []) do
    table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)

    # Get or create the shape ID and fire a snapshot if necessary
    if shape_state = ShapeStatus.existing_shape(table, shape) do
      shape_state
    else
      server = Access.get(opts, :server, __MODULE__)
      GenServer.call(server, {:create_or_wait_shape_id, shape})
    end
  end

  @impl Electric.ShapeCacheBehaviour
  @spec update_shape_latest_offset(shape_id(), LogOffset.t(), opts :: keyword()) ::
          :ok | {:error, term()}
  def update_shape_latest_offset(shape_id, latest_offset, opts) do
    meta_table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)

    if ShapeStatus.set_latest_offset(meta_table, shape_id, latest_offset) do
      :ok
    else
      Logger.warning("Tried to update latest offset for shape #{shape_id} which doesn't exist")
      :error
    end
  end

  @impl Electric.ShapeCacheBehaviour
  def list_active_shapes(opts \\ []) do
    table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)

    ShapeStatus.list_active_shapes(table)
  end

  @impl Electric.ShapeCacheBehaviour
  @spec store_relation(Relation.t(), keyword()) :: :ok
  def store_relation(%Relation{} = rel, opts) do
    store_relation_ets(rel, opts)
    Storage.store_relation(rel, opts[:storage])
  end

  defp store_relation_ets(%Relation{id: id, schema: schema, table: table, columns: columns}, opts) do
    meta_table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)
    cols = Enum.map(columns, fn col -> {col.name, col.type_oid} end)
    :ets.insert(meta_table, {{@relation_data, id}, schema, table, cols})
  end

  @impl Electric.ShapeCacheBehaviour
  @spec get_relation(Messages.relation_id(), opts :: keyword()) :: Relation.t() | nil
  def get_relation(relation_id, opts) do
    meta_table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)

    case :ets.lookup(meta_table, {@relation_data, relation_id}) do
      [] ->
        nil

      [{_, schema, table, cols}] ->
        %Relation{
          id: relation_id,
          schema: schema,
          table: table,
          columns:
            Enum.map(cols, fn {name, type_oid} -> %Column{name: name, type_oid: type_oid} end)
        }
    end
  end

  @impl Electric.ShapeCacheBehaviour
  @spec clean_shape(shape_id(), keyword()) :: :ok
  def clean_shape(shape_id, opts) do
    server = Access.get(opts, :server, __MODULE__)
    GenServer.call(server, {:clean, shape_id})
  end

  @impl Electric.ShapeCacheBehaviour
  @spec handle_truncate(shape_id(), keyword()) :: :ok
  def handle_truncate(shape_id, opts \\ []) do
    server = Access.get(opts, :server, __MODULE__)
    GenServer.call(server, {:truncate, shape_id})
  end

  @impl Electric.ShapeCacheBehaviour
  @spec await_snapshot_start(shape_id(), keyword()) :: :started | {:error, term()}
  def await_snapshot_start(shape_id, opts \\ []) when is_binary(shape_id) do
    table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)

    if ShapeStatus.snapshot_xmin?(table, shape_id) do
      :started
    else
      server = Access.get(opts, :server, __MODULE__)
      GenServer.call(server, {:await_snapshot_start, shape_id})
    end
  end

  @impl Electric.ShapeCacheBehaviour
  def has_shape?(shape_id, opts \\ []) do
    table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)

    if ShapeStatus.existing_shape(table, shape_id) do
      true
    else
      server = Access.get(opts, :server, __MODULE__)
      GenServer.call(server, {:wait_shape_id, shape_id})
    end
  end

  @impl GenServer
  def init(opts) do
    {:ok, persistent_state} =
      ShapeStatus.initialise(
        persistent_kv: opts.persistent_kv,
        meta_table: opts.shape_meta_table
      )

    state = %{
      name: opts.name,
      storage: opts.storage,
      shape_meta_table: opts.shape_meta_table,
      awaiting_snapshot_start: %{},
      db_pool: opts.db_pool,
      persistent_state: persistent_state,
      create_snapshot_fn: opts.create_snapshot_fn,
      prepare_tables_fn: opts.prepare_tables_fn,
      log_producer: opts.log_producer,
      registry: opts.registry
    }

    recover_shapes(state)
    recover_relations(state)

    {:ok, state}
  end

  @impl GenServer
  def handle_call({:create_or_wait_shape_id, shape}, _from, state) do
    {{shape_id, latest_offset}, state} =
      if shape_state = ShapeStatus.existing_shape(state.persistent_state, shape) do
        {shape_state, state}
      else
        {:ok, shape_id} = ShapeStatus.add_shape(state.persistent_state, shape)

        {:ok, _snapshot_xmin, latest_offset} = start_shape(shape_id, shape, state)
        {{shape_id, latest_offset}, state}
      end

    Logger.debug("Returning shape id #{shape_id} for shape #{inspect(shape)}")

    {:reply, {shape_id, latest_offset}, state}
  end

  def handle_call({:await_snapshot_start, shape_id}, from, state) do
    cond do
      not is_known_shape_id?(state, shape_id) ->
        {:reply, {:error, :unknown}, state}

      ShapeStatus.snapshot_xmin?(state.persistent_state, shape_id) ->
        {:reply, :started, state}

      true ->
        Logger.debug("Starting a wait on the snapshot #{shape_id} for #{inspect(from)}}")

        {:noreply, add_waiter(state, shape_id, from)}
    end
  end

  def handle_call({:wait_shape_id, shape_id}, _from, state) do
    {:reply, !is_nil(ShapeStatus.existing_shape(state.persistent_state, shape_id)), state}
  end

  def handle_call({:truncate, shape_id}, _from, state) do
    with {:ok, cleaned_up_shape} <- clean_up_shape(state, shape_id) do
      Logger.info(
        "Truncating and rotating shape id, previous shape id #{shape_id}, definition: #{inspect(cleaned_up_shape)}"
      )
    end

    {:reply, :ok, state}
  end

  def handle_call({:clean, shape_id}, _from, state) do
    # ignore errors when cleaning up non-existant shape id
    with {:ok, cleaned_up_shape} <- clean_up_shape(state, shape_id) do
      Logger.info("Cleaning up shape #{shape_id}, definition: #{inspect(cleaned_up_shape)}")
    end

    {:reply, :ok, state}
  end

  @impl GenServer
  def handle_cast({:snapshot_xmin_known, shape_id, xmin}, state) do
    unless ShapeStatus.set_snapshot_xmin(state.persistent_state, shape_id, xmin) do
      Logger.warning(
        "Got snapshot information for a #{shape_id}, that shape id is no longer valid. Ignoring."
      )
    end

    {:noreply, state}
  end

  def handle_cast({:snapshot_started, shape_id}, state) do
    Logger.debug("Snapshot for #{shape_id} is ready")
    {waiting, state} = pop_in(state, [:awaiting_snapshot_start, shape_id])
    for client <- List.wrap(waiting), not is_nil(client), do: GenServer.reply(client, :started)
    {:noreply, state}
  end

  def handle_cast({:snapshot_failed, shape_id, error, stacktrace}, state) do
    Logger.error(
      "Snapshot creation failed for #{shape_id} because of:\n#{Exception.format(:error, error, stacktrace)}"
    )

    clean_up_shape(state, shape_id)
    {waiting, state} = pop_in(state, [:awaiting_snapshot_start, shape_id])

    # waiting may nil here if :snapshot_failed happens after :snapshot_started
    if waiting do
      for client <- waiting, not is_nil(client), do: GenServer.reply(client, {:error, error})
    end

    {:noreply, state}
  end

  defp clean_up_shape(state, shape_id) do
    Electric.ShapeCache.ShapeSupervisor.stop_shape_consumer(shape_id)

    ShapeStatus.remove_shape(state.persistent_state, shape_id)
  end

  defp is_known_shape_id?(state, shape_id) do
    if ShapeStatus.existing_shape(state.persistent_state, shape_id) do
      true
    else
      false
    end
  end

  defp add_waiter(%{awaiting_snapshot_start: waiters} = state, shape_id, waiter),
    do: %{
      state
      | awaiting_snapshot_start: Map.update(waiters, shape_id, [waiter], &[waiter | &1])
    }

  defp recover_shapes(state) do
    state.persistent_state
    |> ShapeStatus.list_shapes()
    |> Enum.each(fn {shape_id, shape} ->
      {:ok, _snapshot_xmin, _latest_offset} = start_shape(shape_id, shape, state)
    end)
  end

  defp start_shape(shape_id, shape, state) do
    with {:ok, _pid} <-
           Electric.ShapeCache.ShapeSupervisor.start_shape_consumer(
             shape_id: shape_id,
             shape: shape,
             storage: state.storage,
             log_producer: state.log_producer,
             shape_cache:
               {__MODULE__, %{server: state.name, shape_meta_table: state.shape_meta_table}},
             registry: state.registry,
             db_pool: state.db_pool,
             prepare_tables_fn: state.prepare_tables_fn,
             create_snapshot_fn: state.create_snapshot_fn
           ) do
      consumer = Shapes.Consumer.name(shape_id)

      {:ok, snapshot_xmin, latest_offset} = Shapes.Consumer.initial_state(consumer)

      :ok =
        ShapeStatus.initialise_shape(
          state.persistent_state,
          shape_id,
          snapshot_xmin,
          latest_offset
        )

      {:ok, snapshot_xmin, latest_offset}
    end
  end

  defp recover_relations(state) do
    state.storage
    |> Storage.get_relations()
    |> Enum.each(&store_relation_ets(&1, state))
  end
end
