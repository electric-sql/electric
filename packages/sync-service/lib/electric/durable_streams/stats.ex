defmodule Electric.DurableStreams.Stats do
  @moduledoc """
  Collects and exposes durable streams pipeline stats for the debug endpoint.

  Uses an ETS table for lock-free reads from the HTTP handler while
  writers update stats from their own processes.
  """

  use GenServer

  @table __MODULE__

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    GenServer.start_link(__MODULE__, opts, name: name(stack_id))
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @impl GenServer
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    tab = :"#{@table}:#{stack_id}"
    :ets.new(tab, [:public, :named_table, :set, write_concurrency: true])
    :ets.insert(tab, {:pipeline_latencies, []})
    :ets.insert(tab, {:totals, %{acked: 0, errors: 0, bytes_sent: 0}})
    {:ok, %{stack_id: stack_id, table: tab}}
  end

  @doc """
  Record a pipeline latency sample (microseconds from replication receive to durable ack).
  Called by Writer after successful ack.
  """
  def record_latency(stack_id, latency_us) do
    tab = :"#{@table}:#{stack_id}"

    try do
      # Keep a sliding window of recent samples
      [{_, samples}] = :ets.lookup(tab, :pipeline_latencies)
      # Keep last 1000 samples
      samples = [latency_us | Enum.take(samples, 999)]
      :ets.insert(tab, {:pipeline_latencies, samples})
    rescue
      _ -> :ok
    end
  end

  @doc "Return aggregate stats as a map."
  def get_stats(stack_id) do
    tab = :"#{@table}:#{stack_id}"

    try do
      [{_, samples}] = :ets.lookup(tab, :pipeline_latencies)

      latency_stats =
        if samples == [] do
          %{count: 0}
        else
          sorted = Enum.sort(samples)
          count = length(sorted)
          %{
            count: count,
            min_us: List.first(sorted),
            max_us: List.last(sorted),
            mean_us: div(Enum.sum(sorted), count),
            p50_us: Enum.at(sorted, div(count, 2)),
            p99_us: Enum.at(sorted, trunc(count * 0.99))
          }
        end

      %{pipeline_latency: latency_stats}
    rescue
      _ -> %{pipeline_latency: %{count: 0, error: "not_started"}}
    end
  end
end
