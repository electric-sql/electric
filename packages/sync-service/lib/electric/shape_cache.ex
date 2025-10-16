defmodule Electric.ShapeCacheBehaviour do
  @moduledoc """
  Behaviour defining the ShapeCache functions to be used in mocks
  """
  alias Electric.Shapes.Shape
  alias Electric.Replication.LogOffset

  @type shape_handle :: String.t()
  @type shape_def :: Shape.t()

  @callback get_shape(shape_def(), opts :: Access.t()) ::
              {shape_handle(), current_snapshot_offset :: LogOffset.t()} | nil
  @callback get_shape_by_handle(shape_handle(), opts :: Access.t()) ::  {:ok, Shape.t()} | {:error, term()}
  @callback get_or_create_shape_handle(shape_def(), opts :: Access.t()) ::
              {shape_handle(), current_snapshot_offset :: LogOffset.t()}
  @callback list_shapes(keyword() | map()) :: [{shape_handle(), Shape.t()}] | :error
  @callback count_shapes(keyword() | map()) :: non_neg_integer() | :error
  @callback await_snapshot_start(shape_handle(), opts :: Access.t()) ::
              :started | {:error, term()}
  @callback has_shape?(shape_handle(), Access.t()) :: boolean()
  @callback clean_shape(shape_handle(), Access.t()) :: :ok
end

defmodule Electric.ShapeCache do
  use GenServer

  alias Electric.Postgres.Lsn
  alias Electric.Replication.LogOffset
  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes
  alias Electric.Shapes.ConsumerSupervisor
  alias Electric.ShapeCache.ShapeCleaner
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
            consumer_supervisor: [type: @genserver_name_schema, required: true],
            storage: [type: :mod_arg, required: true],
            publication_manager: [type: :mod_arg, required: true],
            chunk_bytes_threshold: [type: :non_neg_integer, required: true],
            inspector: [type: :mod_arg, required: true],
            registry: [type: {:or, [:atom, :pid]}, required: true],
            db_pool: [type: {:or, [:atom, :pid, @name_schema_tuple]}],
            shape_hibernate_after: [
              type: :integer,
              default: Electric.Config.default(:shape_hibernate_after)
            ],
            snapshot_timeout_to_first_data: [
              type: {:or, [:non_neg_integer, {:in, [:infinity]}]},
              default: :timer.seconds(30)
            ]
          )

  # under load some of the storage functions, particularly the create calls,
  # can take a long time to complete (I've seen 20s locally, just due to minor
  # filesystem calls like `ls` taking multiple seconds). Most complete in a
  # timely manner but rather than raise for the edge cases and generate
  # unnecessary noise let's just cover those tail timings with our timeout.
  @call_timeout 30_000

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
          Electric.Connection.Manager.snapshot_pool(stack_id)
        )

      GenServer.start_link(__MODULE__, [name: name, db_pool: db_pool] ++ opts, name: name)
    end
  end

  @impl Electric.ShapeCacheBehaviour
  def get_shape(shape, opts \\ []) do
    table = ShapeStatus.shape_meta_table(opts)
    ShapeStatus.get_existing_shape(table, shape)
  end

  @impl Electric.ShapeCacheBehaviour
  def get_shape_by_handle(handle, opts) do
    table = ShapeStatus.shape_meta_table(opts)
    ShapeStatus.get_shape_by_handle(table, handle)
  end

  @impl Electric.ShapeCacheBehaviour
  def get_or_create_shape_handle(shape, opts \\ []) do
    # Get or create the shape handle and fire a snapshot if necessary
    if shape_state = get_shape(shape, opts) do
      shape_state
    else
      server = Access.get(opts, :server, name(opts))

      GenServer.call(
        server,
        {:create_or_wait_shape_handle, shape, opts[:otel_ctx]},
        @call_timeout
      )
    end
  end

  @impl Electric.ShapeCacheBehaviour
  @spec list_shapes(Access.t()) :: [{shape_handle(), Shape.t()}] | :error
  def list_shapes(opts) do
    table = ShapeStatus.shape_meta_table(opts)
    ShapeStatus.list_shapes(table)
  rescue
    ArgumentError -> :error
  end

  @impl Electric.ShapeCacheBehaviour
  @spec count_shapes(Access.t()) :: non_neg_integer() | :error
  def count_shapes(opts) do
    table = ShapeStatus.shape_last_used_table(opts)
    ShapeStatus.count_shapes(table)
  rescue
    ArgumentError -> :error
  end

  @impl Electric.ShapeCacheBehaviour
  @spec clean_shape(shape_handle(), Access.t()) :: :ok
  def clean_shape(shape_handle, opts) do
    ShapeCleaner.remove_shape(shape_handle, opts)
  end

  @impl Electric.ShapeCacheBehaviour
  @spec await_snapshot_start(shape_handle(), Access.t()) :: :started | {:error, term()}
  def await_snapshot_start(shape_handle, opts \\ []) when is_binary(shape_handle) do
    stack_id = Access.fetch!(opts, :stack_id)
    meta_table = ShapeStatus.shape_meta_table(stack_id)
    ShapeStatus.update_last_read_time_to_now(meta_table, shape_handle)

    cond do
      ShapeStatus.snapshot_started?(meta_table, shape_handle) ->
        :started

      !ShapeStatus.get_existing_shape(meta_table, shape_handle) ->
        {:error, :unknown}

      true ->
        try do
          Electric.Shapes.Consumer.await_snapshot_start(
            %{stack_id: stack_id, shape_handle: shape_handle},
            15_000
          )
        catch
          :exit, {:timeout, {GenServer, :call, _}} ->
            # Please note that :await_snapshot_start can also return a timeout error as well
            # as the call timing out and being handled here. A timeout error will be returned
            # by :await_snapshot_start if the PublicationManager queries take longer than 5 seconds.
            Logger.error("Failed to await snapshot start for shape #{shape_handle}: timeout")
            {:error, %RuntimeError{message: "Timed out while waiting for snapshot to start"}}

          :exit, {:noproc, _} ->
            # The fact that we got the shape handle means we know the shape exists, and the process should
            # exist too. We can get here if registry didn't propagate registration across partitions yet, so
            # we'll just retry after waiting for a short time to avoid busy waiting.
            Process.sleep(50)
            await_snapshot_start(shape_handle, opts)
        end
    end
  rescue
    ArgumentError ->
      {:error, %RuntimeError{message: "Shape meta tables not found"}}
  end

  @impl Electric.ShapeCacheBehaviour
  def has_shape?(shape_handle, opts \\ []) do
    table = ShapeStatus.shape_meta_table(opts)

    if ShapeStatus.get_existing_shape(table, shape_handle) do
      true
    else
      server = Access.get(opts, :server, name(opts))
      GenServer.call(server, {:wait_shape_handle, shape_handle}, @call_timeout)
    end
  end

  # this is race-condition free because it's only every called from the shape log collector
  # which processes each transaction in serial
  # and if it's calling this function then it knows that no consumer exists for the shape
  def start_consumer_for_handle(shape_handle, opts) when is_binary(shape_handle) do
    server = Access.get(opts, :server, name(opts))
    GenServer.call(server, {:start_consumer_for_handle, shape_handle}, @call_timeout)
  end

  @impl GenServer
  def init(opts) do
    opts = Map.new(opts)

    stack_id = opts.stack_id

    Process.set_label({:shape_cache, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    state = %{
      name: opts.name,
      stack_id: stack_id,
      storage: opts.storage,
      publication_manager: opts.publication_manager,
      chunk_bytes_threshold: opts.chunk_bytes_threshold,
      inspector: opts.inspector,
      db_pool: opts.db_pool,
      registry: opts.registry,
      consumer_supervisor: opts.consumer_supervisor,
      subscription: nil,
      shape_hibernate_after: opts.shape_hibernate_after,
      snapshot_timeout_to_first_data: opts.snapshot_timeout_to_first_data
    }

    {:ok, state, {:continue, :recover_shapes}}
  end

  @impl GenServer
  def handle_continue(:recover_shapes, state) do
    {last_processed_lsn, total_recovered, total_failed_to_recover} = recover_shapes(state)

    {pub_man, pub_man_opts} = state.publication_manager
    pub_man.wait_for_restore(pub_man_opts)

    # Let ShapeLogCollector that it can start processing after finishing this function so that
    # we're subscribed to the producer before it starts forwarding its demand.
    ShapeLogCollector.set_last_processed_lsn(state.stack_id, last_processed_lsn)

    Electric.Connection.Manager.consumers_ready(
      state.stack_id,
      total_recovered,
      total_failed_to_recover
    )

    {:noreply, state}
  end

  @impl GenServer
  def handle_call({:create_or_wait_shape_handle, shape, otel_ctx}, _from, state) do
    {shape_handle, latest_offset} = maybe_create_shape(shape, otel_ctx, state)
    Logger.debug("Returning shape id #{shape_handle} for shape #{inspect(shape)}")
    {:reply, {shape_handle, latest_offset}, state}
  end

  def handle_call({:wait_shape_handle, shape_handle}, _from, state) do
    {:reply, !is_nil(ShapeStatus.get_existing_shape(state.stack_id, shape_handle)), state}
  end

  def handle_call({:start_consumer_for_handle, shape_handle}, _from, state) do
    {:ok, shape} = ShapeStatus.get_shape_by_handle(state.stack_id, shape_handle)
    # TODO: otel ctx from shape log collector?
    {:ok, pid} = start_shape(shape_handle, shape, state, nil, :restore)
    {:reply, {:ok, pid}, state}
  end

  # Timeout is per-shape, not for the entire function
  defp recover_shapes(state) do
    import Electric.Postgres.Lsn, only: [is_larger: 2]

    start_time = System.monotonic_time()
    %{stack_id: stack_id, storage: storage} = state

    all_handles_and_shapes = ShapeStatus.list_shapes(state.stack_id)

    {max_lsn, total_recovered} =
      all_handles
      |> Task.async_stream(
        fn {shape_handle, shape} ->
          shape_storage = Electric.ShapeCache.Storage.for_shape(shape_handle, storage)

          # the ets may not have been serialised before the snapshot status is recorded
          # we used to rely on the consumer process to validate this but that doesn't
          # work if we're not starting them
          if Electric.ShapeCache.Storage.snapshot_started?(shape_storage),
            do: ShapeStatus.mark_snapshot_started(stack_id, shape_handle)

          case Electric.ShapeCache.Storage.get_current_position(shape_storage) do
            {:ok, latest_offset, _pg_snapshot} ->
              {shape_handle, LogOffset.extract_lsn(latest_offset)}

            {:error, reason} ->
              Logger.error(
                "shape #{inspect(shape)} (#{inspect(shape_handle)}) returned error from get_current_position: #{inspect(reason)}"
              )

              ShapeCleaner.remove_shape(shape_handle, stack_id: stack_id)

              {shape_handle, :error}
          end
        end,
        ordered: false
      )
      |> Enum.reduce({Lsn.from_integer(0), 0}, fn
        {:ok, {_handle, :error}}, acc -> acc
        {:ok, {_handle, lsn}}, {max, recovered} when is_larger(lsn, max) -> {lsn, recovered + 1}
        _, {max, recovered} -> {max, recovered + 1}
      end)

    total_failed_to_recover = length(all_handles) - total_recovered

    duration = System.monotonic_time() - start_time

    Logger.info(
      "Restored LSN position #{max_lsn} in #{System.convert_time_unit(duration, :native, :millisecond)}ms (#{total_recovered} shapes, #{total_failed_to_recover} failed to recover)"
    )

    {max_lsn, total_recovered, total_failed_to_recover}
  end

  defp maybe_create_shape(shape, otel_ctx, state) do
    if shape_state = ShapeStatus.get_existing_shape(state.stack_id, shape) do
      shape_state
    else
      shape_handles =
        shape.shape_dependencies
        |> Enum.map(&maybe_create_shape(&1, otel_ctx, state))
        |> Enum.map(&elem(&1, 0))

      shape = %{shape | shape_dependencies_handles: shape_handles}

      {:ok, shape_handle} = ShapeStatus.add_shape(state.stack_id, shape)

      Logger.info("Creating new shape for #{inspect(shape)} with handle #{shape_handle}")

      {:ok, _pid} = start_shape(shape_handle, shape, state, otel_ctx, :create)

      # In this branch of `if`, we're guaranteed to have a newly started shape, so we can be sure about it's
      # "latest offset" because it'll be in the snapshotting stage
      {shape_handle, LogOffset.last_before_real_offsets()}
    end
  end

  defp start_shape(shape_handle, shape, state, otel_ctx, action) do
    Enum.zip(shape.shape_dependencies_handles, shape.shape_dependencies)
    |> Enum.with_index(fn {shape_handle, inner_shape}, index ->
      materialized_type =
        shape.where.used_refs |> Map.fetch!(["$sublink", Integer.to_string(index)])

      ConsumerSupervisor.start_materializer(%{
        stack_id: state.stack_id,
        shape_handle: shape_handle,
        storage: state.storage,
        columns: inner_shape.explicitly_selected_columns,
        materialized_type: materialized_type
      })
    end)

    case Shapes.DynamicConsumerSupervisor.start_shape_consumer(
           state.consumer_supervisor,
           stack_id: state.stack_id,
           inspector: state.inspector,
           shape_handle: shape_handle,
           shape: shape,
           storage: state.storage,
           publication_manager: state.publication_manager,
           chunk_bytes_threshold: state.chunk_bytes_threshold,
           registry: state.registry,
           db_pool: state.db_pool,
           hibernate_after: state.shape_hibernate_after,
           otel_ctx: otel_ctx,
           snapshot_timeout_to_first_data: state.snapshot_timeout_to_first_data,
           action: action
         ) do
      {:ok, supervisor_pid} ->
        # TODO: we will just get the consumer pid when we simplify the consumer process tree
        consumer_pid =
          Enum.find_value(Supervisor.which_children(supervisor_pid), fn
            {Electric.Shapes.Consumer, pid, :worker, _modules} -> pid
            _child -> nil
          end)

        {:ok, consumer_pid}

      {:error, _reason} = error ->
        Logger.error("Failed to start shape #{shape_handle}: #{inspect(error)}")
        # purge because we know the consumer isn't running
        ShapeCleaner.remove_shape(shape_handle, stack_id: state.stack_id)
        :error
    end
  end

  @spec group_into_layers([{shape_handle(), Shape.t()}]) :: [[{shape_handle(), Shape.t()}], ...]
  defp group_into_layers(handles_and_shapes, acc \\ [], visited \\ MapSet.new())
  defp group_into_layers([], acc, _visited), do: Enum.reverse(acc)

  defp group_into_layers(handles_and_shapes, acc, visited) do
    {appendable, missing_deps} =
      Enum.split_with(handles_and_shapes, fn {_, shape} ->
        Enum.all?(shape.shape_dependencies_handles, &MapSet.member?(visited, &1))
      end)

    visited = MapSet.new(appendable, &elem(&1, 0)) |> MapSet.union(visited)

    group_into_layers(missing_deps, [appendable | acc], visited)
  end
end
