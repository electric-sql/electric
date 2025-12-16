defmodule Electric.Shapes.Consumer.Snapshotter do
  use GenServer, restart: :temporary

  alias Electric.ShapeCache.Storage
  alias Electric.Shapes
  alias Electric.Shapes.Querying
  alias Electric.SnapshotError
  alias Electric.Telemetry.OpenTelemetry

  import Electric, only: [is_stack_id: 1, is_shape_handle: 1]

  require Logger

  def name(%{stack_id: stack_id, shape_handle: shape_handle}) do
    name(stack_id, shape_handle)
  end

  def name(stack_id, shape_handle) when is_stack_id(stack_id) and is_shape_handle(shape_handle) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, shape_handle)
  end

  def start_link(config) when is_map(config) do
    GenServer.start_link(__MODULE__, config, name: name(config))
  end

  def init(config) do
    activate_mocked_functions_from_test_process()

    Process.set_label({:snapshotter, config.shape_handle})
    metadata = [stack_id: config.stack_id, shape_handle: config.shape_handle]
    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

    {:ok, config, {:continue, :start_snapshot}}
  end

  def handle_continue(:start_snapshot, state) do
    %{
      shape_handle: shape_handle,
      shape: shape,
      stack_id: stack_id,
      storage: storage
    } = state

    ctx_token = if not is_nil(state.otel_ctx), do: :otel_ctx.attach(state.otel_ctx)

    result =
      case Shapes.Consumer.whereis(stack_id, shape_handle) do
        consumer when is_pid(consumer) ->
          OpenTelemetry.with_span(
            "shape_snapshot.create_snapshot_task",
            telemetry_shape_attrs(shape_handle, shape),
            stack_id,
            fn ->
              try do
                OpenTelemetry.with_span(
                  "shape_snapshot.prepare_tables",
                  telemetry_shape_attrs(shape_handle, shape),
                  stack_id,
                  fn ->
                    Electric.Replication.PublicationManager.add_shape(
                      stack_id,
                      shape_handle,
                      shape
                    )
                  end
                )

                if not Storage.snapshot_started?(state.storage) do
                  start_streaming_snapshot_from_db(consumer, shape_handle, shape, %{
                    stack_id: stack_id,
                    storage: storage
                  })
                else
                  # Let the shape cache know that the snapshot is available. When the
                  # shape cache starts and restores the shapes from disk, it doesn't
                  # know about the snapshot status of each shape, and because the
                  # storage does some clean up on start, e.g. in the case of a format
                  # upgrade, we only know the actual on-disk state of the shape data
                  # once things are running.
                  GenServer.cast(consumer, {:snapshot_exists, shape_handle})
                end
              rescue
                error ->
                  GenServer.cast(
                    consumer,
                    {:snapshot_failed, shape_handle, SnapshotError.from_error(error)}
                  )
              catch
                :exit, {:timeout, {GenServer, :call, _}} ->
                  GenServer.cast(
                    consumer,
                    {:snapshot_failed, shape_handle, SnapshotError.table_lock_timeout()}
                  )
              end
            end
          )

          {:stop, :normal, state}

        nil ->
          Logger.error("Unable to start snapshot - consumer not found for shape #{shape_handle}")

          {:stop, {:error, "consumer not found"}, state}
      end

    if not is_nil(ctx_token), do: :otel_ctx.detach(ctx_token)

    result
  end

  @doc false
  def start_streaming_snapshot_from_db(
        consumer,
        shape_handle,
        shape,
        %{stack_id: stack_id} = ctx
      ) do
    supervisor = Electric.ProcessRegistry.name(ctx.stack_id, Electric.StackTaskSupervisor)
    self_pid = self()

    snapshot_timeout_to_first_data =
      Electric.StackConfig.lookup!(ctx.stack_id, :snapshot_timeout_to_first_data)

    # do this here to simplify mocking as the call is made in the Snapshotter
    # not an ephemeral unnamed task process
    db_pool = Electric.Connection.Manager.snapshot_pool(ctx.stack_id)

    # We're looking to avoid saturating the DB connection pool with queries that are "bad" - those that don't start
    # returning any data (likely because they're not using an index). To acheive that, we're running the query in a task,
    # and waiting for the task to (a) send us a message that it's ready to stream and (b) send us a message when it sees any data
    # Two messages are needed because we can be queued for the connection pool or stuck in other places,
    # and we don't want to count that time towards the "time to first data"
    #
    # Once we have the first message, we set a timeout to wait for the task to send us a message when it sees any data.
    # If the task doesn't send us a message within the timeout, we consider the query "bad" and exit the task.

    task =
      Task.Supervisor.async_nolink(supervisor, fn ->
        snapshot_fun =
          Electric.StackConfig.lookup(stack_id, :create_snapshot_fn, &stream_snapshot_from_db/5)

        try do
          result =
            snapshot_fun.(
              self_pid,
              consumer,
              shape_handle,
              shape,
              Map.put(ctx, :db_pool, db_pool)
            )

          {:ok, result}
          # We're doing a rescue here because we don't want "task exited" logs
        rescue
          error ->
            {:error, error, __STACKTRACE__}
        end
      end)

    ref = task.ref

    receive do
      {:ready_to_stream, task_pid, start_time} ->
        Process.send_after(
          self_pid,
          {:stream_timeout, task_pid},
          start_time + snapshot_timeout_to_first_data,
          abs: true
        )

        receive do
          {:stream_timeout, task_pid} ->
            Process.demonitor(ref, [:flush])
            Task.Supervisor.terminate_child(supervisor, task_pid)

            raise SnapshotError.slow_snapshot_query(snapshot_timeout_to_first_data)

          :data_received ->
            Task.await(task, :infinity) |> handle_task_exit()

          {^ref, result} ->
            Process.demonitor(ref, [:flush])
            handle_task_exit(result)

          {:DOWN, ^ref, :process, _, reason} ->
            case reason do
              {err, stacktrace} when is_exception(err) -> reraise err, stacktrace
              reason -> exit(reason)
            end
        end

      {^ref, result} ->
        Process.demonitor(ref, [:flush])
        handle_task_exit(result)

      {:DOWN, ^ref, :process, _, reason} ->
        case reason do
          {err, stacktrace} when is_exception(err) -> reraise err, stacktrace
          reason -> exit(reason)
        end
    end
  end

  defp handle_task_exit({:ok, result}), do: result
  defp handle_task_exit({:error, error, stacktrace}), do: reraise(error, stacktrace)
  defp handle_task_exit(reason), do: exit(reason)

  def stream_snapshot_from_db(
        task_parent,
        consumer,
        shape_handle,
        shape,
        %{storage: storage, stack_id: stack_id, db_pool: db_pool}
      ) do
    chunk_bytes_threshold = Electric.StackConfig.lookup(stack_id, :chunk_bytes_threshold)

    Electric.Postgres.SnapshotQuery.execute_for_shape(db_pool, shape_handle, shape,
      stack_id: stack_id,
      snapshot_info_fn: fn shape_handle, pg_snapshot, _lsn ->
        GenServer.cast(consumer, {:pg_snapshot_known, shape_handle, pg_snapshot})
      end,
      query_fn: fn conn, {xmin, xmax, xip_list}, _lsn ->
        send(task_parent, {:ready_to_stream, self(), System.monotonic_time(:millisecond)})

        # xmin/xmax/xip_list are uint64, so we need to convert them to strings for JS not to mangle them
        finishing_control_message =
          Jason.encode!(%{
            headers: %{
              control: "snapshot-end",
              xmin: to_string(xmin),
              xmax: to_string(xmax),
              xip_list: Enum.map(xip_list, &to_string/1)
            }
          })

        Querying.stream_initial_data(conn, stack_id, shape_handle, shape, chunk_bytes_threshold)
        |> Stream.transform(
          fn -> false end,
          fn item, acc ->
            if not acc do
              send(task_parent, :data_received)
              GenServer.cast(consumer, {:snapshot_started, shape_handle})
            end

            {[item], true}
          end,
          fn acc ->
            if not acc do
              # The stream has been read to the end but we haven't seen a single item in
              # it. Notify `consumer` anyway since an empty file will have been created by
              # the storage implementation for the API layer to read the snapshot data
              # from.
              send(task_parent, :data_received)
              GenServer.cast(consumer, {:snapshot_started, shape_handle})
            end

            {[], acc}
          end,
          fn acc ->
            # noop after fun just to be able to specify the last fun which is only
            # available in `Stream.transoform/5`.
            acc
          end
        )
        |> Stream.concat([finishing_control_message])
        |> Electric.Shapes.make_new_snapshot!(storage, stack_id, shape_handle)
      end
    )
  end

  defp telemetry_shape_attrs(shape_handle, shape) do
    [
      "shape.handle": shape_handle,
      "shape.root_table": shape.root_table,
      "shape.where": shape.where
    ]
  end

  if Mix.env() == :test do
    def activate_mocked_functions_from_test_process do
      Support.TestUtils.activate_mocked_functions_for_module(__MODULE__)
    end
  else
    def activate_mocked_functions_from_test_process, do: :noop
  end
end
