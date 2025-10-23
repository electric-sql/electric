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
  @callback fetch_shape_by_handle(shape_handle(), opts :: Access.t()) :: {:ok, Shape.t()} | :error
  @callback get_or_create_shape_handle(shape_def(), opts :: Access.t()) ::
              {shape_handle(), current_snapshot_offset :: LogOffset.t()}
  @callback list_shapes(keyword() | map()) :: [{shape_handle(), Shape.t()}] | :error
  @callback count_shapes(keyword() | map()) :: non_neg_integer() | :error
  @callback await_snapshot_start(shape_handle(), opts :: Access.t()) ::
              :started | {:error, term()}
  @callback has_shape?(shape_handle(), Access.t()) :: boolean()
  @callback start_consumer_for_handle(shape_handle(), Access.t()) ::
              {:ok, pid()} | {:error, :no_shape}
  @callback clean_shape(shape_handle(), Access.t()) :: :ok
end

defmodule Electric.ShapeCache do
  use GenServer

  alias Electric.Postgres.Lsn
  alias Electric.Replication.LogOffset
  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.ShapeCache
  alias Electric.Shapes
  alias Electric.ShapeCache.ShapeCleaner
  alias Electric.Shapes.Shape

  require Logger

  @behaviour Electric.ShapeCacheBehaviour

  @type shape_handle :: Electric.ShapeCacheBehaviour.shape_handle()
  @type shape_def() :: Electric.ShapeCacheBehaviour.shape_def()

  @name_schema_tuple {:tuple, [:atom, :atom, :any]}
  @genserver_name_schema {:or, [:atom, @name_schema_tuple]}
  @schema NimbleOptions.new!(
            name: [
              type: @genserver_name_schema,
              required: false
            ],
            stack_id: [type: :string, required: true],
            consumer_supervisor: [type: @genserver_name_schema, required: true],
            inspector: [type: :mod_arg, required: true]
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
      GenServer.start_link(__MODULE__, [name: name] ++ opts, name: name)
    end
  end

  @impl Electric.ShapeCacheBehaviour
  def get_shape(shape, opts \\ []) do
    table = ShapeStatus.shape_meta_table(opts)
    ShapeStatus.get_existing_shape(table, shape)
  end

  @impl Electric.ShapeCacheBehaviour
  def fetch_shape_by_handle(handle, opts) do
    table = ShapeStatus.shape_meta_table(opts)
    ShapeStatus.fetch_shape_by_handle(table, handle)
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
          Electric.Shapes.Consumer.await_snapshot_start(stack_id, shape_handle, 15_000)
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

  @impl Electric.ShapeCacheBehaviour
  def start_consumer_for_handle(shape_handle, opts) when is_binary(shape_handle) do
    server = Access.get(opts, :server, name(opts))
    GenServer.call(server, {:start_consumer_for_handle, shape_handle}, @call_timeout)
  end

  @impl GenServer
  def init(opts) do
    activate_mocked_functions_from_test_process()

    opts = Map.new(opts)

    stack_id = opts.stack_id

    Process.set_label({:shape_cache, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    state = %{
      name: opts.name,
      stack_id: stack_id,
      inspector: opts.inspector,
      consumer_supervisor: opts.consumer_supervisor,
      subscription: nil
    }

    {:ok, state, {:continue, :recover_shapes}}
  end

  @impl GenServer
  def handle_continue(:recover_shapes, state) do
    {last_processed_lsn, total_recovered, total_failed_to_recover} = recover_shapes(state)

    Electric.Replication.PublicationManager.wait_for_restore(stack_id: state.stack_id)

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
    # This is racy: it's possible for a shape to have been deleted while the
    # ShapeLogCollector is processing a transaction that includes it
    # In this case fetch_shape_by_handle returns an error. ConsumerRegistry
    # basically ignores the {:error, :no_shape} result - excluding the shape handle
    # from the broadcast.
    case ShapeStatus.fetch_shape_by_handle(state.stack_id, shape_handle) do
      {:ok, shape} ->
        # TODO: otel ctx from shape log collector?
        {
          :reply,
          restore_shape_and_dependencies(shape_handle, shape, state, nil),
          state
        }

      :error ->
        {:reply, {:error, :no_shape}, state}
    end
  end

  defp recover_shapes(%{stack_id: stack_id} = _state) do
    import Electric.Postgres.Lsn, only: [is_larger: 2]

    start_time = System.monotonic_time()
    storage = ShapeCache.Storage.for_stack(stack_id)
    all_handles_and_shapes = ShapeStatus.list_shapes(stack_id)

    {max_lsn, total_recovered} =
      all_handles_and_shapes
      |> Task.async_stream(
        fn {shape_handle, shape} ->
          shape_storage = ShapeCache.Storage.for_shape(shape_handle, storage)

          case ShapeCache.Storage.get_current_position(shape_storage) do
            {:ok, latest_offset, _pg_snapshot} ->
              {shape_handle, LogOffset.extract_lsn(latest_offset)}

            {:error, reason} ->
              Logger.error([
                "shape #{inspect(shape)} (#{inspect(shape_handle)})",
                " returned error from get_current_position: #{inspect(reason)}"
              ])

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

    total_failed_to_recover = length(all_handles_and_shapes) - total_recovered

    duration = System.monotonic_time() - start_time

    Logger.info([
      "Restored LSN position #{max_lsn} in",
      " #{System.convert_time_unit(duration, :native, :millisecond)}ms",
      " (#{total_recovered} shapes, #{total_failed_to_recover} failed to recover)"
    ])

    {max_lsn, total_recovered, total_failed_to_recover}
  end

  defp maybe_create_shape(shape, otel_ctx, %{stack_id: stack_id} = state) do
    if shape_state = ShapeStatus.get_existing_shape(stack_id, shape) do
      shape_state
    else
      shape_handles =
        shape.shape_dependencies
        |> Enum.map(&maybe_create_shape(&1, otel_ctx, state))
        |> Enum.map(&elem(&1, 0))

      shape = %{shape | shape_dependencies_handles: shape_handles}

      {:ok, shape_handle} = ShapeStatus.add_shape(stack_id, shape)

      Logger.info("Creating new shape for #{inspect(shape)} with handle #{shape_handle}")

      {:ok, _pid} = start_shape(shape_handle, shape, state, otel_ctx, :create)

      # In this branch of `if`, we're guaranteed to have a newly started shape, so we can be sure about it's
      # "latest offset" because it'll be in the snapshotting stage
      {shape_handle, LogOffset.last_before_real_offsets()}
    end
  end

  defp start_shape(shape_handle, shape, state, otel_ctx, action) do
    %{stack_id: stack_id} = state

    Enum.zip(shape.shape_dependencies_handles, shape.shape_dependencies)
    |> Enum.with_index(fn {shape_handle, inner_shape}, index ->
      materialized_type =
        shape.where.used_refs |> Map.fetch!(["$sublink", Integer.to_string(index)])

      Shapes.DynamicConsumerSupervisor.start_materializer(state.consumer_supervisor, %{
        stack_id: stack_id,
        shape_handle: shape_handle,
        storage: ShapeCache.Storage.for_stack(stack_id),
        columns: inner_shape.explicitly_selected_columns,
        materialized_type: materialized_type
      })
    end)

    case Shapes.DynamicConsumerSupervisor.start_shape_consumer(
           state.consumer_supervisor,
           %{
             stack_id: stack_id,
             shape_handle: shape_handle,
             otel_ctx: otel_ctx,
             consumer_supervisor: state.consumer_supervisor,
             action: action
           }
         ) do
      {:ok, consumer_pid} ->
        {:ok, consumer_pid}

      {:error, _reason} = error ->
        Logger.error("Failed to start shape #{shape_handle}: #{inspect(error)}")
        # purge because we know the consumer isn't running
        ShapeCleaner.remove_shape(shape_handle, stack_id: stack_id)
        :error
    end
  end

  # start_shape assumes that any dependent shapes already have running consumers
  # so we need to start those. this may be something we can do lazily: i.e.
  # only starting dependent shapes when they receive a write
  defp restore_shape_and_dependencies(shape_handle, shape, state, otel_ctx) do
    [{shape_handle, shape}]
    |> build_shape_dependencies(MapSet.new())
    |> elem(0)
    |> Enum.reduce_while({:ok, %{}}, fn {handle, shape}, {:ok, acc} ->
      case Electric.Shapes.ConsumerRegistry.whereis(state.stack_id, handle) do
        nil ->
          case start_shape(handle, shape, state, otel_ctx, :restore) do
            {:ok, pid} ->
              {:cont, {:ok, Map.put(acc, handle, pid)}}

            :error ->
              {:halt, {:error, handle}}
          end

        pid when is_pid(pid) ->
          {:cont, {:ok, Map.put(acc, handle, pid)}}
      end
    end)
    |> case do
      {:ok, handles} ->
        {:ok, Map.fetch!(handles, shape_handle)}

      {:error, failed_handle} ->
        if failed_handle != shape_handle do
          Logger.warning(
            "Failed to start consumer for handle #{shape_handle}: error starting consumer for inner shape #{failed_handle}"
          )

          # If we got an error starting any of the dependent shapes then we
          # remove the outer shape too
          ShapeCleaner.remove_shape(shape_handle, stack_id: state.stack_id)
        end

        {:error, "Failed to start consumer for #{shape_handle}"}
    end
  end

  @spec build_shape_dependencies([{shape_handle(), shape_def()}], MapSet.t()) ::
          {[
             {shape_handle(), shape_def()}
           ], MapSet.t()}

  defp build_shape_dependencies([], known) do
    {[], known}
  end

  defp build_shape_dependencies([{handle, shape} | rest], known) do
    {siblings, known} = build_shape_dependencies(rest, MapSet.put(known, handle))

    {descendents, known} =
      Enum.zip(shape.shape_dependencies_handles, shape.shape_dependencies)
      |> Enum.reject(fn {handle, _shape} -> MapSet.member?(known, handle) end)
      |> build_shape_dependencies(known)

    {descendents ++ [{handle, shape} | siblings], known}
  end

  if Mix.env() == :test do
    def activate_mocked_functions_from_test_process do
      Support.TestUtils.activate_mocked_functions_for_module(__MODULE__)
    end
  else
    def activate_mocked_functions_from_test_process, do: :noop
  end
end
