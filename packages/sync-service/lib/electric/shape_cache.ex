defmodule Electric.ShapeCache do
  use GenServer

  alias Electric.Replication.LogOffset
  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes
  alias Electric.ShapeCache.ShapeCleaner
  alias Electric.Shapes.Shape

  import Electric, only: [is_stack_id: 1, is_shape_handle: 1]

  require Logger

  @type stack_id :: Electric.stack_id()
  @type shape_handle :: Electric.shape_handle()
  @type shape_def :: Shape.t()
  @type handle_position :: {shape_handle(), current_snapshot_offset :: LogOffset.t()}

  @name_schema_tuple {:tuple, [:atom, :atom, :any]}
  @genserver_name_schema {:or, [:atom, @name_schema_tuple]}
  @schema NimbleOptions.new!(
            name: [
              type: @genserver_name_schema,
              required: false
            ],
            stack_id: [type: :string, required: true]
          )

  # under load some of the storage functions, particularly the create calls,
  # can take a long time to complete (I've seen 20s locally, just due to minor
  # filesystem calls like `ls` taking multiple seconds). Most complete in a
  # timely manner but rather than raise for the edge cases and generate
  # unnecessary noise let's just cover those tail timings with our timeout.
  @call_timeout 30_000

  @max_snapshot_start_attempts 10
  @snapshot_start_retry_sleep_ms 50

  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      stack_id = Keyword.fetch!(opts, :stack_id)
      name = Keyword.get(opts, :name, name(stack_id))
      GenServer.start_link(__MODULE__, [name: name] ++ opts, name: name)
    end
  end

  @spec fetch_handle_by_shape(shape_def(), stack_id()) :: {:ok, shape_handle()} | :error
  def fetch_handle_by_shape(%Shape{} = shape, stack_id) when is_stack_id(stack_id) do
    ShapeStatus.fetch_handle_by_shape(stack_id, shape)
  end

  @spec fetch_shape_by_handle(shape_handle(), stack_id()) :: {:ok, Shape.t()} | :error
  def fetch_shape_by_handle(handle, stack_id) when is_stack_id(stack_id) do
    ShapeStatus.fetch_shape_by_handle(stack_id, handle)
  end

  @spec get_or_create_shape_handle(shape_def(), stack_id(), opts :: Access.t()) ::
          handle_position()
  def get_or_create_shape_handle(shape, stack_id, opts \\ []) when is_stack_id(stack_id) do
    # Get or create the shape handle and fire a snapshot if necessary
    with {:ok, handle} <- fetch_handle_by_shape(shape, stack_id),
         {:ok, offset} <- fetch_latest_offset(stack_id, handle) do
      {handle, offset}
    else
      :error ->
        GenServer.call(
          name(stack_id),
          {:create_or_wait_shape_handle, shape, opts[:otel_ctx]},
          @call_timeout
        )
    end
  end

  @spec resolve_shape_handle(shape_handle(), shape_def(), stack_id()) :: handle_position() | nil
  def resolve_shape_handle(shape_handle, shape, stack_id) do
    # Ensure that the given shape handle matches the shape using a cheap shape
    # hash check.
    # If not (or the handle has gone/changed) then try a more expensive
    # `fetch_handle_by_shape/2` call to use the shape to lookup an existing handle.

    result =
      if :ok == ShapeStatus.validate_shape_handle(stack_id, shape_handle, shape),
        do: {:ok, shape_handle},
        else: fetch_handle_by_shape(shape, stack_id)

    with {:ok, resolved_handle} <- result,
         {:ok, offset} <- fetch_latest_offset(stack_id, resolved_handle) do
      {resolved_handle, offset}
    else
      _ -> nil
    end
  end

  @spec list_shapes(stack_id()) :: [{shape_handle(), Shape.t()}] | :error
  def list_shapes(stack_id) when is_stack_id(stack_id) do
    ShapeStatus.list_shapes(stack_id)
  rescue
    ArgumentError -> :error
  end

  @spec count_shapes(stack_id()) :: non_neg_integer() | :error
  def count_shapes(stack_id) when is_stack_id(stack_id) do
    ShapeStatus.count_shapes(stack_id)
  rescue
    ArgumentError -> :error
  end

  @spec clean_shape(shape_handle(), stack_id()) :: :ok
  def clean_shape(shape_handle, stack_id)
      when is_shape_handle(shape_handle) and is_stack_id(stack_id) do
    ShapeCleaner.remove_shape(stack_id, shape_handle)
  end

  @spec await_snapshot_start(shape_handle(), stack_id(), non_neg_integer()) ::
          :started | {:error, term()}
  def await_snapshot_start(
        shape_handle,
        stack_id,
        attempts_remaining \\ @max_snapshot_start_attempts
      )
      when is_shape_handle(shape_handle) and is_stack_id(stack_id) do
    cond do
      ShapeStatus.snapshot_started?(stack_id, shape_handle) ->
        # Must only update the last_read_time after confirming that the shape has a snapshot,
        # so as not to interfere with the invariant that a shape that has just been created
        # does not have a last_read_time until its consumer process starts.
        ShapeStatus.update_last_read_time_to_now(stack_id, shape_handle)
        :started

      not ShapeStatus.has_shape_handle?(stack_id, shape_handle) ->
        {:error, :unknown}

      true ->
        try do
          Electric.Shapes.Consumer.await_snapshot_start(stack_id, shape_handle)
        catch
          :exit, {:timeout, {GenServer, :call, _}} ->
            # Please note that :await_snapshot_start can also return a timeout error as well
            # as the call timing out and being handled here. A timeout error will be returned
            # by :await_snapshot_start if the PublicationManager queries take longer than 5 seconds.
            Logger.error("Failed to await snapshot start for shape #{shape_handle}: timeout")
            {:error, %RuntimeError{message: "Timed out while waiting for snapshot to start"}}

          :exit, {:noproc, _} ->
            # The fact that we got the shape handle means we know the shape exists, and the process should
            # exist too. We can get here if multiple concurrent requests are racing for the same shape handle:
            #   1. The 1st request adds the handle to ShapeStatus and starts the consumer process.
            #   2. Subsequent requests might already see the handle in ShapeStatus before the consumer process has started.

            cond do
              ShapeStatus.shape_has_been_activated?(stack_id, shape_handle) ->
                # This branch can only be reached when the consumer process for the shape had
                # already been started but then died without requesting shape cleanup. We've seen
                # this happen in prod for shapes with subqueries.
                #
                # A shape with subqueries is actually a hierarchy of multiple shapes where
                # non-root consumers have matching materializer processes started for them.
                # We've seen in prod logs that occasionally a materializer process dies with
                # reason :shutdown which is a likely cause for the consumer process to stop with
                # the same reason. Consumer processes aren't restarted automatically, so as a
                # result, the shape handle remains in the ShapeStatus table but there's no longer
                # a consumer process for it.
                #
                # The root cause for materializer process shutdown before snapshot creation even starts
                # is yet to be determined.
                #
                # For now we just invalidate the shape with subqueries and expect that the client
                # will re-request it.
                case fetch_shape_by_handle(shape_handle, stack_id) do
                  {:ok, shape} ->
                    ShapeCleaner.remove_shapes(stack_id, [
                      shape_handle | shape.shape_dependencies_handles
                    ])

                    Logger.error(
                      "No consumer process when waiting on initial snapshot creation for #{shape_handle}"
                    )

                    {:error, :unknown}

                  :error ->
                    # Shape was already cleaned up by a concurrent process
                    {:error, :unknown}
                end

              attempts_remaining > 0 ->
                # The record in ShapeStatus has just been inserted and the consumer process for it is about to be started.
                # Just idle for a while waiting for it to come up.
                Process.sleep(@snapshot_start_retry_sleep_ms)
                await_snapshot_start(shape_handle, stack_id, attempts_remaining - 1)

              true ->
                # Nothing else to do here but to bail. The API response to the client will ask
                # politely to wait a bit before initiating a new request, lest we get DoSed by
                # clients that all want to fetch this shape.

                Logger.warning(
                  "Exhausted retry attempts while waiting for a shape consumer to start initial snapshot creation for #{shape_handle}"
                )

                {:error, Electric.SnapshotError.slow_snapshot_start()}
            end
        end
    end
  rescue
    ArgumentError ->
      {:error, %RuntimeError{message: "Shape meta tables not found"}}
  end

  @spec has_shape?(shape_handle(), Access.t()) :: boolean()
  def has_shape?(shape_handle, stack_id)
      when is_shape_handle(shape_handle) and is_stack_id(stack_id) do
    ShapeStatus.has_shape_handle?(stack_id, shape_handle) ||
      GenServer.call(name(stack_id), {:has_shape_handle?, shape_handle}, @call_timeout)
  end

  @spec start_consumer_for_handle(shape_handle(), stack_id()) ::
          {:ok, pid()} | {:error, :no_shape}
  def start_consumer_for_handle(shape_handle, stack_id)
      when is_shape_handle(shape_handle) and is_stack_id(stack_id) do
    GenServer.call(name(stack_id), {:start_consumer_for_handle, shape_handle}, @call_timeout)
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
      subscription: nil
    }

    {:ok, state, {:continue, :wait_for_restore}}
  end

  @impl GenServer
  def handle_continue(:wait_for_restore, state) do
    start_time = System.monotonic_time()

    total_recovered = ShapeStatus.count_shapes(state.stack_id)

    Electric.Replication.PublicationManager.wait_for_restore(state.stack_id)

    # Let ShapeLogCollector that it can start processing after finishing this function so that
    # we're subscribed to the producer before it starts forwarding its demand.
    ShapeLogCollector.mark_as_ready(state.stack_id)

    duration = System.monotonic_time() - start_time

    Logger.notice(
      "Consumers ready in #{System.convert_time_unit(duration, :native, :millisecond)}ms (#{total_recovered} shapes)"
    )

    Electric.Telemetry.OpenTelemetry.execute(
      [:electric, :connection, :consumers_ready],
      %{duration: duration, total: total_recovered},
      %{stack_id: state.stack_id}
    )

    {:noreply, state}
  end

  @impl GenServer
  def handle_call({:create_or_wait_shape_handle, shape, otel_ctx}, _from, state) do
    {shape_handle, latest_offset} =
      maybe_create_shape(shape, %{stack_id: state.stack_id, otel_ctx: otel_ctx})

    Logger.debug("Returning shape id #{shape_handle} for shape #{inspect(shape)}")
    {:reply, {shape_handle, latest_offset}, state}
  end

  def handle_call({:has_shape_handle?, shape_handle}, _from, state) do
    {:reply, ShapeStatus.has_shape_handle?(state.stack_id, shape_handle), state}
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
          restore_shape_and_dependencies(shape_handle, shape, %{
            stack_id: state.stack_id,
            action: :restore,
            otel_ctx: nil
          }),
          state
        }

      :error ->
        {:reply, {:error, :no_shape}, state}
    end
  end

  defp maybe_create_shape(shape, %{stack_id: stack_id} = opts) do
    # fetch_handle_by_shape_critical is a slower but guaranteed consistent
    # shape lookup
    with {:ok, shape_handle} <- ShapeStatus.fetch_handle_by_shape_critical(stack_id, shape),
         {:ok, offset} <- fetch_latest_offset(stack_id, shape_handle) do
      {shape_handle, offset}
    else
      :error ->
        shape_handles =
          shape.shape_dependencies
          |> Enum.map(&maybe_create_shape(&1, Map.put(opts, :is_subquery_shape?, true)))
          |> Enum.map(&elem(&1, 0))

        shape = %{shape | shape_dependencies_handles: shape_handles}

        {:ok, shape_handle} = ShapeStatus.add_shape(stack_id, shape)

        Logger.info("Creating new shape for #{inspect(shape)} with handle #{shape_handle}")

        {:ok, _pid} = start_shape(shape_handle, shape, Map.put(opts, :action, :create))

        # In this branch of `if`, we're guaranteed to have a newly started shape, so we can be sure about it's
        # "latest offset" because it'll be in the snapshotting stage
        {shape_handle, LogOffset.last_before_real_offsets()}
    end
  end

  defp start_shape(shape_handle, shape, %{stack_id: stack_id} = opts) do
    Enum.zip(shape.shape_dependencies_handles, shape.shape_dependencies)
    |> Enum.with_index(fn {shape_handle, inner_shape}, index ->
      materialized_type =
        shape.where.used_refs |> Map.fetch!(["$sublink", Integer.to_string(index)])

      Shapes.DynamicConsumerSupervisor.start_materializer(stack_id, %{
        stack_id: stack_id,
        shape_handle: shape_handle,
        columns: inner_shape.explicitly_selected_columns,
        materialized_type: materialized_type
      })
    end)

    feature_flags = Electric.StackConfig.lookup(stack_id, :feature_flags, [])

    start_opts =
      opts
      |> Map.put(:shape_handle, shape_handle)
      |> Map.put(:subqueries_enabled_for_stack?, "allow_subqueries" in feature_flags)

    case Shapes.DynamicConsumerSupervisor.start_shape_consumer(stack_id, start_opts) do
      {:ok, consumer_pid} ->
        # Now that the consumer process for this shape is running, we can finish initializing
        # the ShapeStatus record by recording a "last_read" timestamp on it.
        ShapeStatus.update_last_read_time_to_now(stack_id, shape_handle)
        {:ok, consumer_pid}

      {:error, _reason} = error ->
        Logger.error("Failed to start shape #{shape_handle}: #{inspect(error)}")
        # purge because we know the consumer isn't running
        clean_shape(shape_handle, stack_id)
        :error
    end
  end

  # start_shape assumes that any dependent shapes already have running consumers
  # so we need to start those. this may be something we can do lazily: i.e.
  # only starting dependent shapes when they receive a write
  defp restore_shape_and_dependencies(shape_handle, shape, opts) do
    [{shape_handle, shape}]
    |> build_shape_dependencies(true, MapSet.new())
    |> elem(0)
    |> Enum.reduce_while({:ok, %{}}, fn {handle, shape, start_shape_opts}, {:ok, acc} ->
      case Electric.Shapes.ConsumerRegistry.whereis(opts.stack_id, handle) do
        nil ->
          case start_shape(handle, shape, Map.merge(opts, start_shape_opts)) do
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
          clean_shape(shape_handle, opts.stack_id)
        end

        {:error, "Failed to start consumer for #{shape_handle}"}
    end
  end

  @spec build_shape_dependencies([{shape_handle(), shape_def()}], boolean(), MapSet.t()) ::
          {[{shape_handle(), shape_def(), map()}], MapSet.t()}
  defp build_shape_dependencies([], _root?, known) do
    {[], known}
  end

  defp build_shape_dependencies([{handle, shape} | rest], root?, known) do
    {siblings, known} = build_shape_dependencies(rest, false, MapSet.put(known, handle))

    {descendents, known} =
      Enum.zip(shape.shape_dependencies_handles, shape.shape_dependencies)
      |> Enum.reject(fn {handle, _shape} -> MapSet.member?(known, handle) end)
      |> build_shape_dependencies(false, known)

    # Any inner shape of a root shape with subqueries must pass the is_subquery_shape? option
    # to the consumer start function
    start_shape_opts =
      if root? do
        %{}
      else
        %{is_subquery_shape?: true}
      end

    {descendents ++ [{handle, shape, start_shape_opts} | siblings], known}
  end

  @spec fetch_latest_offset(stack_id(), shape_handle()) :: {:ok, LogOffset.t()} | :error
  defp fetch_latest_offset(stack_id, shape_handle) do
    shape_handle
    |> Storage.for_shape(Storage.for_stack(stack_id))
    |> Storage.fetch_latest_offset()
    |> case do
      {:ok, offset} -> {:ok, normalize_latest_offset(offset)}
      {:error, _reason} -> :error
    end
  end

  # When writing the snapshot initially, we don't know ahead of time the real last offset for the
  # shape, so we use `0_inf` essentially as a pointer to the end of all possible snapshot chunks,
  # however many there may be. That means the clients will be using that as the latest offset.
  # In order to avoid confusing the clients, we make sure that we preserve that functionality
  # across a restart by setting the latest offset to `0_inf` if there were no real offsets yet.
  @spec normalize_latest_offset(LogOffset.t()) :: LogOffset.t()
  defp normalize_latest_offset(offset) do
    import Electric.Replication.LogOffset,
      only: [is_virtual_offset: 1, last_before_real_offsets: 0]

    if is_virtual_offset(offset),
      do: last_before_real_offsets(),
      else: offset
  end

  if Mix.env() == :test do
    def activate_mocked_functions_from_test_process do
      Support.TestUtils.activate_mocked_functions_for_module(__MODULE__)
    end
  else
    def activate_mocked_functions_from_test_process, do: :noop
  end
end
