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

  @behaviour GenStage.Dispatcher

  @impl GenStage.Dispatcher
  def init(_opts) do
    {:ok, {0, 0, nil, [], MapSet.new()}}
  end

  @impl GenStage.Dispatcher
  def subscribe(opts, {pid, _ref} = from, {n, waiting, pending, subs, pids}) do
    if MapSet.member?(pids, pid) do
      Logger.error(fn ->
        "#{inspect(pid)} is already registered with #{inspect(self())}. " <>
          "This subscription has been discarded."
      end)

      {:error, :already_subscribed}
    else
      selector =
        case Keyword.get(opts, :selector) do
          nil ->
            nil

          selector when is_function(selector, 1) ->
            selector

          other ->
            raise ArgumentError,
                  ":selector option must be passed a unary function, got: #{inspect(other)}"
        end

      subs = [{from, selector} | subs]

      demand = if n == 0, do: 1, else: 0

      {:ok, demand, {n + 1, waiting, pending, subs, MapSet.put(pids, pid)}}
    end
  end

  @impl GenStage.Dispatcher
  def cancel({pid, _ref} = from, {n, waiting, pending, subs, pids}) do
    if MapSet.member?(pids, pid) do
      subs = List.keydelete(subs, from, 0)

      if pending && MapSet.member?(pending, from) do
        case waiting - 1 do
          0 ->
            # the only remaining unacked subscriber has cancelled, so we
            # return some demand
            {:ok, 1, {n - 1, 0, nil, subs, MapSet.delete(pids, pid)}}

          new_waiting ->
            {:ok, 0,
             {n - 1, new_waiting, MapSet.delete(pending, from), subs, MapSet.delete(pids, pid)}}
        end
      else
        {:ok, 0, {n - 1, waiting, pending, subs, MapSet.delete(pids, pid)}}
      end
    else
      {:ok, 0, {n, waiting, pending, subs, pids}}
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

  def ask(1, from, {n, waiting, pending, subs, pids}) when waiting > 1 do
    {:ok, 0, {n, waiting - 1, MapSet.delete(pending, from), subs, pids}}
  end

  @impl GenStage.Dispatcher
  def dispatch([event], _length, {n, 0, _pending, subs, pids}) do
    {waiting, pending} =
      subs
      |> Enum.reduce({0, MapSet.new()}, fn {{pid, ref} = sub, selector}, {waiting, pending} ->
        if subscriber_wants_message?(event, selector) do
          Process.send(pid, {:"$gen_consumer", {self(), ref}, [event]}, [:noconnect])
          {waiting + 1, MapSet.put(pending, sub)}
        else
          {waiting, pending}
        end
      end)
      |> case do
        {0, _pending} ->
          {0, nil}

        {waiting, pending} ->
          {waiting, pending}
      end

    {:ok, [], {n, waiting, pending, subs, pids}}
  end

  @impl GenStage.Dispatcher
  def info(msg, state) do
    send(self(), msg)
    {:ok, state}
  end

  defp subscriber_wants_message?(_event, nil), do: true
  defp subscriber_wants_message?(event, selector), do: selector.(event)
end
