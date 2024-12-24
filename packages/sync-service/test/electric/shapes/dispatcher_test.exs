defmodule Electric.Shapes.DispatcherTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Shape
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Transaction
  alias Electric.Shapes.Dispatcher, as: D
  alias Support.StubInspector

  @inspector StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])
  @shape Shape.new!("the_table", where: "id = 1", inspector: @inspector)
  @other_shape Shape.new!("the_table", where: "id = 2", inspector: @inspector)

  @transaction %Transaction{
    changes: [
      %NewRecord{
        relation: {"public", "the_table"},
        record: %{"id" => "1"}
      }
    ]
  }

  defp dispatcher() do
    {:ok, state} = D.init(inspector: @inspector)
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

  test "demand is only sent to producer once all subscribers have processed the message" do
    dispatcher = dispatcher()

    c1 = {_pid1, ref1} = consumer(1)
    c2 = {_pid2, ref2} = consumer(2)
    c3 = {_pid3, ref3} = consumer(3)

    # we only want to send a single event for any number of consumers
    {:ok, 1, dispatcher} = D.subscribe([shape: @shape], c1, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([shape: @shape], c2, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([shape: @shape], c3, dispatcher)

    event = @transaction

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

    {:ok, 1, dispatcher} = D.subscribe([shape: @other_shape], c1, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([shape: @shape], c2, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([shape: @shape], c3, dispatcher)

    event = @transaction

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

    {:ok, 1, dispatcher} = D.subscribe([shape: @shape], c1, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([shape: @shape], c2, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([shape: @shape], c3, dispatcher)

    event = @transaction

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

    {:ok, 1, dispatcher} = D.subscribe([shape: @shape], c1, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([shape: @shape], c2, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([shape: @shape], c3, dispatcher)

    event = @transaction

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
    {:ok, 1, dispatcher} = D.subscribe([shape: @shape], c1, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([shape: @shape], c2, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([shape: @shape], c3, dispatcher)

    event = @transaction

    {:ok, [], dispatcher} = D.dispatch([event], 1, dispatcher)

    assert_receive {C, ^ref1, [^event]}
    assert {:ok, 0, dispatcher} = D.ask(1, c1, dispatcher)

    {:ok, 0, dispatcher} = D.cancel(c2, dispatcher)
    {:ok, 1, _dispatcher} = D.cancel(c3, dispatcher)
  end

  test "if no consumers want the message then we return demand" do
    dispatcher = dispatcher()

    c1 = {_pid1, ref1} = consumer(1)
    c2 = {_pid2, ref2} = consumer(2)
    c3 = {_pid3, ref3} = consumer(3)

    {:ok, 1, dispatcher} = D.subscribe([shape: @other_shape], c1, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([shape: @other_shape], c2, dispatcher)
    {:ok, 0, dispatcher} = D.subscribe([shape: @other_shape], c3, dispatcher)

    event = @transaction

    {:ok, [], dispatcher} = D.dispatch([event], 1, dispatcher)
    refute_receive {C, ^ref1, [^event]}
    refute_receive {C, ^ref2, [^event]}
    refute_receive {C, ^ref3, [^event]}
    # none of the subscribers want the event, but we need to simulate the full cycle
    # so the dispatcher should generate some fake demand. This goes to the 
    # last subscriber, which is at the head of the list
    assert_receive {:"$gen_producer", {_pid, ^ref3}, {:ask, 1}}
    assert {:ok, 1, _dispatcher} = D.ask(1, c3, dispatcher)
  end
end
