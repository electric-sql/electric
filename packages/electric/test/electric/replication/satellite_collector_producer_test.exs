defmodule Electric.Replication.SatelliteCollectorProducerTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.SatelliteCollectorProducer, as: Producer
  alias Electric.DummyConsumer

  setup do
    {:ok, pid} = Producer.start_link(origin: "satellite-collector-producer-test")
    %{producer: pid}
  end

  test "producer immediately fulfills the demand if txs are available", %{producer: producer} do
    assert :ok = Producer.store_incoming_transactions(producer, [tx(), tx(), tx()])

    {:ok, _} = DummyConsumer.start_link(notify: self(), subscribe_to: [{producer, []}])

    assert_receive {:dummy_consumer, ^producer, [_, _, _]}
  end

  test "producer allows specifying a starting point on reconnect", %{producer: producer} do
    assert :ok = Producer.store_incoming_transactions(producer, [tx(), tx(), tx()])

    {:ok, consumer} =
      DummyConsumer.start_link(notify: self(), subscribe_to: [{producer, cancel: :temporary}])

    # Get all the transactions
    assert_receive {:dummy_consumer, ^producer, [_, {_, second}, {_, third}]}
    GenServer.stop(consumer)
    assert :ok = Producer.store_incoming_transactions(producer, [tx()])

    # Tell the server that we want everything since second tx
    {:ok, _} =
      DummyConsumer.start_link(notify: self(), subscribe_to: [{producer, starting_from: second}])

    # Get the third and the fourth items
    assert_receive {:dummy_consumer, ^producer, [{_, ^third}, _]}
  end

  test "producer correctly forwards new events", %{producer: producer} do
    assert :ok = Producer.store_incoming_transactions(producer, [tx(), tx(), tx()])

    {:ok, _} =
      DummyConsumer.start_link(notify: self(), subscribe_to: [{producer, cancel: :temporary}])

    # Get all the transactions
    assert_receive {:dummy_consumer, ^producer, [_, _, {_, third}]}

    assert :ok = Producer.store_incoming_transactions(producer, [tx(), tx()])
    assert_receive {:dummy_consumer, ^producer, [{_, fourth}, _]}

    assert third < fourth
  end

  test "producer allows notifying about persisted items to garbage-collect", %{producer: producer} do
    assert :ok = Producer.store_incoming_transactions(producer, [tx(), tx(), tx()])

    {:ok, consumer} =
      DummyConsumer.start_link(notify: self(), subscribe_to: [{producer, cancel: :temporary}])

    # Get all the transactions
    assert_receive {:dummy_consumer, ^producer, [_, {_, second}, {_, third}]}
    GenServer.stop(consumer)
    assert :ok = Producer.store_incoming_transactions(producer, [tx()])

    # Notify for GC
    send(producer, {:sent_all_up_to, third})

    # Connection from second TX will not yield third because it has been garbage collected
    {:ok, _} =
      DummyConsumer.start_link(notify: self(), subscribe_to: [{producer, starting_from: second}])

    assert_receive {:dummy_consumer, ^producer, [{_, fourth}]}
    refute third == fourth
  end

  test ~s'produce connection "in the future" starts from scratch', %{producer: producer} do
    assert :ok = Producer.store_incoming_transactions(producer, [tx(), tx(), tx()])

    # Arbitrary point in the future
    {:ok, _} =
      DummyConsumer.start_link(notify: self(), subscribe_to: [{producer, starting_from: 10000}])

    # Get all the transactions
    assert_receive {:dummy_consumer, ^producer, [_, _, _]}
  end

  defp tx() do
    %Transaction{
      changes: ["change 1"],
      origin: "client_id",
      lsn: <<0, 0, 0, 1>>
    }
  end
end
