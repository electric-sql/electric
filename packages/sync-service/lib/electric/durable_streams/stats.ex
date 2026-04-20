defmodule Electric.DurableStreams.Stats do
  @moduledoc """
  Collects and exposes durable streams pipeline stats for the debug endpoint.

  Tracks latency broken down into segments:
  - **consumer**: Consumer receives txn → finishes LMDB write
  - **queue_wait**: LMDB write complete → Writer picks it up
  - **http**: Writer sends → durable stream ack
  - **total**: Consumer receives → durable stream ack (end-to-end)
  """

  use GenServer

  @table __MODULE__
  @window_size 1000
  @segments [:consumer_us, :queue_wait_us, :send_queue_wait_us, :wire_us, :http_us, :total_us]

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

    for seg <- @segments do
      :ets.insert(tab, {seg, []})
    end

    {:ok, %{stack_id: stack_id, table: tab}}
  end

  @doc """
  Record a latency breakdown map. Keys are :consumer_us, :queue_wait_us,
  :http_us, :total_us. Missing keys are skipped.
  """
  def record_latency(stack_id, breakdown) when is_map(breakdown) do
    tab = :"#{@table}:#{stack_id}"

    try do
      for seg <- @segments, value = Map.get(breakdown, seg), is_integer(value) do
        [{_, samples}] = :ets.lookup(tab, seg)
        :ets.insert(tab, {seg, [value | Enum.take(samples, @window_size - 1)]})
      end
    rescue
      _ -> :ok
    end
  end

  @doc "Return aggregate stats as a map."
  def get_stats(stack_id) do
    tab = :"#{@table}:#{stack_id}"

    try do
      Map.new(@segments, fn seg ->
        [{_, samples}] = :ets.lookup(tab, seg)
        key = seg |> Atom.to_string() |> String.trim_trailing("_us")
        unit = if seg == :consumer_us, do: :us, else: :ms
        {key, percentiles(samples, unit)}
      end)
    rescue
      _ ->
        Map.new(@segments, fn seg ->
          key = seg |> Atom.to_string() |> String.trim_trailing("_us")
          {key, %{count: 0}}
        end)
    end
  end

  defp percentiles([], _unit), do: %{count: 0}

  defp percentiles(samples, unit) do
    sorted = Enum.sort(samples)
    count = length(sorted)
    {suffix, convert} = unit_config(unit)

    %{}
    |> Map.put(:count, count)
    |> Map.put(:"min_#{suffix}", convert.(List.first(sorted)))
    |> Map.put(:"max_#{suffix}", convert.(List.last(sorted)))
    |> Map.put(:"mean_#{suffix}", convert.(div(Enum.sum(sorted), count)))
    |> Map.put(:"p50_#{suffix}", convert.(Enum.at(sorted, div(count, 2))))
    |> Map.put(:"p99_#{suffix}", convert.(Enum.at(sorted, trunc(count * 0.99))))
  end

  defp unit_config(:ms), do: {"ms", &Float.round(&1 / 1000, 1)}
  defp unit_config(:us), do: {"us", &Function.identity/1}
end
