defmodule Electric.Shapes.Consumer.Snapshotter do
  use GenServer, restart: :temporary

  alias Electric.ShapeCache.Storage
  alias Electric.Shapes
  alias Electric.Shapes.Querying
  alias Electric.SnapshotError
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  def name(%{
        stack_id: stack_id,
        shape_handle: shape_handle
      }) do
    name(stack_id, shape_handle)
  end

  def name(stack_id, shape_handle) when is_binary(shape_handle) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, shape_handle)
  end

  def start_snapshot(stack_id, shape_handle) do
    # Low timeout because we expect the process to be present & the block to be short
    GenServer.call(name(stack_id, shape_handle), :start_snapshot, 1_000)
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

    {:ok, config}
  end

  def handle_call(:start_snapshot, _from, state) do
    {:reply, :ok, state, {:continue, :start_snapshot}}
  end

  def handle_continue(:start_snapshot, state) do
    %{
      shape_handle: shape_handle,
      shape: shape,
      stack_id: stack_id
    } = state

    ctx_token = if not is_nil(state.otel_ctx), do: :otel_ctx.attach(state.otel_ctx)

    result =
      case Shapes.Consumer.whereis(stack_id, shape_handle) do
        consumer when is_pid(consumer) ->
          %{
            stack_id: stack_id,
            publication_manager: {publication_manager, publication_manager_opts}
          } = state

          OpenTelemetry.with_span(
            "shape_snapshot.create_snapshot_task",
            shape_attrs(shape_handle, shape),
            stack_id,
            fn ->
              try do
                OpenTelemetry.with_span(
                  "shape_snapshot.prepare_tables",
                  shape_attrs(shape_handle, shape),
                  stack_id,
                  fn ->
                    publication_manager.add_shape(shape_handle, shape, publication_manager_opts)
                  end
                )

                if not Storage.snapshot_started?(state.storage) do
                  start_streaming_snapshot_from_db(
                    consumer,
                    shape_handle,
                    shape,
                    Map.take(state, [
                      :stack_id,
                      :db_pool,
                      :storage,
                      :chunk_bytes_threshold,
                      :snapshot_timeout_to_first_data
                    ])
                  )
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
                :exit, {_, {DBConnection.Holder, :checkout, _}} ->
                  GenServer.cast(
                    consumer,
                    {:snapshot_failed, shape_handle, SnapshotError.connection_not_available()}
                  )

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
        ctx
      ) do
    supervisor = Electric.ProcessRegistry.name(ctx.stack_id, Electric.StackTaskSupervisor)
    self_pid = self()

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
        try do
          result =
            stream_snapshot_from_db(
              self_pid,
              consumer,
              shape_handle,
              shape,
              ctx
            )

          {:ok, result}
          # We're doing a rescue here because we don't want "task exited" logs
        rescue
          error ->
            {:error, error, __STACKTRACE__}
        end
      end)

    ref = task.ref
    timeout_to_first_data = Map.get(ctx, :snapshot_timeout_to_first_data, :timer.seconds(30))

    receive do
      {:ready_to_stream, task_pid, start_time} ->
        Process.send_after(
          self_pid,
          {:stream_timeout, task_pid},
          start_time + timeout_to_first_data,
          abs: true
        )

        receive do
          {:stream_timeout, task_pid} ->
            Process.demonitor(ref, [:flush])
            Task.Supervisor.terminate_child(supervisor, task_pid)

            raise SnapshotError.slow_snapshot_query(timeout_to_first_data)

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
        %{
          db_pool: db_pool,
          storage: storage,
          stack_id: stack_id,
          chunk_bytes_threshold: chunk_bytes_threshold
        }
      ) do
    shape_attrs = shape_attrs(shape_handle, shape)

    Postgrex.transaction(
      db_pool,
      fn conn ->
        OpenTelemetry.with_span(
          "shape_snapshot.query_in_readonly_txn",
          shape_attrs,
          stack_id,
          fn ->
            query_span!(
              conn,
              "shape_snapshot.start_readonly_txn",
              shape_attrs,
              "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
              [],
              stack_id
            )

            %{rows: [[pg_snapshot = {xmin, xmax, xip_list}]]} =
              query_span!(
                conn,
                "shape_snapshot.get_pg_snapshot",
                shape_attrs,
                "SELECT pg_current_snapshot()",
                [],
                stack_id
              )

            GenServer.cast(
              consumer,
              {:pg_snapshot_known, shape_handle, pg_snapshot}
            )

            # Enforce display settings *before* querying initial data to maintain consistent
            # formatting between snapshot and live log entries.
            OpenTelemetry.with_span(
              "shape_snapshot.set_display_settings",
              shape_attrs,
              stack_id,
              fn ->
                Enum.each(Electric.Postgres.display_settings(), &Postgrex.query!(conn, &1, []))
              end
            )

            send(task_parent, {:ready_to_stream, self(), System.monotonic_time(:millisecond)})

            # xmin/xmax/xip_list are uint64, so we need to convert them to strings for JS not to mangle them
            finishing_contol_message =
              Jason.encode!(%{
                headers: %{
                  control: "snapshot-end",
                  xmin: to_string(xmin),
                  xmax: to_string(xmax),
                  xip_list: Enum.map(xip_list, &to_string/1)
                }
              })

            stream =
              Querying.stream_initial_data(conn, stack_id, shape, chunk_bytes_threshold)
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
              |> Stream.concat([finishing_contol_message])

            # could pass the shape and then make_new_snapshot! can pass it to row_to_snapshot_item
            # that way it has the relation, but it is still missing the pk_cols
            Storage.make_new_snapshot!(stream, storage)
          end
        )
      end,
      timeout: :infinity
    )
  end

  defp query_span!(conn, span_name, span_attrs, query, params, stack_id) do
    OpenTelemetry.with_span(
      span_name,
      span_attrs,
      stack_id,
      fn -> Postgrex.query!(conn, query, params) end
    )
  end

  defp shape_attrs(shape_handle, shape) do
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
