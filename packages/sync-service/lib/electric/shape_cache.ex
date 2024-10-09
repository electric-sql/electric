defmodule Electric.ShapeCacheBehaviour do
  @moduledoc """
  Behaviour defining the ShapeCache functions to be used in mocks
  """
  alias Electric.Postgres.LogicalReplication.Messages
  alias Electric.Shapes.Shape
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset

  @type shape_id :: String.t()
  @type shape_def :: Shape.t()
  @type xmin :: non_neg_integer()

  @doc "Update a shape's status with a new log offset"
  @callback update_shape_latest_offset(shape_id(), LogOffset.t(), keyword()) :: :ok

  @callback get_shape(shape_def(), opts :: keyword()) ::
              {shape_id(), current_snapshot_offset :: LogOffset.t()}
  @callback get_or_create_shape_id(shape_def(), opts :: keyword()) ::
              {shape_id(), current_snapshot_offset :: LogOffset.t()}

  @callback get_relation(Messages.relation_id(), opts :: keyword()) :: Changes.Relation.t() | nil
  @callback list_shapes(Electric.ShapeCache.ShapeStatus.t()) :: [{shape_id(), Shape.t()}]
  @callback await_snapshot_start(shape_id(), opts :: keyword()) :: :started | {:error, term()}
  @callback handle_truncate(shape_id(), keyword()) :: :ok
  @callback clean_shape(shape_id(), keyword()) :: :ok
  @callback clean_all_shapes(GenServer.name()) :: :ok
  @callback has_shape?(shape_id(), keyword()) :: boolean()
end

defmodule Electric.ShapeCache do
  use GenServer

  alias Electric.Postgres.LogicalReplication.Messages
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes
  alias Electric.Shapes.Shape

  require Logger

  @behaviour Electric.ShapeCacheBehaviour

  @type shape_id :: Electric.ShapeCacheBehaviour.shape_id()

  @default_shape_meta_table :shape_meta_table

  @genserver_name_schema {:or, [:atom, {:tuple, [:atom, :atom, :any]}]}
  @schema NimbleOptions.new!(
            name: [
              type: @genserver_name_schema,
              default: __MODULE__
            ],
            electric_instance_id: [type: :atom, required: true],
            shape_meta_table: [
              type: :atom,
              default: @default_shape_meta_table
            ],
            log_producer: [type: @genserver_name_schema, required: true],
            consumer_supervisor: [type: @genserver_name_schema, required: true],
            storage: [type: :mod_arg, required: true],
            chunk_bytes_threshold: [type: :non_neg_integer, required: true],
            inspector: [type: :mod_arg, required: true],
            shape_status: [type: :atom, default: Electric.ShapeCache.ShapeStatus],
            registry: [type: {:or, [:atom, :pid]}, required: true],
            db_pool: [type: {:or, [:atom, :pid]}, default: Electric.DbPool],
            run_with_conn_fn: [type: {:fun, 2}, default: &DBConnection.run/2],
            prepare_tables_fn: [type: {:or, [:mfa, {:fun, 2}]}, required: true],
            create_snapshot_fn: [
              type: {:fun, 5},
              default: &Shapes.Consumer.Snapshotter.query_in_readonly_txn/5
            ]
          )

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      GenServer.start_link(__MODULE__, Map.new(opts), name: opts[:name])
    end
  end

  @impl Electric.ShapeCacheBehaviour
  def get_shape(shape, opts \\ []) do
    table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)
    shape_status = Access.get(opts, :shape_status, ShapeStatus)
    shape_status.get_existing_shape(table, shape)
  end

  @impl Electric.ShapeCacheBehaviour
  def get_or_create_shape_id(shape, opts \\ []) do
    # Get or create the shape ID and fire a snapshot if necessary
    if shape_state = get_shape(shape, opts) do
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
    shape_status = Access.get(opts, :shape_status, ShapeStatus)

    if shape_status.set_latest_offset(meta_table, shape_id, latest_offset) do
      :ok
    else
      Logger.warning("Tried to update latest offset for shape #{shape_id} which doesn't exist")
      :error
    end
  end

  @impl Electric.ShapeCacheBehaviour
  @spec list_shapes(Electric.ShapeCache.ShapeStatus.t()) :: [{shape_id(), Shape.t()}]
  def list_shapes(opts) do
    shape_status = Access.get(opts, :shape_status, ShapeStatus)
    shape_status.list_shapes(opts)
  end

  @impl Electric.ShapeCacheBehaviour
  @spec get_relation(Messages.relation_id(), opts :: keyword()) :: Changes.Relation.t() | nil
  def get_relation(relation_id, opts) do
    meta_table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)
    shape_status = Access.get(opts, :shape_status, ShapeStatus)
    shape_status.get_relation(meta_table, relation_id)
  end

  @impl Electric.ShapeCacheBehaviour
  @spec clean_shape(shape_id(), keyword()) :: :ok
  def clean_shape(shape_id, opts) do
    server = Access.get(opts, :server, __MODULE__)
    GenServer.call(server, {:clean, shape_id})
  end

  @impl Electric.ShapeCacheBehaviour
  @spec clean_all_shapes(keyword()) :: :ok
  def clean_all_shapes(opts) do
    server = Access.get(opts, :server, __MODULE__)
    GenServer.call(server, {:clean_all})
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
    shape_status = Access.get(opts, :shape_status, ShapeStatus)
    electric_instance_id = Access.fetch!(opts, :electric_instance_id)

    cond do
      shape_status.snapshot_started?(table, shape_id) ->
        :started

      !shape_status.get_existing_shape(table, shape_id) ->
        {:error, :unknown}

      true ->
        server = Electric.Shapes.Consumer.name(electric_instance_id, shape_id)
        GenServer.call(server, :await_snapshot_start)
    end
  end

  @impl Electric.ShapeCacheBehaviour
  def has_shape?(shape_id, opts \\ []) do
    table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)
    shape_status = Access.get(opts, :shape_status, ShapeStatus)

    if shape_status.get_existing_shape(table, shape_id) do
      true
    else
      server = Access.get(opts, :server, __MODULE__)
      GenServer.call(server, {:wait_shape_id, shape_id})
    end
  end

  @impl GenServer
  def init(opts) do
    {:ok, persistent_state} =
      opts.shape_status.initialise(
        shape_meta_table: opts.shape_meta_table,
        storage: opts.storage
      )

    state = %{
      name: opts.name,
      electric_instance_id: opts.electric_instance_id,
      storage: opts.storage,
      chunk_bytes_threshold: opts.chunk_bytes_threshold,
      inspector: opts.inspector,
      shape_meta_table: opts.shape_meta_table,
      shape_status: opts.shape_status,
      db_pool: opts.db_pool,
      persistent_state: persistent_state,
      run_with_conn_fn: opts.run_with_conn_fn,
      create_snapshot_fn: opts.create_snapshot_fn,
      prepare_tables_fn: opts.prepare_tables_fn,
      log_producer: opts.log_producer,
      registry: opts.registry,
      consumer_supervisor: opts.consumer_supervisor,
      subscription: nil
    }

    recover_shapes(state)

    {:ok, state}
  end

  @impl GenServer
  def handle_call({:create_or_wait_shape_id, shape}, _from, %{shape_status: shape_status} = state) do
    {{shape_id, latest_offset}, state} =
      if shape_state = shape_status.get_existing_shape(state.persistent_state, shape) do
        {shape_state, state}
      else
        {:ok, shape_id} = shape_status.add_shape(state.persistent_state, shape)

        {:ok, _pid, _snapshot_xmin, latest_offset} = start_shape(shape_id, shape, state)
        {{shape_id, latest_offset}, state}
      end

    Logger.debug("Returning shape id #{shape_id} for shape #{inspect(shape)}")

    {:reply, {shape_id, latest_offset}, state}
  end

  def handle_call({:wait_shape_id, shape_id}, _from, %{shape_status: shape_status} = state) do
    {:reply, !is_nil(shape_status.get_existing_shape(state.persistent_state, shape_id)), state}
  end

  def handle_call({:truncate, shape_id}, _from, state) do
    with :ok <- clean_up_shape(state, shape_id) do
      Logger.info("Truncating and rotating shape id, previous shape id #{shape_id} cleaned up")
    end

    {:reply, :ok, state}
  end

  def handle_call({:clean, shape_id}, _from, state) do
    # ignore errors when cleaning up non-existant shape id
    with :ok <- clean_up_shape(state, shape_id) do
      Logger.info("Cleaning up shape #{shape_id}")
    end

    {:reply, :ok, state}
  end

  def handle_call({:clean_all}, _from, state) do
    Logger.info("Cleaning up all shapes")
    clean_up_all_shapes(state)
    {:reply, :ok, state}
  end

  defp clean_up_shape(state, shape_id) do
    Electric.Shapes.ConsumerSupervisor.stop_shape_consumer(
      state.consumer_supervisor,
      state.electric_instance_id,
      shape_id
    )

    :ok
  end

  defp clean_up_all_shapes(state) do
    shape_ids =
      state.persistent_state |> state.shape_status.list_shapes() |> Enum.map(&elem(&1, 0))

    for shape_id <- shape_ids do
      clean_up_shape(state, shape_id)
    end
  end

  defp recover_shapes(state) do
    state.persistent_state
    |> state.shape_status.list_shapes()
    |> Enum.each(fn {shape_id, shape} ->
      {:ok, _pid, _snapshot_xmin, _latest_offset} = start_shape(shape_id, shape, state)
    end)
  end

  defp start_shape(shape_id, shape, state) do
    with {:ok, pid} <-
           Electric.Shapes.ConsumerSupervisor.start_shape_consumer(
             state.consumer_supervisor,
             electric_instance_id: state.electric_instance_id,
             inspector: state.inspector,
             shape_id: shape_id,
             shape: shape,
             shape_status: {state.shape_status, state.persistent_state},
             storage: state.storage,
             chunk_bytes_threshold: state.chunk_bytes_threshold,
             log_producer: state.log_producer,
             shape_cache:
               {__MODULE__, %{server: state.name, shape_meta_table: state.shape_meta_table}},
             registry: state.registry,
             db_pool: state.db_pool,
             run_with_conn_fn: state.run_with_conn_fn,
             prepare_tables_fn: state.prepare_tables_fn,
             create_snapshot_fn: state.create_snapshot_fn
           ) do
      consumer = Shapes.Consumer.name(state.electric_instance_id, shape_id)

      {:ok, snapshot_xmin, latest_offset} = Shapes.Consumer.initial_state(consumer)

      {:ok, pid, snapshot_xmin, latest_offset}
    end
  end
end
