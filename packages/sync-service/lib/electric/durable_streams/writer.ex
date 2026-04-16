defmodule Electric.DurableStreams.Writer do
  @moduledoc """
  GenServer that drains shape LMDB queues and writes to durable streams.

  Sends are pipelined: entries are drained and sent without waiting for
  acks. When an ack arrives via `handle_info({:batch_response, ...})`,
  the confirmed entries are deleted from the LMDB queue.
  """

  use GenServer

  require Logger

  alias Electric.Nifs.LmdbNif
  alias Electric.DurableStreams.{Distributor, SendLoop, StreamPoster}

  @drain_batch_size 100
  @process_interval_ms 5
  @lmdb_map_size :erlang.bsl(4, 30)

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
      _ -> %{index: index, dirty_shapes: 0, total_acked: 0, total_errors: 0, in_flight: 0, last_ack_us: nil}
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
      shape_dbs: %{},
      shape_timestamps: %{},
      # slot_id => {shape_handle, entries, send_start_us, timestamps}
      in_flight: %{},
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
          %{state | shape_timestamps: Map.put(state.shape_timestamps, shape_handle, {entered_at_us, queued_at_us})}
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
    Logger.warning("HTTP connection lost, will retry")
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
    # Skip shapes that already have an in-flight batch — drain returns
    # the same entries until they're acked, so sending again would cause
    # a sequence regression on the server.
    if shape_in_flight?(state, shape_handle) do
      state
    else
      case get_output_db(state, shape_handle) do
        {:ok, db, state} ->
          case LmdbNif.drain(db, @drain_batch_size) do
            :empty ->
              %{state | dirty_shapes: MapSet.delete(state.dirty_shapes, shape_handle)}

            {:ok, entries} ->
              send_entries(state, shape_handle, db, entries)
          end

        {:error, reason} ->
          Logger.debug(fn -> "Writer #{state.index} output queue not available for #{shape_handle}: #{inspect(reason)}" end)
          %{state | dirty_shapes: MapSet.delete(state.dirty_shapes, shape_handle)}
      end
    end
  end

  defp shape_in_flight?(state, shape_handle) do
    Enum.any?(state.in_flight, fn {_seq, {sh, _, _, _}} -> sh == shape_handle end)
  end

  defp send_entries(state, shape_handle, _db, entries) do
    encoded_body = StreamPoster.encode_queue_entries(entries)

    {last_key, _} = List.last(entries)
    stream_seq = Base.encode16(last_key, case: :lower)

    shape_path = "#{state.base_path}/#{shape_handle}"
    send_start = System.monotonic_time(:microsecond)
    timestamps = Map.get(state.shape_timestamps, shape_handle)

    # Use a monotonic slot_id for in-flight tracking — stream_seq can
    # collide across shapes (e.g., snapshot keys with lsn=0).
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

    in_flight = Map.put(state.in_flight, slot_id, {shape_handle, entries, send_start, timestamps})

    %{state |
      in_flight: in_flight,
      next_slot_id: slot_id + 1,
      shape_timestamps: Map.delete(state.shape_timestamps, shape_handle)
    }
  end

  # ============================================================================
  # Internal — ack handling
  # ============================================================================

  defp handle_ack(state, slot_seq, result) do
    case Map.pop(state.in_flight, slot_seq) do
      {nil, _} ->
        Logger.debug(fn -> "Writer #{state.index} received ack for unknown seq #{slot_seq}" end)
        state

      {{shape_handle, entries, send_start, timestamps}, in_flight} ->
        state = %{state | in_flight: in_flight}

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

            Logger.debug(fn ->
              parts = [
                "http=#{http_us}µs",
                if(breakdown[:consumer_us], do: "consumer=#{breakdown.consumer_us}µs"),
                if(breakdown[:queue_wait_us], do: "queue=#{breakdown.queue_wait_us}µs"),
                if(breakdown[:total_us], do: "total=#{breakdown.total_us}µs")
              ]
              "Writer #{state.index} acked #{length(entries)} for #{shape_handle} #{Enum.join(Enum.filter(parts, & &1), " ")}"
            end)

            # Confirmed — delete from LMDB queue and re-mark shape as dirty
            # so the next processing cycle drains more entries.
            case get_output_db(state, shape_handle) do
              {:ok, db, state} ->
                :ok = LmdbNif.ack(db, entries)
                Electric.DurableStreams.Stats.record_latency(state.stack_id, breakdown)

                state = %{state |
                  total_acked: state.total_acked + length(entries),
                  last_ack_us: http_us,
                  dirty_shapes: MapSet.put(state.dirty_shapes, shape_handle)
                }

                # Kick the processing loop if not already running
                state =
                  if not state.processing do
                    send(self(), :process)
                    %{state | processing: true}
                  else
                    state
                  end

                publish_stats(state)
                state

              {:error, _} ->
                Logger.warning("Writer #{state.index} cannot ack entries for #{shape_handle}: output db not found")
                state
            end

          {:error, reason} ->
            Logger.warning("Writer #{state.index} failed for #{shape_handle}: #{inspect(reason)}")
            state = %{state | total_errors: state.total_errors + 1}
            publish_stats(state)
            state
        end
    end
  end

  # ============================================================================
  # Internal — LMDB access
  # ============================================================================

  defp get_output_db(state, shape_handle) do
    case Map.get(state.shape_dbs, shape_handle) do
      nil ->
        {_mod, storage_opts} = Electric.StackConfig.lookup!(state.stack_id, Electric.ShapeCache.Storage)
        base_path = Map.fetch!(storage_opts, :base_path)
        queue_dir = Path.join([base_path, shape_handle, "queue", "output"])

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
      in_flight: map_size(state.in_flight),
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
