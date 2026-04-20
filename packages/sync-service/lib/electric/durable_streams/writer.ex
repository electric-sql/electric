defmodule Electric.DurableStreams.Writer do
  @moduledoc """
  GenServer that drains shape DiskQueues and writes to durable streams.

  Sends are pipelined: entries are drained and sent without waiting for
  acks. When an ack arrives via `handle_info({:batch_response, ...})`,
  the confirmed entries are committed (removed) from the DiskQueue.
  """

  use GenServer

  require Logger

  alias Electric.Nifs.DiskQueue
  alias Electric.DurableStreams.{BatchTracker, Distributor, SendLoop, StreamPoster}

  @drain_batch_size 100
  @process_interval_ms 5
  @max_in_flight_per_shape 30

  def name(stack_id, index) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, index)
  end

  def process_shape(pid, shape_handle, entered_at_us \\ nil, queued_at_us \\ nil) do
    GenServer.cast(pid, {:process_shape, shape_handle, entered_at_us, queued_at_us})
  end

  @stats_table :durable_streams_writer_stats

  @doc "Return stats for this writer. Non-blocking via ETS."
  def stats(stack_id, index) do
    try do
      [{_, stats}] = :ets.lookup(@stats_table, {stack_id, index})
      stats
    rescue
      _ ->
        %{
          index: index,
          dirty_shapes: 0,
          total_acked: 0,
          total_errors: 0,
          in_flight: 0,
          last_ack_us: nil
        }
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

    send_loop_name =
      Electric.ProcessRegistry.name(stack_id, Electric.DurableStreams.SendLoop, index)

    {:ok, send_loop_pid} =
      SendLoop.start_link(
        name: send_loop_name,
        url: url,
        auth_token: token,
        callback_pid: self()
      )

    Distributor.register_writer(stack_id, index, self())

    base_path = URI.parse(url).path || "/"

    state = %{
      stack_id: stack_id,
      index: index,
      send_loop: send_loop_pid,
      base_path: base_path,
      dirty_shapes: MapSet.new(),
      # shape_handle => DiskQueue reference
      shape_queues: %{},
      shape_timestamps: %{},
      # Pure state machine for ack → commit/retry mapping
      tracker: BatchTracker.new(),
      next_slot_id: 0,
      processing: false,
      total_acked: 0,
      total_errors: 0,
      last_ack_us: nil
    }

    publish_stats(state)
    {:ok, state}
  end

  @impl GenServer
  def handle_cast({:process_shape, shape_handle, entered_at_us, queued_at_us}, state) do
    state = %{state | dirty_shapes: MapSet.put(state.dirty_shapes, shape_handle)}

    state =
      if entered_at_us do
        existing = Map.get(state.shape_timestamps, shape_handle)

        if is_nil(existing) or entered_at_us < elem(existing, 0) do
          %{
            state
            | shape_timestamps:
                Map.put(state.shape_timestamps, shape_handle, {entered_at_us, queued_at_us})
          }
        else
          state
        end
      else
        state
      end

    # Process this shape inline if it has pipeline room, rather than
    # waiting for the next :process timer (which can be up to
    # @process_interval_ms away).
    state = process_one_shape(state, shape_handle)

    {:noreply, state}
  end

  @impl GenServer
  def handle_info(:process, state) do
    state = process_dirty_shapes(state)
    {:noreply, state}
  end

  def handle_info({:batch_response, slot_seq, result}, state) do
    state = handle_ack(state, slot_seq, result)
    {:noreply, state}
  end

  def handle_info(:http_connection_lost, state) do
    Logger.warning("Writer #{state.index} HTTP connection lost, retrying in-flight batches")
    {tracker, actions} = BatchTracker.fail_all(state.tracker, :connection_lost)
    state = apply_actions(%{state | tracker: tracker}, actions)
    {:noreply, state}
  end

  def handle_info(_msg, state) do
    {:noreply, state}
  end

  # ============================================================================
  # Internal — send pipeline
  # ============================================================================

  defp process_dirty_shapes(state) do
    if MapSet.size(state.dirty_shapes) == 0 do
      %{state | processing: false}
    else
      state =
        Enum.reduce(state.dirty_shapes, state, fn shape_handle, acc ->
          process_one_shape(acc, shape_handle)
        end)

      if MapSet.size(state.dirty_shapes) > 0 do
        Process.send_after(self(), :process, @process_interval_ms)
        state
      else
        %{state | processing: false}
      end
    end
  end

  defp process_one_shape(state, shape_handle) do
    in_flight_count = BatchTracker.in_flight_count(state.tracker, shape_handle)

    if in_flight_count >= @max_in_flight_per_shape do
      state
    else
      case get_output_queue(state, shape_handle) do
        {:ok, q, state} ->
          case DiskQueue.peek_n(q, @drain_batch_size) do
            {:ok, []} ->
              if in_flight_count == 0 do
                %{state | dirty_shapes: MapSet.delete(state.dirty_shapes, shape_handle)}
              else
                state
              end

            {:ok, entries} ->
              send_entries(state, shape_handle, entries)
          end

        {:error, reason} ->
          Logger.debug(fn ->
            "Writer #{state.index} output queue not available for #{shape_handle}: #{inspect(reason)}"
          end)

          %{state | dirty_shapes: MapSet.delete(state.dirty_shapes, shape_handle)}
      end
    end
  end

  defp send_entries(state, shape_handle, entries) do
    values = Enum.map(entries, fn {_id, data} -> data end)
    encoded_body = StreamPoster.encode_values(values)

    {last_id, _} = List.last(entries)
    stream_seq = DiskQueue.format_seq(last_id)

    shape_path = "#{state.base_path}/#{shape_handle}"
    send_start = System.monotonic_time(:microsecond)
    timestamps = Map.get(state.shape_timestamps, shape_handle)
    slot_id = state.next_slot_id
    count = length(entries)

    Logger.debug(fn ->
      "Writer #{state.index} sending #{count} entries for #{shape_handle} slot=#{slot_id} (seq=#{stream_seq}, #{byte_size(encoded_body)} bytes)"
    end)

    SendLoop.enqueue(
      state.send_loop,
      slot_id,
      encoded_body,
      stream_seq,
      System.monotonic_time(:microsecond),
      count,
      1,
      shape_path
    )

    tracker = BatchTracker.register(state.tracker, shape_handle, slot_id, count,
                                    %{send_start: send_start, timestamps: timestamps})

    %{
      state
      | tracker: tracker,
        next_slot_id: slot_id + 1,
        shape_timestamps: Map.delete(state.shape_timestamps, shape_handle)
    }
  end

  # ============================================================================
  # Internal — ack handling
  # ============================================================================

  defp handle_ack(state, slot_id, result) do
    case result do
      {:error, reason} ->
        Logger.warning("Writer #{state.index} slot #{slot_id} failed: #{inspect(reason)}")

      _ ->
        :ok
    end

    {tracker, actions} = BatchTracker.ack(state.tracker, slot_id, result)
    apply_actions(%{state | tracker: tracker}, actions)
  end

  # ============================================================================
  # Internal — apply BatchTracker actions
  # ============================================================================

  defp apply_actions(state, actions) do
    Enum.reduce(actions, state, &apply_action(&2, &1))
  end

  defp apply_action(state, {:commit, shape_handle, count, meta}) do
    case get_output_queue(state, shape_handle) do
      {:ok, q, state} ->
        :ok = DiskQueue.commit_n(q, count)
        breakdown = compute_breakdown(meta)
        Electric.DurableStreams.Stats.record_latency(state.stack_id, breakdown)

        Logger.debug(fn ->
          "Writer #{state.index} committed #{count} for #{shape_handle}"
        end)

        state = %{
          state
          | total_acked: state.total_acked + count,
            last_ack_us: breakdown[:http_us],
            dirty_shapes: MapSet.put(state.dirty_shapes, shape_handle)
        }

        state = ensure_processing(state)
        publish_stats(state)
        state

      {:error, _} ->
        Logger.warning("Writer #{state.index} cannot commit for #{shape_handle}: queue not found")
        state
    end
  end

  defp apply_action(state, {:retry, shape_handle}) do
    case get_output_queue(state, shape_handle) do
      {:ok, q, state} ->
        :ok = DiskQueue.rewind_peek(q)

        Logger.debug(fn ->
          "Writer #{state.index} retry #{shape_handle} (peek rewound)"
        end)

        state = %{
          state
          | total_errors: state.total_errors + 1,
            dirty_shapes: MapSet.put(state.dirty_shapes, shape_handle)
        }

        state = ensure_processing(state)
        publish_stats(state)
        state

      {:error, _} ->
        Logger.warning("Writer #{state.index} cannot retry for #{shape_handle}: queue not found")
        state
    end
  end

  defp ensure_processing(state) do
    if state.processing do
      state
    else
      send(self(), :process)
      %{state | processing: true}
    end
  end

  defp compute_breakdown(%{send_start: send_start, timestamps: timestamps}) do
    now = System.monotonic_time(:microsecond)
    http_us = now - send_start

    case timestamps do
      {entered_at, queued_at} when is_integer(entered_at) and is_integer(queued_at) ->
        %{
          consumer_us: queued_at - entered_at,
          queue_wait_us: send_start - queued_at,
          http_us: http_us,
          total_us: now - entered_at
        }

      _ ->
        %{http_us: http_us}
    end
  end

  # ============================================================================
  # Internal — DiskQueue access
  # ============================================================================

  defp get_output_queue(state, shape_handle) do
    case Map.get(state.shape_queues, shape_handle) do
      nil ->
        # Look up the shared output queue handle registered by the Consumer
        # when it handled the {:snapshot_data_written, ...} cast. Sharing the
        # handle keeps peek/commit cursors consistent across producer and
        # writer.
        case Electric.QueueSystem.Queue.lookup_output(shape_handle) do
          {:ok, q} ->
            Logger.debug(fn ->
              "Writer #{state.index} using shared output queue for #{shape_handle} (size=#{DiskQueue.size(q)})"
            end)

            state = %{state | shape_queues: Map.put(state.shape_queues, shape_handle, q)}
            {:ok, q, state}

          :error ->
            {:error, :not_registered}
        end

      q ->
        {:ok, q, state}
    end
  end

  defp total_in_flight(state) do
    # Sum in-flight across all shapes in the tracker. This is
    # approximate (O(shapes)) but the set of shapes per writer is small.
    Enum.reduce(state.dirty_shapes, 0, fn shape, acc ->
      acc + BatchTracker.in_flight_count(state.tracker, shape)
    end)
  end

  defp publish_stats(state) do
    stats = %{
      index: state.index,
      dirty_shapes: MapSet.size(state.dirty_shapes),
      in_flight: total_in_flight(state),
      total_acked: state.total_acked,
      total_errors: state.total_errors,
      last_ack_us: state.last_ack_us
    }

    try do
      :ets.insert(@stats_table, {{state.stack_id, state.index}, stats})
    rescue
      _ ->
        :ets.new(@stats_table, [:public, :named_table, :set])
        :ets.insert(@stats_table, {{state.stack_id, state.index}, stats})
    end
  end
end
