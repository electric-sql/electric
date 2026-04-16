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
  alias Electric.DurableStreams.{Distributor, SendLoop, StreamPoster}

  @drain_batch_size 100
  @process_interval_ms 5
  @max_in_flight_per_shape 3

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
      # slot_id => shape_handle (for ack routing)
      slot_to_shape: %{},
      # shape_handle => [{slot_id, count, :pending | {:acked, breakdown} | :failed}]
      # Ordered list of batches per shape, in send order.
      shape_batches: %{},
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

  def handle_info({:batch_response, slot_seq, result}, state) do
    state = handle_ack(state, slot_seq, result)
    {:noreply, state}
  end

  def handle_info(:http_connection_lost, state) do
    Logger.warning(
      "Writer #{state.index} HTTP connection lost, failing #{map_size(state.slot_to_shape)} in-flight batches"
    )

    # Mark all pending batches as failed so the commit cursor keeps moving.
    # The entries are lost (see TODO in flush_shape_batches).
    state =
      Enum.reduce(state.slot_to_shape, state, fn {slot_id, {shape_handle, _send_start, _ts}},
                                                 acc ->
        mark_batch(acc, shape_handle, slot_id, {:error, :connection_lost}, 0, nil)
      end)

    state = %{state | slot_to_shape: %{}}

    # Flush all shapes
    state =
      state.shape_batches
      |> Map.keys()
      |> Enum.reduce(state, fn shape_handle, acc -> flush_shape_batches(acc, shape_handle) end)

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
    in_flight_count = shape_in_flight_count(state, shape_handle)

    if in_flight_count >= @max_in_flight_per_shape do
      # Pipeline is full — wait for acks before sending more
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

  defp shape_in_flight_count(state, shape_handle) do
    state.shape_batches
    |> Map.get(shape_handle, [])
    |> Enum.count(fn {_, _, status} -> status == :pending end)
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

    Logger.debug(fn ->
      "Writer #{state.index} sending #{length(entries)} entries for #{shape_handle} slot=#{slot_id} (seq=#{stream_seq}, #{byte_size(encoded_body)} bytes)"
    end)

    SendLoop.enqueue(
      state.send_loop,
      slot_id,
      encoded_body,
      stream_seq,
      System.monotonic_time(:microsecond),
      length(entries),
      1,
      shape_path
    )

    batches = Map.get(state.shape_batches, shape_handle, [])
    batches = batches ++ [{slot_id, length(entries), :pending}]

    %{
      state
      | slot_to_shape:
          Map.put(state.slot_to_shape, slot_id, {shape_handle, send_start, timestamps}),
        shape_batches: Map.put(state.shape_batches, shape_handle, batches),
        next_slot_id: slot_id + 1,
        shape_timestamps: Map.delete(state.shape_timestamps, shape_handle)
    }
  end

  # ============================================================================
  # Internal — ack handling
  # ============================================================================

  # Per-shape batch tracking. Each shape has an ordered list of batches:
  #   [{slot_id, count, :pending | {:acked, breakdown} | :failed}]
  # Batches are appended in send order. On ack, the batch is marked.
  # We then flush from the front: commit all consecutive acked/failed
  # batches from the head of the list.

  defp handle_ack(state, slot_id, result) do
    case Map.pop(state.slot_to_shape, slot_id) do
      {nil, _} ->
        Logger.debug(fn -> "Writer #{state.index} received ack for unknown slot #{slot_id}" end)
        state

      {{shape_handle, send_start, timestamps}, slot_to_shape} ->
        state = %{state | slot_to_shape: slot_to_shape}

        state = mark_batch(state, shape_handle, slot_id, result, send_start, timestamps)
        flush_shape_batches(state, shape_handle)
    end
  end

  defp mark_batch(state, shape_handle, slot_id, result, send_start, timestamps) do
    batches = Map.get(state.shape_batches, shape_handle, [])

    batches =
      Enum.map(batches, fn
        {^slot_id, count, :pending} ->
          case result do
            :ok ->
              now = System.monotonic_time(:microsecond)
              http_us = now - send_start

              breakdown =
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

              {slot_id, count, {:acked, breakdown}}

            {:error, reason} ->
              Logger.warning(
                "Writer #{state.index} failed for #{shape_handle} slot #{slot_id}: #{inspect(reason)}"
              )

              {slot_id, count, :failed}
          end

        other ->
          other
      end)

    %{state | shape_batches: Map.put(state.shape_batches, shape_handle, batches)}
  end

  defp flush_shape_batches(state, shape_handle) do
    batches = Map.get(state.shape_batches, shape_handle, [])

    case batches do
      [{slot_id, count, {:acked, breakdown}} | rest] ->
        case get_output_queue(state, shape_handle) do
          {:ok, q, state} ->
            :ok = DiskQueue.commit_n(q, count)
            Electric.DurableStreams.Stats.record_latency(state.stack_id, breakdown)

            Logger.debug(fn ->
              "Writer #{state.index} committed #{count} for #{shape_handle} slot=#{slot_id}"
            end)

            state = %{
              state
              | total_acked: state.total_acked + count,
                last_ack_us: breakdown[:http_us],
                dirty_shapes: MapSet.put(state.dirty_shapes, shape_handle),
                shape_batches: Map.put(state.shape_batches, shape_handle, rest)
            }

            state =
              if not state.processing do
                send(self(), :process)
                %{state | processing: true}
              else
                state
              end

            publish_stats(state)
            flush_shape_batches(state, shape_handle)

          {:error, _} ->
            Logger.warning(
              "Writer #{state.index} cannot commit for #{shape_handle}: queue not found"
            )

            state
        end

      [{_slot_id, count, :failed} | rest] ->
        # TODO: failed batches should be retried, not dropped.
        # Currently we commit (discard) the failed entries to keep
        # the commit cursor moving and unblock subsequent batches.
        # This loses data.
        case get_output_queue(state, shape_handle) do
          {:ok, q, state} ->
            DiskQueue.commit_n(q, count)

            state = %{
              state
              | total_errors: state.total_errors + 1,
                shape_batches: Map.put(state.shape_batches, shape_handle, rest)
            }

            publish_stats(state)
            flush_shape_batches(state, shape_handle)

          _ ->
            state
        end

      _ ->
        # Head is :pending or list is empty — nothing to flush
        state
    end
  end

  # ============================================================================
  # Internal — DiskQueue access
  # ============================================================================

  defp get_output_queue(state, shape_handle) do
    case Map.get(state.shape_queues, shape_handle) do
      nil ->
        # Look up the shared output queue handle registered by the Consumer
        # during transition_to_live. This ensures we share the same DiskQueue
        # reference (and its peek/commit cursors) instead of opening a
        # separate handle that can't commit the Consumer's records.
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

  defp publish_stats(state) do
    stats = %{
      index: state.index,
      dirty_shapes: MapSet.size(state.dirty_shapes),
      in_flight: map_size(state.slot_to_shape),
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
