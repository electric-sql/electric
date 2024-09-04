defmodule Electric.Shapes.Dispatcher do
  @moduledoc """
  Dispatches transactions and relations to consumers

  Has two kinds of subscribers:

  - shape consumers which receive both transaction and relation/metadata
    messages
  - shape cache consumers which only receive metadata messages


  The essential behaviour is that the dispatcher only asks the producer for
  more demand once all relevant subscribers have processed the last message and
  asked for the next.

  Demand is always `1` -- consumers should only ever ask for a single message
  from the producer, the dispatcher should only ever send 1 message from the
  producer.
  """

  require Logger

  @behaviour GenStage.Dispatcher

  @impl GenStage.Dispatcher
  def init(_opts) do
    {:ok, {0, 0, nil, %{}, %{}}}
  end

  @impl GenStage.Dispatcher
  def subscribe(opts, {pid, _ref} = from, {n, count, pending, subs, pids}) do
    if Map.has_key?(pids, pid) do
      Logger.error(fn ->
        "#{inspect(pid)} is already registered with #{inspect(self())}. " <>
          "This subscription has been discarded."
      end)

      {:error, :already_subscribed}
    else
      case Keyword.fetch(opts, :partition) do
        {:ok, partition} when partition in [:transaction, :relation] ->
          partitions =
            case partition do
              :transaction -> [:transaction, :relation]
              :relation -> [:relation]
            end

          subs =
            Enum.reduce(partitions, subs, fn partition, subs ->
              Map.update(subs, partition, [from], &[from | &1])
            end)

          demand = if n == 0, do: 1, else: 0

          {:ok, demand, {n + 1, count, pending, subs, Map.put(pids, pid, partitions)}}

        {:ok, unknown_partition} ->
          Logger.error(fn ->
            ":partition should be one of [:relation, :all], got: #{inspect(unknown_partition)}"
          end)

          {:error, :invalid_partition}

        :error ->
          {:error, :missing_partition}
      end
    end
  end

  @impl GenStage.Dispatcher
  def cancel({pid, _ref} = from, {n, count, pending, subs, pids}) do
    if partitions = Map.get(pids, pid, nil) do
      subs =
        Enum.reduce(partitions, subs, fn partition, subs ->
          Map.update!(subs, partition, &List.delete(&1, from))
        end)

      if pending && MapSet.member?(pending, from) do
        case count - 1 do
          0 ->
            {:ok, 1, {n - 1, 0, nil, subs, Map.delete(pids, pid)}}

          new_count ->
            {:ok, 0,
             {n - 1, new_count, MapSet.delete(pending, from), subs, Map.delete(pids, pid)}}
        end
      else
        {:ok, 0, {n - 1, count, pending, subs, Map.delete(pids, pid)}}
      end
    else
      {:ok, 0, {n, count, pending, subs, pids}}
    end
  end

  @impl GenStage.Dispatcher
  # consumers sending demand before we have produced a message just ignore as
  # we have already sent initial demand of 1 to the producer when the first
  # consumer subscribed.
  def ask(1, {_pid, _ref}, {n, 0, nil, subs, pids}) do
    {:ok, 0, {n, 0, nil, subs, pids}}
  end

  def ask(1, {_pid, _ref}, {n, 1, _pending, subs, pids}) do
    {:ok, 1, {n, 0, nil, subs, pids}}
  end

  def ask(1, from, {n, count, pending, subs, pids}) when count > 1 do
    {:ok, 0, {n, count - 1, MapSet.delete(pending, from), subs, pids}}
  end

  @impl GenStage.Dispatcher
  def dispatch([{partition, event}], _length, {n, 0, _pending, subs, pids})
      when partition in [:transaction, :relation] do
    subscriptions = Map.get(subs, partition, [])

    {count, pending} =
      subscriptions
      |> Enum.reduce({0, MapSet.new()}, fn {pid, ref} = sub, {count, pending} ->
        Process.send(pid, {:"$gen_consumer", {self(), ref}, [event]}, [:noconnect])
        {count + 1, MapSet.put(pending, sub)}
      end)
      |> case do
        {0, _pending} ->
          {0, nil}

        {count, pending} ->
          {count, pending}
      end

    {:ok, [], {n, count, pending, subs, pids}}
  end

  @impl GenStage.Dispatcher
  def info(msg, state) do
    send(self(), msg)
    {:ok, state}
  end
end
