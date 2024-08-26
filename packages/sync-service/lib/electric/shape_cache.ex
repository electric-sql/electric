defmodule Electric.ShapeCacheBehaviour do
  @moduledoc """
  Behaviour defining the ShapeCache functions to be used in mocks
  """
  alias Electric.Shapes.Shape
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset

  @type shape_id :: String.t()
  @type shape_def :: Shape.t()
  @type xmin :: non_neg_integer()

  @doc "Update a shape's status with a new log offset"
  @callback update_shape_latest_offset(shape_id(), LogOffset.t(), keyword()) :: :ok

  @callback get_or_create_shape_id(shape_def(), opts :: keyword()) ::
              {shape_id(), current_snapshot_offset :: LogOffset.t()}

  @callback list_active_shapes(opts :: keyword()) :: [{shape_id(), shape_def(), xmin()}]
  @callback await_snapshot_start(shape_id(), opts :: keyword()) :: :started | {:error, term()}
  @callback handle_truncate(shape_id(), keyword()) :: :ok
  @callback clean_shape(shape_id(), keyword()) :: :ok
  @callback has_shape?(shape_id(), keyword()) :: boolean()
  @callback cast(term(), keyword()) :: :ok
end

defmodule Electric.ShapeCache do
  use GenStage

  alias Electric.Replication.Changes
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
      GenStage.start_link(__MODULE__, Map.new(opts), name: opts[:name])
    end
  end

  @impl Electric.ShapeCacheBehaviour
  def cast(message, opts) do
    server = Access.get(opts, :server, __MODULE__)
    GenStage.cast(server, message)
  end

  @impl Electric.ShapeCacheBehaviour
  def get_or_create_shape_id(shape, opts \\ []) do
    table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)

    # Get or create the shape ID and fire a snapshot if necessary
    if shape_state = ShapeStatus.existing_shape(table, shape) do
      shape_state
    else
      server = Access.get(opts, :server, __MODULE__)
      GenStage.call(server, {:create_or_wait_shape_id, shape})
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

  @spec get_relation(Messages.relation_id(), opts :: keyword()) :: Changes.Relation.t() | nil
  def get_relation(relation_id, opts) do
    meta_table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)
    ShapeStatus.get_relation(meta_table, relation_id)
  end

  @impl Electric.ShapeCacheBehaviour
  @spec clean_shape(shape_id(), keyword()) :: :ok
  def clean_shape(shape_id, opts) do
    server = Access.get(opts, :server, __MODULE__)
    GenStage.call(server, {:clean, shape_id})
  end

  @impl Electric.ShapeCacheBehaviour
  @spec handle_truncate(shape_id(), keyword()) :: :ok
  def handle_truncate(shape_id, opts \\ []) do
    server = Access.get(opts, :server, __MODULE__)
    GenStage.call(server, {:truncate, shape_id})
  end

  @impl Electric.ShapeCacheBehaviour
  @spec await_snapshot_start(shape_id(), keyword()) :: :started | {:error, term()}
  def await_snapshot_start(shape_id, opts \\ []) when is_binary(shape_id) do
    table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)

    if ShapeStatus.snapshot_xmin?(table, shape_id) do
      :started
    else
      server = Access.get(opts, :server, __MODULE__)
      GenStage.call(server, {:await_snapshot_start, shape_id})
    end
  end

  @impl Electric.ShapeCacheBehaviour
  def has_shape?(shape_id, opts \\ []) do
    table = Access.get(opts, :shape_meta_table, @default_shape_meta_table)

    if ShapeStatus.existing_shape(table, shape_id) do
      true
    else
      server = Access.get(opts, :server, __MODULE__)
      GenStage.call(server, {:wait_shape_id, shape_id})
    end
  end

  @impl GenStage
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

    {:consumer, state,
     subscribe_to: [{opts.log_producer, selector: &is_struct(&1, Changes.Relation)}]}
  end

  @impl GenStage
  def handle_events(relations, _from, state) do
    %{persistent_state: persistent_state} = state
    # NOTE: [@magnetised] this manages cleaning up shapes after a relation
    # change. it's not doing it in a consistent way, as the shape consumers
    # could still be receiving txns after a relation message that requires them
    # to terminate.
    #
    # if we decide this is a problem, then a potential solution is to pass the
    # relation messages to the shape consumers (who currently filter them out)
    # and have a relation message act as a block on the shape.
    #
    # 1. the shape consumer receives a relation message, stores it as some
    #    block value then starts buffering data.
    # 2. this process receives the same relation message, kills any shapes that
    #    are affected then sends some `{:resume, %Relation{}}` message to all
    #    living shape consumers.
    # 3. shape consumers blocked on the relation then continue.
    #
    # If the shape consumer receives the `resume` message before the relation
    # message then it adds the `%Relation{}` to some set of allowable
    # relations, then when it receives the relation message through the
    # replication stream, it knows that it can just continue.

    Enum.each(relations, fn relation ->
      old_rel = ShapeStatus.get_relation(persistent_state, relation.id)

      if is_nil(old_rel) || old_rel != relation do
        :ok = ShapeStatus.store_relation(persistent_state, relation)
      end

      if !is_nil(old_rel) && old_rel != relation do
        Logger.info("Schema for the table #{old_rel.schema}.#{old_rel.table} changed")

        change = %Changes.RelationChange{old_relation: old_rel, new_relation: relation}

        # Fetch all shapes that are affected by the relation change and clean them up
        persistent_state
        |> ShapeStatus.list_active_shapes()
        |> Enum.filter(&Shape.is_affected_by_relation_change?(&1, change))
        |> Enum.map(&elem(&1, 0))
        |> Enum.each(fn shape_id -> clean_up_shape(state, shape_id) end)
      end
    end)

    {:noreply, [], state}
  end

  @impl GenStage
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

    {:reply, {shape_id, latest_offset}, [], state}
  end

  def handle_call({:await_snapshot_start, shape_id}, from, state) do
    cond do
      not is_known_shape_id?(state, shape_id) ->
        {:reply, {:error, :unknown}, [], state}

      ShapeStatus.snapshot_xmin?(state.persistent_state, shape_id) ->
        {:reply, :started, [], state}

      true ->
        Logger.debug("Starting a wait on the snapshot #{shape_id} for #{inspect(from)}}")

        {:noreply, [], add_waiter(state, shape_id, from)}
    end
  end

  def handle_call({:wait_shape_id, shape_id}, _from, state) do
    {:reply, !is_nil(ShapeStatus.existing_shape(state.persistent_state, shape_id)), [], state}
  end

  def handle_call({:truncate, shape_id}, _from, state) do
    with {:ok, cleaned_up_shape} <- clean_up_shape(state, shape_id) do
      Logger.info(
        "Truncating and rotating shape id, previous shape id #{shape_id}, definition: #{inspect(cleaned_up_shape)}"
      )
    end

    {:reply, :ok, [], state}
  end

  def handle_call({:clean, shape_id}, _from, state) do
    # ignore errors when cleaning up non-existant shape id
    with {:ok, cleaned_up_shape} <- clean_up_shape(state, shape_id) do
      Logger.info("Cleaning up shape #{shape_id}, definition: #{inspect(cleaned_up_shape)}")
    end

    {:reply, :ok, [], state}
  end

  @impl GenStage
  def handle_cast({:snapshot_xmin_known, shape_id, xmin}, state) do
    unless ShapeStatus.set_snapshot_xmin(state.persistent_state, shape_id, xmin) do
      Logger.warning(
        "Got snapshot information for a #{shape_id}, that shape id is no longer valid. Ignoring."
      )
    end

    {:noreply, [], state}
  end

  def handle_cast({:snapshot_started, shape_id}, state) do
    Logger.debug("Snapshot for #{shape_id} is ready")
    {waiting, state} = pop_in(state, [:awaiting_snapshot_start, shape_id])
    for client <- List.wrap(waiting), not is_nil(client), do: GenStage.reply(client, :started)
    {:noreply, [], state}
  end

  def handle_cast({:snapshot_failed, shape_id, error, stacktrace}, state) do
    Logger.error(
      "Snapshot creation failed for #{shape_id} because of:\n#{Exception.format(:error, error, stacktrace)}"
    )

    clean_up_shape(state, shape_id)
    {waiting, state} = pop_in(state, [:awaiting_snapshot_start, shape_id])

    # waiting may nil here if :snapshot_failed happens after :snapshot_started
    if waiting do
      for client <- waiting, not is_nil(client), do: GenStage.reply(client, {:error, error})
    end

    {:noreply, [], state}
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
end
