defmodule Support.TransactionConsumer do
  use GenStage

  alias Electric.Replication.Changes.{Transaction, Relation}

  import ExUnit.Assertions

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts)
  end

  def assert_consume(consumers, evts) do
    for consumer <- consumers, into: MapSet.new() do
      assert_receive {Support.TransactionConsumer, ^consumer, received_evts}

      evts
      |> Enum.zip(received_evts)
      |> Enum.map(fn {expected, received} ->
        case expected do
          %Transaction{} = expected ->
            assert expected.xid == received.xid
            received.xid

          %Relation{} = expected ->
            assert expected.id == received.id
            received.id
        end
      end)
    end
    |> Enum.to_list()
    |> List.flatten()
  end

  def init(opts) do
    {:ok, producer} = Keyword.fetch(opts, :producer)
    {:ok, parent} = Keyword.fetch(opts, :parent)
    {:ok, id} = Keyword.fetch(opts, :id)
    partition = Keyword.get(opts, :partition, :transaction)

    {:consumer, {id, nil, parent}, subscribe_to: [{producer, [partition: partition]}]}
  end

  def handle_subscribe(:producer, _options, from, {id, _, parent}) do
    GenStage.ask(from, 1)
    {:manual, {id, from, parent}}
  end

  def handle_events([txn], _from, {id, subscription, parent}) do
    send(parent, {__MODULE__, {id, self()}, [txn]})
    GenStage.ask(subscription, 1)
    {:noreply, [], {id, subscription, parent}}
  end
end
