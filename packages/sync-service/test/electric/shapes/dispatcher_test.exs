defmodule Electric.Shapes.DispatcherTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Dispatcher, as: D

  defp dispatcher(opts \\ []) do
    {:ok, state} = D.init(opts)
    state
  end

  defmodule C do
    def child_spec({id, a}) do
      %{
        id: {__MODULE__, id},
        start: {Task, :start_link, [__MODULE__, :consume, a]}
      }
    end

    def consume(parent, subscription) do
      receive do
        {:"$gen_consumer", {producer, ref}, events} ->
          Process.sleep(Enum.random(10..100))
          send(producer, {C, ref, events})
          consume(parent, subscription)
      end
    end
  end

  defp consumer(id) do
    ref = make_ref()
    {:ok, pid} = start_supervised({C, {id, [self(), ref]}})
    {pid, ref}
  end

  defp is_even(n), do: rem(n, 2) == 0
  defp is_odd(n), do: rem(n, 2) == 1

  test "demand is only sent to producer once all subscribers have processed the message" do
    dispatcher = dispatcher()

    c1 = {_pid1, ref1} = consumer(1)
    c2 = {_pid2, ref2} = consumer(2)
    c3 = {_pid3, ref3} = consumer(3)

    # we only want to send a single event for any number of consumers
    {:ok, 1, dispatcher} = D.subscribe([selector: &is_even/1], c1, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([selector: &is_even/1], c2, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([selector: &is_even/1], c3, dispatcher)

    event = 2

    {:ok, [], dispatcher} = D.dispatch([event], 1, dispatcher)

    assert_receive {C, ^ref1, [^event]}
    assert {:ok, 0, dispatcher} = D.ask(1, c1, dispatcher)
    assert_receive {C, ^ref2, [^event]}
    assert {:ok, 0, dispatcher} = D.ask(1, c2, dispatcher)
    assert_receive {C, ^ref3, [^event]}
    # now that all consumers have received and processed the message we should
    # forward demand onto the producer
    assert {:ok, 1, _dispatcher} = D.ask(1, c3, dispatcher)
  end

  test "subscribers only receive messages that pass their selector" do
    dispatcher = dispatcher()

    c1 = {_pid1, ref1} = consumer(1)
    c2 = {_pid2, ref2} = consumer(2)
    c3 = {_pid3, ref3} = consumer(3)

    {:ok, 1, dispatcher} = D.subscribe([selector: &is_odd/1], c1, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([selector: &is_even/1], c2, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([selector: &is_even/1], c3, dispatcher)

    event = 2

    {:ok, [], dispatcher} = D.dispatch([event], 1, dispatcher)

    refute_receive {C, ^ref1, [^event]}

    assert_receive {C, ^ref2, [^event]}
    assert {:ok, 0, dispatcher} = D.ask(1, c2, dispatcher)
    assert_receive {C, ^ref3, [^event]}
    assert {:ok, 1, _dispatcher} = D.ask(1, c3, dispatcher)
  end

  test "cancelling an acked consumer does not affect pending acks" do
    dispatcher = dispatcher()

    c1 = {_pid1, ref1} = consumer(1)
    c2 = {_pid2, ref2} = consumer(2)
    c3 = {_pid3, ref3} = consumer(3)

    {:ok, 1, dispatcher} = D.subscribe([selector: &is_even/1], c1, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([selector: &is_even/1], c2, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([selector: &is_even/1], c3, dispatcher)

    event = 2

    {:ok, [], dispatcher} = D.dispatch([event], 1, dispatcher)

    assert_receive {C, ^ref1, [^event]}
    assert {:ok, 0, dispatcher} = D.ask(1, c1, dispatcher)

    {:ok, 0, dispatcher} = D.cancel(c1, dispatcher)

    assert_receive {C, ^ref2, [^event]}
    assert {:ok, 0, dispatcher} = D.ask(1, c2, dispatcher)
    assert_receive {C, ^ref3, [^event]}
    assert {:ok, 1, _dispatcher} = D.ask(1, c3, dispatcher)
  end

  test "cancelling an unacked consumer decrements pending acks" do
    dispatcher = dispatcher()

    c1 = {_pid1, ref1} = consumer(1)
    c2 = {_pid2, ref2} = consumer(2)
    c3 = {_pid3, ref3} = consumer(3)

    {:ok, 1, dispatcher} = D.subscribe([], c1, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([selector: &is_even/1], c2, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([selector: &is_even/1], c3, dispatcher)

    event = 2

    {:ok, [], dispatcher} = D.dispatch([event], 1, dispatcher)

    {:ok, 0, dispatcher} = D.cancel(c2, dispatcher)

    assert_receive {C, ^ref1, [^event]}
    assert {:ok, 0, dispatcher} = D.ask(1, c1, dispatcher)

    # we've cancelled but haven't killed the pid (and even if we had, it will
    # have likely already sent the confirmation message)
    assert_receive {C, ^ref2, [^event]}

    assert_receive {C, ^ref3, [^event]}
    assert {:ok, 1, _dispatcher} = D.ask(1, c3, dispatcher)
  end

  test "cancelling the last unacked consumer generates demand" do
    dispatcher = dispatcher()

    c1 = {_pid1, ref1} = consumer(1)
    c2 = {_pid2, _ref2} = consumer(2)
    c3 = {_pid3, _ref3} = consumer(3)

    # we only want to send a single event for any number of consumers
    {:ok, 1, dispatcher} = D.subscribe([], c1, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([selector: &is_even/1], c2, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([selector: &is_even/1], c3, dispatcher)

    event = 2

    {:ok, [], dispatcher} = D.dispatch([event], 1, dispatcher)

    assert_receive {C, ^ref1, [^event]}
    assert {:ok, 0, dispatcher} = D.ask(1, c1, dispatcher)

    {:ok, 0, dispatcher} = D.cancel(c2, dispatcher)
    {:ok, 1, _dispatcher} = D.cancel(c3, dispatcher)
  end
end
