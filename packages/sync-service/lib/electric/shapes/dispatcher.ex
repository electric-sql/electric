defmodule Electric.Shapes.Dispatcher do
  @moduledoc """
  Dispatches transactions and relations to consumers filtered according to the
  subscriber's `selector` function.

  To receive all messages, don't pass a selector function or use `nil`, e.g.

  ```
  def init(producer) do
    {:consumer, :nostate, subscribe_to: [{producer, [max_demand: 1, selector: nil]}]}
  end

  ```

  The essential behaviour is that the dispatcher only asks the producer for
  more demand once all relevant subscribers have processed the last message and
  asked for the next.

  This behaviour is subtly different from `GenStage.BroadcastDispatcher` in
  that events that don't match the consumer's selector do not generate demand.
  We only wait for the consumers who received the event to ack successful
  processing before forwarding demand onto the producer.

  This is not a generalised dispatcher, its behaviour is specialised to our
  requirements. Demand is always 1 -- consumers MUST only ever ask for a single
  message from the producer and the dispatcher MUST only ever receive
  1 message from the producer to dispatch.

  This can be done by subscribing with `max_demand: 1` or using manual demand
  and calling `GenStage.ask(producer, 1)`.
  """

  require Logger
  alias Electric.Shapes.Filter

  @behaviour GenStage.Dispatcher

  @impl GenStage.Dispatcher
  def init(_opts) do
    {:ok, {0, 0, nil, [], Filter.empty(), MapSet.new()}}
  end

  @impl GenStage.Dispatcher
  def subscribe(opts, {pid, _ref} = from, {n, waiting, pending, subs, filter, pids}) do
    if MapSet.member?(pids, pid) do
      Logger.error(fn ->
        "#{inspect(pid)} is already registered with #{inspect(self())}. " <>
          "This subscription has been discarded."
      end)

      {:error, :already_subscribed}
    else
      shape = Keyword.fetch!(opts, :shape)

      subs = [{from, shape} | subs]

      demand = if n == 0, do: 1, else: 0

      filter = Filter.add_shape(filter, from, shape)

      {:ok, demand, {n + 1, waiting, pending, subs, filter, MapSet.put(pids, pid)}}
    end
  end

  @impl GenStage.Dispatcher
  def cancel({pid, _ref} = from, {n, waiting, pending, subs, filter, pids}) do
    if MapSet.member?(pids, pid) do
      subs = List.keydelete(subs, from, 0)

      filter = Filter.remove_shape(filter, from)

      if pending && MapSet.member?(pending, from) do
        case waiting - 1 do
          0 ->
            # the only remaining unacked subscriber has cancelled, so we
            # return some demand
            {:ok, 1, {n - 1, 0, nil, subs, MapSet.delete(pids, pid)}}

          new_waiting ->
            {:ok, 0,
             {n - 1, new_waiting, MapSet.delete(pending, from), subs, filter,
              MapSet.delete(pids, pid)}}
        end
      else
        {:ok, 0, {n - 1, waiting, pending, subs, filter, MapSet.delete(pids, pid)}}
      end
    else
      {:ok, 0, {n, waiting, pending, subs, filter, pids}}
    end
  end

  @impl GenStage.Dispatcher
  # consumers sending demand before we have produced a message just ignore as
  # we have already sent initial demand of 1 to the producer when the first
  # consumer subscribed.
  def ask(1, {_pid, _ref}, {n, 0, nil, subs, filter, pids}) do
    {:ok, 0, {n, 0, nil, subs, filter, pids}}
  end

  def ask(1, {_pid, _ref}, {n, 1, _pending, subs, filter, pids}) do
    {:ok, 1, {n, 0, nil, subs, filter, pids}}
  end

  def ask(1, from, {n, waiting, pending, subs, filter, pids}) when waiting > 1 do
    {:ok, 0, {n, waiting - 1, MapSet.delete(pending, from), subs, filter, pids}}
  end

  @impl GenStage.Dispatcher
  # handle the no subscribers case here to make the real dispatch impl easier
  def dispatch([event], _length, {_n, 0, _pending, [], _filter, _pids} = state) do
    {:ok, [event], state}
  end

  def dispatch([event], _length, {n, 0, _pending, subs, filter, pids}) do
    {waiting, pending} =
      filter
      |> Filter.affected_shapes(event)
      |> Enum.reduce({0, MapSet.new()}, fn {pid, ref} = sub, {waiting, pending} ->
        Process.send(pid, {:"$gen_consumer", {self(), ref}, [event]}, [:noconnect])
        {waiting + 1, MapSet.put(pending, sub)}
      end)
      |> case do
        {0, _pending} ->
          # even though no subscriber wants the event, we still need to generate demand
          # so that we can complete the loop in the log collector
          [{sub, _selector} | _] = subs
          send(self(), {:"$gen_producer", sub, {:ask, 1}})
          {1, MapSet.new([sub])}

        {waiting, pending} ->
          {waiting, pending}
      end

    {:ok, [], {n, waiting, pending, subs, filter, pids}}
  end

  @impl GenStage.Dispatcher
  def info(msg, state) do
    send(self(), msg)
    {:ok, state}
  end
end
