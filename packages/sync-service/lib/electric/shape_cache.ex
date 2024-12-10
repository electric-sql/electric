defmodule Electric.ShapeCacheBehaviour do
  @moduledoc """
  Behaviour defining the ShapeCache functions to be used in mocks
  """
  alias Electric.Shapes.Shape
  alias Electric.Replication.LogOffset

  @type shape_handle :: String.t()
  @type shape_def :: Shape.t()
  @type xmin :: non_neg_integer()

  @doc "Update a shape's status with a new log offset"
  @callback update_shape_latest_offset(shape_handle(), LogOffset.t(), keyword()) :: :ok

  @callback get_shape(shape_def(), opts :: keyword()) ::
              {shape_handle(), current_snapshot_offset :: LogOffset.t()} | nil
  @callback get_or_create_shape_handle(shape_def(), opts :: keyword()) ::
              {shape_handle(), current_snapshot_offset :: LogOffset.t()}
  @callback list_shapes(keyword() | map()) :: [{shape_handle(), Shape.t()}]
  @callback await_snapshot_start(shape_handle(), opts :: keyword()) :: :started | {:error, term()}
  @callback handle_truncate(shape_handle(), keyword()) :: :ok
  @callback clean_shape(shape_handle(), keyword()) :: :ok
  @callback clean_all_shapes(keyword()) :: :ok
  @callback has_shape?(shape_handle(), keyword()) :: boolean()
end

defmodule Electric.ShapeCache do
  use GenServer

  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes
  alias Electric.Shapes.Shape

  require Logger

  @behaviour Electric.ShapeCacheBehaviour

  @type shape_handle :: Electric.ShapeCacheBehaviour.shape_handle()

  @name_schema_tuple {:tuple, [:atom, :atom, :any]}
  @genserver_name_schema {:or, [:atom, @name_schema_tuple]}
  @schema NimbleOptions.new!(
            name: [
              type: @genserver_name_schema,
              required: false
            ],
            stack_id: [type: :string, required: true],
            log_producer: [type: @genserver_name_schema, required: true],
            consumer_supervisor: [type: @genserver_name_schema, required: true],
            storage: [type: :mod_arg, required: true],
            chunk_bytes_threshold: [type: :non_neg_integer, required: true],
            inspector: [type: :mod_arg, required: true],
            shape_status: [type: :atom, default: Electric.ShapeCache.ShapeStatus],
            registry: [type: {:or, [:atom, :pid]}, required: true],
            db_pool: [type: {:or, [:atom, :pid, @name_schema_tuple]}],
            run_with_conn_fn: [
              type: {:fun, 2},
              default: &Shapes.Consumer.Snapshotter.run_with_conn/2
            ],
            prepare_tables_fn: [type: {:or, [:mfa, {:fun, 2}]}, required: true],
            create_snapshot_fn: [
              type: {:fun, 7},
              default: &Shapes.Consumer.Snapshotter.query_in_readonly_txn/7
            ],
            purge_all_shapes?: [type: :boolean, required: false]
          )

  def name(stack_id) when not is_map(stack_id) and not is_list(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def name(opts) do
    stack_id = Access.fetch!(opts, :stack_id)
    name(stack_id)
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      stack_id = Keyword.fetch!(opts, :stack_id)
      name = Keyword.get(opts, :name, name(stack_id))

      db_pool =
        Keyword.get(
          opts,
          :db_pool,
          Electric.ProcessRegistry.name(stack_id, Electric.DbPool)
        )

      GenServer.start_link(
        __MODULE__,
        Map.new(opts) |> Map.put(:db_pool, db_pool) |> Map.put(:name, name),
        name: name
      )
    end
  end

  @impl Electric.ShapeCacheBehaviour
  def get_shape(shape, opts \\ []) do
    table = get_shape_meta_table(opts)
    shape_status = Access.get(opts, :shape_status, ShapeStatus)
    shape_status.get_existing_shape(table, shape)
  end

  @impl Electric.ShapeCacheBehaviour
  def get_or_create_shape_handle(shape, opts \\ []) do
    # Get or create the shape handle and fire a snapshot if necessary
    if shape_state = get_shape(shape, opts) do
      shape_state
    else
      server = Access.get(opts, :server, name(opts))
      GenStage.call(server, {:create_or_wait_shape_handle, shape})
    end
  end

  @impl Electric.ShapeCacheBehaviour
  @spec update_shape_latest_offset(shape_handle(), LogOffset.t(), opts :: keyword()) ::
          :ok | {:error, term()}
  def update_shape_latest_offset(shape_handle, latest_offset, opts) do
    meta_table = get_shape_meta_table(opts)
    shape_status = Access.get(opts, :shape_status, ShapeStatus)

    if shape_status.set_latest_offset(meta_table, shape_handle, latest_offset) do
      :ok
    else
      Logger.warning(
        "Tried to update latest offset for shape #{shape_handle} which doesn't exist"
      )

      :error
    end
  end

  @impl Electric.ShapeCacheBehaviour
  @spec list_shapes(keyword()) :: [{shape_handle(), Shape.t()}]
  def list_shapes(opts) do
    shape_status = Access.get(opts, :shape_status, ShapeStatus)
    shape_status.list_shapes(%ShapeStatus{shape_meta_table: get_shape_meta_table(opts)})
  rescue
    ArgumentError -> []
  end

  @impl Electric.ShapeCacheBehaviour
  @spec clean_shape(shape_handle(), keyword()) :: :ok
  def clean_shape(shape_handle, opts) do
    server = Access.get(opts, :server, name(opts))
    GenStage.call(server, {:clean, shape_handle})
  end

  @impl Electric.ShapeCacheBehaviour
  @spec clean_all_shapes(keyword()) :: :ok
  def clean_all_shapes(opts) do
    server = Access.get(opts, :server, name(opts))
    GenServer.call(server, {:clean_all})
  end

  @impl Electric.ShapeCacheBehaviour
  @spec handle_truncate(shape_handle(), keyword()) :: :ok
  def handle_truncate(shape_handle, opts \\ []) do
    server = Access.get(opts, :server, name(opts))
    GenStage.call(server, {:truncate, shape_handle})
  end

  @impl Electric.ShapeCacheBehaviour
  @spec await_snapshot_start(shape_handle(), keyword()) :: :started | {:error, term()}
  def await_snapshot_start(shape_handle, opts \\ []) when is_binary(shape_handle) do
    table = get_shape_meta_table(opts)
    shape_status = Access.get(opts, :shape_status, ShapeStatus)
    stack_id = Access.fetch!(opts, :stack_id)

    cond do
      shape_status.snapshot_started?(table, shape_handle) ->
        :started

      !shape_status.get_existing_shape(table, shape_handle) ->
        {:error, :unknown}

      true ->
        server = Electric.Shapes.Consumer.name(stack_id, shape_handle)
        GenServer.call(server, :await_snapshot_start)
    end
  end

  @impl Electric.ShapeCacheBehaviour
  def has_shape?(shape_handle, opts \\ []) do
    table = get_shape_meta_table(opts)
    shape_status = Access.get(opts, :shape_status, ShapeStatus)

    if shape_status.get_existing_shape(table, shape_handle) do
      true
    else
      server = Access.get(opts, :server, name(opts))
      GenStage.call(server, {:wait_shape_handle, shape_handle})
    end
  end

  @impl GenServer
  def init(opts) do
    stack_id = opts[:stack_id]
    meta_table = :ets.new(:"#{stack_id}:shape_meta_table", [:named_table, :public, :ordered_set])

    Process.set_label({:shape_cache, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    {:ok, shape_status_state} =
      opts.shape_status.initialise(
        shape_meta_table: meta_table,
        storage: opts.storage
      )

    state = %{
      name: opts.name,
      stack_id: opts.stack_id,
      storage: opts.storage,
      chunk_bytes_threshold: opts.chunk_bytes_threshold,
      inspector: opts.inspector,
      shape_meta_table: meta_table,
      shape_status: opts.shape_status,
      db_pool: opts.db_pool,
      shape_status_state: shape_status_state,
      run_with_conn_fn: opts.run_with_conn_fn,
      create_snapshot_fn: opts.create_snapshot_fn,
      prepare_tables_fn: opts.prepare_tables_fn,
      log_producer: opts.log_producer,
      registry: opts.registry,
      consumer_supervisor: opts.consumer_supervisor,
      subscription: nil
    }

    if opts[:purge_all_shapes?] do
      clean_up_all_shapes(state)
    else
      recover_shapes(state)
    end

    # do this after finishing this function so that we're subscribed to the
    # producer before it starts forwarding its demand
    send(self(), :consumers_ready)

    {:ok, state}
  end

  @impl GenServer
  def handle_info(:consumers_ready, state) do
    :ok = GenStage.demand(state.log_producer, :forward)
    {:noreply, state}
  end

  @impl GenServer
  def handle_call(
        {:create_or_wait_shape_handle, shape},
        _from,
        %{shape_status: shape_status} = state
      ) do
    {{shape_handle, latest_offset}, state} =
      if shape_state = shape_status.get_existing_shape(state.shape_status_state, shape) do
        {shape_state, state}
      else
        {:ok, shape_handle} = shape_status.add_shape(state.shape_status_state, shape)

        {:ok, _pid, _snapshot_xmin, latest_offset} = start_shape(shape_handle, shape, state)
        {{shape_handle, latest_offset}, state}
      end

    Logger.debug("Returning shape id #{shape_handle} for shape #{inspect(shape)}")
    {:reply, {shape_handle, latest_offset}, state}
  end

  def handle_call(
        {:wait_shape_handle, shape_handle},
        _from,
        %{shape_status: shape_status} = state
      ) do
    {:reply, !is_nil(shape_status.get_existing_shape(state.shape_status_state, shape_handle)),
     state}
  end

  def handle_call({:truncate, shape_handle}, _from, state) do
    with :ok <- clean_up_shape(state, shape_handle) do
      Logger.info(
        "Truncating and rotating shape handle, previous shape handle #{shape_handle} cleaned up"
      )
    end

    {:reply, :ok, state}
  end

  def handle_call({:clean, shape_handle}, _from, state) do
    # ignore errors when cleaning up non-existant shape id
    with :ok <- clean_up_shape(state, shape_handle) do
      Logger.info("Cleaning up shape #{shape_handle}")
    end

    {:reply, :ok, state}
  end

  def handle_call({:clean_all}, _from, state) do
    Logger.info("Cleaning up all shapes")
    clean_up_all_shapes(state)
    {:reply, :ok, state}
  end

  defp clean_up_shape(state, shape_handle) do
    Electric.Shapes.DynamicConsumerSupervisor.stop_shape_consumer(
      state.consumer_supervisor,
      state.stack_id,
      shape_handle
    )

    :ok
  end

  defp clean_up_all_shapes(state) do
    shape_handles =
      state.shape_status_state |> state.shape_status.list_shapes() |> Enum.map(&elem(&1, 0))

    for shape_handle <- shape_handles do
      clean_up_shape(state, shape_handle)
    end
  end

  defp recover_shapes(state) do
    state.shape_status_state
    |> state.shape_status.list_shapes()
    |> Enum.each(fn {shape_handle, shape} ->
      try do
        {:ok, _pid, _snapshot_xmin, _latest_offset} = start_shape(shape_handle, shape, state)
      rescue
        e ->
          Logger.error("Failed to recover shape #{shape_handle}: #{inspect(e)}")

          # clean up corrupted data to avoid persisting bad state
          Electric.ShapeCache.Storage.for_shape(shape_handle, state.storage)
          |> Electric.ShapeCache.Storage.unsafe_cleanup!()
      end
    end)
  end

  defp start_shape(shape_handle, shape, state) do
    with {:ok, pid} <-
           Electric.Shapes.DynamicConsumerSupervisor.start_shape_consumer(
             state.consumer_supervisor,
             stack_id: state.stack_id,
             inspector: state.inspector,
             shape_handle: shape_handle,
             shape: shape,
             shape_status: {state.shape_status, state.shape_status_state},
             storage: state.storage,
             chunk_bytes_threshold: state.chunk_bytes_threshold,
             log_producer: state.log_producer,
             shape_cache:
               {__MODULE__,
                %{
                  server: state.name,
                  shape_meta_table: state.shape_meta_table,
                  stack_id: state.stack_id
                }},
             registry: state.registry,
             db_pool: state.db_pool,
             run_with_conn_fn: state.run_with_conn_fn,
             prepare_tables_fn: state.prepare_tables_fn,
             create_snapshot_fn: state.create_snapshot_fn
           ) do
      consumer = Shapes.Consumer.name(state.stack_id, shape_handle)

      {:ok, snapshot_xmin, latest_offset} = Shapes.Consumer.initial_state(consumer)

      {:ok, pid, snapshot_xmin, latest_offset}
    end
  end

  def get_shape_meta_table(opts),
    do: opts[:shape_meta_table] || :"#{opts[:stack_id]}:shape_meta_table"
end
