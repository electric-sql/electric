defmodule Electric.DurableStreams.Writer do
  @moduledoc """
  GenServer that drains shape LMDB queues and writes to durable streams.

  Each writer:
  1. Maintains a set of "dirty" shape handles (shapes with unwritten data)
  2. For each dirty shape, drains entries from the LMDB output queue
  3. Encodes entries and sends them to the durable streams server via SendLoop
  4. On successful ack, deletes confirmed entries from the queue
  5. Uses peek + delete (drain/ack) to ensure only confirmed writes are removed

  Writers are assigned shapes by the Distributor via consistent hashing,
  ensuring the same writer always handles the same shape for ordering.
  """

  use GenServer

  require Logger

  alias Electric.Nifs.LmdbNif
  alias Electric.DurableStreams.{Distributor, SendLoop, StreamPoster}

  @drain_batch_size 100
  @process_interval_ms 50
  @lmdb_map_size :erlang.bsl(4, 30)

  def name(stack_id, index) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, index)
  end

  @doc """
  Notify this writer that a shape has new data to process.
  """
  def process_shape(pid, shape_handle) do
    GenServer.cast(pid, {:process_shape, shape_handle})
  end

  @doc "Return stats for this writer. Non-blocking via ETS."
  def stats(stack_id, index) do
    case :persistent_term.get({__MODULE__, :stats, stack_id, index}, nil) do
      nil -> %{index: index, dirty_shapes: 0, total_acked: 0, total_errors: 0, last_ack_us: nil}
      stats -> stats
    end
  end

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    index = Keyword.fetch!(opts, :index)
    GenServer.start_link(__MODULE__, opts, name: name(stack_id, index))
  end

  @impl GenServer
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    index = Keyword.fetch!(opts, :index)
    url = Keyword.fetch!(opts, :durable_streams_url)
    token = Keyword.fetch!(opts, :durable_streams_token)

    Process.set_label({:durable_streams_writer, stack_id, index})
    Logger.metadata(stack_id: stack_id, writer_index: index)

    # Start a SendLoop for this writer's HTTP/2 connection
    send_loop_name =
      Electric.ProcessRegistry.name(stack_id, Electric.DurableStreams.SendLoop, index)

    {:ok, send_loop_pid} =
      SendLoop.start_link(
        name: send_loop_name,
        url: url,
        auth_token: token,
        callback_pid: self()
      )

    # Register with the distributor
    Distributor.register_writer(stack_id, index, self())

    base_path = URI.parse(url).path || "/"

    state = %{
      stack_id: stack_id,
      index: index,
      send_loop: send_loop_pid,
      base_path: base_path,
      dirty_shapes: MapSet.new(),
      # shape_handle => output_db reference
      shape_dbs: %{},
      processing: false,
      total_acked: 0,
      total_errors: 0,
      last_ack_us: nil
    }

    publish_stats(state)
    {:ok, state}
  end

  @impl GenServer
  def handle_cast({:process_shape, shape_handle}, state) do
    state = %{state | dirty_shapes: MapSet.put(state.dirty_shapes, shape_handle)}

    state =
      if not state.processing do
        send(self(), :process)
        %{state | processing: true}
      else
        state
      end

    {:noreply, state}
  end

  @impl GenServer
  def handle_info(:process, state) do
    state = process_dirty_shapes(state)
    {:noreply, state}
  end

  def handle_info({:batch_response, _slot_seq, :ok}, state) do
    # Batch confirmed — ack will be handled inline in process_shape_queue
    {:noreply, state}
  end

  def handle_info({:batch_response, _slot_seq, {:error, reason}}, state) do
    Logger.warning("Batch write failed: #{inspect(reason)}")
    {:noreply, state}
  end

  def handle_info(:http_connection_lost, state) do
    Logger.warning("HTTP connection lost, will retry")
    {:noreply, state}
  end

  def handle_info(_msg, state) do
    {:noreply, state}
  end

  # ============================================================================
  # Internal
  # ============================================================================

  defp process_dirty_shapes(state) do
    if MapSet.size(state.dirty_shapes) == 0 do
      %{state | processing: false}
    else
      state =
        Enum.reduce(state.dirty_shapes, state, fn shape_handle, acc ->
          process_one_shape(acc, shape_handle)
        end)

      # Check if any shapes still have data
      if MapSet.size(state.dirty_shapes) > 0 do
        Process.send_after(self(), :process, @process_interval_ms)
        state
      else
        %{state | processing: false}
      end
    end
  end

  defp process_one_shape(state, shape_handle) do
    case get_output_db(state, shape_handle) do
      {:ok, db, state} ->
        case LmdbNif.drain(db, @drain_batch_size) do
          :empty ->
            %{state | dirty_shapes: MapSet.delete(state.dirty_shapes, shape_handle)}

          {:ok, entries} ->
            encoded_body = StreamPoster.encode_queue_entries(entries)

            # Use the last LMDB key as the stream sequence.
            # Stream-Seq is an opaque string with lexicographic ordering.
            # LMDB keys are <<lsn::64, offset::64>> which are already
            # lexicographically sorted, so hex-encoding preserves order.
            {last_key, _} = List.last(entries)
            stream_seq = Base.encode16(last_key, case: :lower)

            # Each shape has its own durable stream at <base_path>/<shape_handle>
            shape_path = "#{state.base_path}/#{shape_handle}"

            Logger.debug(fn ->
              "Writer #{state.index} sending #{length(entries)} entries for #{shape_handle} to #{shape_path} (stream_seq=#{stream_seq}, #{byte_size(encoded_body)} bytes)"
            end)

            SendLoop.enqueue(
              state.send_loop,
              stream_seq,
              encoded_body,
              stream_seq,
              System.monotonic_time(:microsecond),
              length(entries),
              1,
              shape_path
            )

            # Wait for ack synchronously to ensure confirmed before deleting
            send_start = System.monotonic_time(:microsecond)

            case SendLoop.wait_for_ack(state.send_loop) do
              {_seq, :ok} ->
                ack_us = System.monotonic_time(:microsecond) - send_start
                Logger.debug(fn -> "Writer #{state.index} acked #{length(entries)} entries for #{shape_handle} in #{ack_us}µs, removing from queue" end)
                :ok = LmdbNif.ack(db, entries)
                Electric.DurableStreams.Stats.record_latency(state.stack_id, ack_us)
                state = %{state | total_acked: state.total_acked + length(entries), last_ack_us: ack_us}
                publish_stats(state)
                state

              {_seq, {:error, reason}} ->
                Logger.warning("Writer #{state.index} failed to write to durable stream for #{shape_handle}: #{inspect(reason)}")
                state = %{state | total_errors: state.total_errors + 1}
                publish_stats(state)
                state
            end
        end

      {:error, reason} ->
        Logger.debug(fn -> "Writer #{state.index} output queue not available for #{shape_handle}: #{inspect(reason)}, removing from dirty set" end)
        %{state | dirty_shapes: MapSet.delete(state.dirty_shapes, shape_handle)}
    end
  end

  defp get_output_db(state, shape_handle) do
    case Map.get(state.shape_dbs, shape_handle) do
      nil ->
        {_mod, storage_opts} = Electric.StackConfig.lookup!(state.stack_id, Electric.ShapeCache.Storage)
        base_path = Map.fetch!(storage_opts, :base_path)
        queue_dir = Path.join([base_path, shape_handle, "queue", "output"])

        Logger.debug(fn -> "Writer #{state.index} looking for output queue at #{queue_dir} (exists=#{File.exists?(queue_dir)})" end)

        if File.exists?(queue_dir) do
          db = LmdbNif.open(queue_dir, @lmdb_map_size, 1)
          state = %{state | shape_dbs: Map.put(state.shape_dbs, shape_handle, db)}
          {:ok, db, state}
        else
          {:error, :not_found}
        end

      db ->
        {:ok, db, state}
    end
  end

  defp publish_stats(state) do
    stats = %{
      index: state.index,
      dirty_shapes: MapSet.size(state.dirty_shapes),
      total_acked: state.total_acked,
      total_errors: state.total_errors,
      last_ack_us: state.last_ack_us
    }

    :persistent_term.put({__MODULE__, :stats, state.stack_id, state.index}, stats)
  end
end
