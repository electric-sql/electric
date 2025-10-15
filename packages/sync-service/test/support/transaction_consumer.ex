defmodule Support.TransactionConsumer do
  use GenServer

  alias Electric.Replication.Changes.{Transaction, Relation}

  import ExUnit.Assertions

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  def assert_consume(consumers, evts, timeout \\ 100) do
    for consumer <- consumers, into: MapSet.new() do
      assert_receive {Support.TransactionConsumer, ^consumer, received_evts}, timeout

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

  def refute_consume(consumers, timeout \\ 100) do
    for consumer <- consumers do
      refute_receive {Support.TransactionConsumer, ^consumer, _}, timeout
    end
  end

  def init(opts) do
    Process.flag(:trap_exit, true)
    {:ok, producer} = Keyword.fetch(opts, :producer)
    {:ok, parent} = Keyword.fetch(opts, :parent)
    {:ok, id} = Keyword.fetch(opts, :id)
    action = Keyword.get(opts, :action, :create)
    shape = Keyword.fetch!(opts, :shape)
    shape_handle = Keyword.fetch!(opts, :shape_handle)

    Electric.Replication.ShapeLogCollector.subscribe(producer, shape_handle, shape, action)

    {:ok, %{id: id, producer: producer, parent: parent, shape_handle: shape_handle}}
  end

  def handle_call({:handle_event, txn, _ctx}, _from, state) do
    send(state.parent, {__MODULE__, {state.id, self()}, [txn]})
    {:reply, :ok, state}
  end

  # we no longer monitor consumer processes in the ShapeLogCollector
  # so consumers must de-register themselves
  def terminate(reason, %{producer: producer, shape_handle: shape_handle} = state) do
    send(state.parent, {__MODULE__, {state.id, self()}, {:terminate, reason}})
    Electric.Replication.ShapeLogCollector.unsubscribe(producer, shape_handle)
  end

  def handle_info(_msg, state), do: {:noreply, state}
end
