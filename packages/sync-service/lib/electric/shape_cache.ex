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
  @callback get_or_create_shape_handle(shape_def(), opts :: Access.t()) ::
              {shape_handle(), current_snapshot_offset :: LogOffset.t()}
  @callback list_shapes(keyword() | map()) :: [{shape_handle(), Shape.t()}] | :error
  @callback await_snapshot_start(shape_handle(), opts :: Access.t()) ::
              :started | {:error, term()}
  @callback clean_shape(shape_handle(), Access.t()) :: :ok
  @callback clean_all_shapes_for_relations(list(Electric.oid_relation()), opts :: Access.t()) ::
              :ok
  @callback clean_all_shapes(Access.t()) :: :ok
  @callback has_shape?(shape_handle(), Access.t()) :: boolean()
end

defmodule Electric.ShapeCache do
  use GenServer

  alias Electric.Postgres.Lsn
  alias Electric.Replication.LogOffset
  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry

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
            publication_manager: [type: :mod_arg, required: true],
            chunk_bytes_threshold: [type: :non_neg_integer, required: true],
            inspector: [type: :mod_arg, required: true],
            shape_status: [type: :atom, default: Electric.ShapeCache.ShapeStatus],
            registry: [type: {:or, [:atom, :pid]}, required: true],
            db_pool: [type: {:or, [:atom, :pid, @name_schema_tuple]}],
            run_with_conn_fn: [
              type: {:fun, 2},
              default: &Shapes.Consumer.Snapshotter.run_with_conn/2
            ],
            create_snapshot_fn: [
              type: {:fun, 7},
              default: &Shapes.Consumer.Snapshotter.query_in_readonly_txn/7
            ],
            purge_all_shapes?: [type: :boolean, required: false],
            max_shapes: [type: {:or, [:non_neg_integer, nil]}, default: nil],
            recover_shape_timeout: [
              type: {:or, [:non_neg_integer, {:in, [:infinity]}]},
              default: 5_000
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
      db_pool = Keyword.get(opts, :db_pool, Electric.Connection.Manager.pool_name(stack_id))

      GenServer.start_link(__MODULE__, [name: name, db_pool: db_pool] ++ opts, name: name)
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
      GenStage.call(server, {:create_or_wait_shape_handle, shape, opts[:otel_ctx]}, @call_timeout)
    end
  end

  @impl Electric.ShapeCacheBehaviour
  @spec list_shapes(Access.t()) :: [{shape_handle(), Shape.t()}] | :error
  def list_shapes(opts) do
    shape_status = Access.get(opts, :shape_status, ShapeStatus)
    shape_status.list_shapes(%ShapeStatus{shape_meta_table: get_shape_meta_table(opts)})
  rescue
    ArgumentError -> :error
  end

  @impl Electric.ShapeCacheBehaviour
  @spec clean_shape(shape_handle(), Access.t()) :: :ok
  def clean_shape(shape_handle, opts) do
    server = Access.get(opts, :server, name(opts))
    GenStage.call(server, {:clean, shape_handle}, @call_timeout)
  end

  @impl Electric.ShapeCacheBehaviour
  @spec clean_all_shapes(Access.t()) :: :ok
  def clean_all_shapes(opts) do
    server = Access.get(opts, :server, name(opts))
    GenServer.call(server, :clean_all_shapes)
  end

  @impl Electric.ShapeCacheBehaviour
  @spec clean_all_shapes_for_relations(list(Electric.oid_relation()), Access.t()) :: :ok
  def clean_all_shapes_for_relations(relations, opts) do
    server = Access.get(opts, :server, name(opts))
    # We don't want for this call to be blocking because it will be called in `PublicationManager`
    # if it notices a discrepancy in the schema
    GenServer.cast(server, {:clean_all_shapes_for_relations, relations})
  end

  @impl Electric.ShapeCacheBehaviour
  @spec await_snapshot_start(shape_handle(), Access.t()) :: :started | {:error, term()}
  def await_snapshot_start(shape_handle, opts \\ []) when is_binary(shape_handle) do
    table = get_shape_meta_table(opts)
    shape_status = Access.get(opts, :shape_status, ShapeStatus)
    stack_id = Access.fetch!(opts, :stack_id)

    shape_status.update_last_read_time_to_now(table, shape_handle)

    cond do
      shape_status.snapshot_started?(table, shape_handle) ->
        :started

      !shape_status.get_existing_shape(table, shape_handle) ->
        {:error, :unknown}

      true ->
        server = Electric.Shapes.Consumer.name(stack_id, shape_handle)

        try do
          GenServer.call(server, :await_snapshot_start, 15_000)
        catch
          :exit, {:timeout, {GenServer, :call, _}} ->
          # Please notes that this timeout is not due to the query taking too long. The Snapshotter
          # has it's own timeout and `await_snapshot_start/2` will return with a timeout error if the
          # query is too slow (over 5 seconds).
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
  end

  @impl Electric.ShapeCacheBehaviour
  def has_shape?(shape_handle, opts \\ []) do
    table = get_shape_meta_table(opts)
    shape_status = Access.get(opts, :shape_status, ShapeStatus)

    if shape_status.get_existing_shape(table, shape_handle) do
      true
    else
      server = Access.get(opts, :server, name(opts))
      GenStage.call(server, {:wait_shape_handle, shape_handle}, @call_timeout)
    end
  end

  @impl GenServer
  def init(opts) do
    opts = Map.new(opts)

    stack_id = opts.stack_id
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
      publication_manager: opts.publication_manager,
      chunk_bytes_threshold: opts.chunk_bytes_threshold,
      inspector: opts.inspector,
      shape_meta_table: meta_table,
      shape_status: opts.shape_status,
      db_pool: opts.db_pool,
      shape_status_state: shape_status_state,
      run_with_conn_fn: opts.run_with_conn_fn,
      create_snapshot_fn: opts.create_snapshot_fn,
      log_producer: opts.log_producer,
      registry: opts.registry,
      consumer_supervisor: opts.consumer_supervisor,
      subscription: nil,
      max_shapes: opts.max_shapes
    }

    last_processed_lsn =
      if opts[:purge_all_shapes?] do
        purge_all_shapes(state)
        Lsn.from_integer(0)
      else
        recover_shapes(state, opts.recover_shape_timeout)
      end

    # ensure publication filters are in line with existing shapes,
    # and clean up cache if publication fails to update
    {publication_manager, publication_manager_opts} = opts.publication_manager

    try do
      :ok = publication_manager.refresh_publication(publication_manager_opts)
    rescue
      error ->
        purge_all_shapes(state)
        reraise error, __STACKTRACE__
    catch
      :exit, reason ->
        purge_all_shapes(state)
        exit(reason)
    end

    # Let ShapeLogCollector that it can start processing after finishing this function so that
    # we're subscribed to the producer before it starts forwarding its demand.
    {:ok, state, {:continue, {:consumers_ready, last_processed_lsn}}}
  end

  @impl GenServer
  def handle_continue({:consumers_ready, last_processed_lsn}, state) do
    ShapeLogCollector.start_processing(state.log_producer, last_processed_lsn)
    {:noreply, state}
  end

  @impl GenServer
  def handle_info(:maybe_expire_shapes, state) do
    maybe_expire_shapes(state)
    {:noreply, state}
  end

  @impl GenServer
  def handle_call(
        {:create_or_wait_shape_handle, shape, otel_ctx},
        _from,
        %{shape_status: shape_status} = state
      ) do
    {{shape_handle, latest_offset}, state} =
      if shape_state = shape_status.get_existing_shape(state.shape_status_state, shape) do
        {shape_state, state}
      else
        {:ok, shape_handle} = shape_status.add_shape(state.shape_status_state, shape)

        {:ok, latest_offset} = start_shape(shape_handle, shape, state, otel_ctx)

        send(self(), :maybe_expire_shapes)
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

  def handle_call({:clean, shape_handle}, _from, state) do
    # ignore errors when cleaning up non-existant shape id
    with :ok <- clean_up_shape(state, shape_handle) do
      Logger.info("Cleaning up shape #{shape_handle}")
    end

    {:reply, :ok, state}
  end

  def handle_call(:clean_all_shapes, _from, state) do
    Logger.warning("Purging all shapes.")

    clean_up_all_shapes(state)

    {:reply, :ok, state}
  end

  @impl GenServer
  def handle_cast({:clean_all_shapes_for_relations, relations}, state) do
    affected_shapes =
      state.shape_status_state
      |> state.shape_status.list_shape_handles_for_relations(relations)

    if relations != [] do
      Logger.info(fn ->
        "Cleaning up all shapes for relations #{inspect(relations)}: #{length(affected_shapes)} shapes total"
      end)
    end

    Enum.each(affected_shapes, fn shape_handle ->
      clean_up_shape(state, shape_handle)
    end)

    {:noreply, state}
  end

  defp maybe_expire_shapes(%{max_shapes: max_shapes} = state) when max_shapes != nil do
    shape_count = shape_count(state)

    if shape_count > max_shapes do
      number_to_expire = shape_count - max_shapes

      state.shape_status_state
      |> state.shape_status.least_recently_used(number_to_expire)
      |> Enum.each(fn shape ->
        OpenTelemetry.with_span(
          "expiring_shape",
          [
            shape_handle: shape.shape_handle,
            max_shapes: max_shapes,
            shape_count: shape_count,
            elapsed_minutes_since_use: shape.elapsed_minutes_since_use
          ],
          fn ->
            Logger.info(
              "Expiring shape #{shape.shape_handle} as as the number of shapes " <>
                "has exceeded the limit (#{state.max_shapes})"
            )

            clean_up_shape(state, shape.shape_handle)
          end
        )
      end)
    end
  end

  defp maybe_expire_shapes(_), do: :ok

  defp shape_count(%{shape_status: shape_status, shape_status_state: shape_status_state}) do
    shape_status_state
    |> shape_status.list_shapes()
    |> length()
  end

  defp clean_up_shape(state, shape_handle) do
    # remove the shape immediately so new clients are redirected elsewhere
    deregister_shape(shape_handle, state)

    Electric.Shapes.DynamicConsumerSupervisor.stop_shape_consumer(
      state.consumer_supervisor,
      state.stack_id,
      shape_handle
    )

    :ok
  end

  # reset shape storage before any consumer have been started
  defp purge_all_shapes(state) do
    Logger.warning("Purging all shapes.")

    for {shape_handle, shape} <- shape_handles(state) do
      purge_shape(state, shape_handle, shape)
    end

    state
  end

  defp purge_shape(state, shape_handle, shape) do
    case Electric.Shapes.ConsumerSupervisor.stop_and_clean(state.stack_id, shape_handle) do
      :noproc ->
        # if the consumer isn't running then we can just delete things gratuitously
        :ok = Electric.Shapes.Monitor.purge_shape(state.stack_id, shape_handle, shape)

      :ok ->
        # if it is running then the stop_and_clean process will cleanup properly
        :ok
    end

    state
  end

  defp clean_up_all_shapes(state) do
    for {shape_handle, _shape} <- shape_handles(state) do
      clean_up_shape(state, shape_handle)
    end
  end

  defp shape_handles(state) do
    state.shape_status_state |> state.shape_status.list_shapes()
  end

  defp recover_shapes(state, timeout) do
    state.shape_status_state
    |> state.shape_status.list_shapes()
    |> Enum.flat_map(fn {shape_handle, shape} ->
      start_shape_with_timeout(shape_handle, shape, state, timeout)
    end)
    |> Lsn.max()
  end

  # the shape cache loads existing shapes within its init/1 callback
  # which is useful because we know that when the start_link call on the
  # stack completes the system is fully booted and all shape consumers are
  # running.
  #
  # rather than set a global timeout for the `init/1` function we leave the
  # `start_link/1` timeout as `:infinity` and instead have a timeout for every
  # shape
  defp start_shape_with_timeout(shape_handle, shape, state, timeout) do
    task = Task.async(fn -> start_and_recover_shape(shape_handle, shape, state) end)

    # since we catch errors in the task we don't need to handle the error state here
    case Task.yield(task, timeout) || Task.shutdown(task) do
      {:ok, lsn} ->
        lsn

      nil ->
        Logger.error(
          "shape #{inspect(shape)} (#{inspect(shape_handle)}) failed to start within #{timeout}ms"
        )

        purge_shape(state, shape_handle, shape)

        []
    end
  end

  defp start_and_recover_shape(shape_handle, shape, state) do
    %{publication_manager: {publication_manager, publication_manager_opts}} = state

    case start_shape(shape_handle, shape, state) do
      {:ok, latest_offset} ->
        publication_manager.recover_shape(shape_handle, shape, publication_manager_opts)
        [LogOffset.extract_lsn(latest_offset)]

      :error ->
        []
    end
  catch
    # exception can only come from the receover_shape call
    # if the shape consumer failed to start for some reason
    # start_shape/4 will have returned an error
    kind, reason when kind in [:exit, :error] ->
      Logger.error(
        "Failed to recover shape #{shape_handle}: #{Exception.format(kind, reason, __STACKTRACE__)}"
      )

      # clean up corrupted data to avoid persisting bad state
      purge_shape(state, shape_handle, shape)
      []
  end

  defp start_shape(shape_handle, shape, state, otel_ctx \\ nil) do
    case Electric.Shapes.DynamicConsumerSupervisor.start_shape_consumer(
           state.consumer_supervisor,
           stack_id: state.stack_id,
           inspector: state.inspector,
           shape_handle: shape_handle,
           shape: shape,
           shape_status: {state.shape_status, state.shape_status_state},
           storage: state.storage,
           publication_manager: state.publication_manager,
           chunk_bytes_threshold: state.chunk_bytes_threshold,
           log_producer: state.log_producer,
           registry: state.registry,
           db_pool: state.db_pool,
           run_with_conn_fn: state.run_with_conn_fn,
           create_snapshot_fn: state.create_snapshot_fn,
           otel_ctx: otel_ctx
         ) do
      {:ok, _supervisor_pid} ->
        consumer = Shapes.Consumer.name(state.stack_id, shape_handle)
        {:ok, _latest_offset} = Shapes.Consumer.initial_state(consumer)

      {:error, _reason} = error ->
        Logger.error("Failed to start shape #{shape_handle}: #{inspect(error)}")
        # purge because we know the consumer isn't running
        purge_shape(state, shape_handle, shape)
        :error
    end
  end

  defp deregister_shape(shape_handle, state) do
    state.shape_status.remove_shape(state.shape_status_state, shape_handle)
  end

  def get_shape_meta_table(opts),
    do: opts[:shape_meta_table] || :"#{opts[:stack_id]}:shape_meta_table"
end
