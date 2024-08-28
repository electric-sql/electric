defmodule Support.TransactionConsumer do
  use GenStage

  alias Electric.Replication.Changes.Transaction

  import ExUnit.Assertions

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts)
  end

  def assert_consume(consumers, txns) do
    for consumer <- consumers, into: MapSet.new() do
      assert_receive {Support.TransactionConsumer, ^consumer, received_txns}

      txns
      |> Enum.zip(received_txns)
      |> Enum.map(fn {%Transaction{} = expected, %Transaction{} = received} ->
        assert expected.xid == received.xid

        received.xid
      end)
    end
    |> Enum.to_list()
    |> List.flatten()
  end

  def init(opts) do
    {:ok, producer} = Keyword.fetch(opts, :producer)
    {:ok, parent} = Keyword.fetch(opts, :parent)
    {:ok, id} = Keyword.fetch(opts, :id)

    {:consumer, {id, parent}, subscribe_to: [{producer, []}]}
  end

  def handle_events(events, _from, {id, parent}) do
    send(parent, {__MODULE__, {id, self()}, events})
    {:noreply, [], {id, parent}}
  end
end
