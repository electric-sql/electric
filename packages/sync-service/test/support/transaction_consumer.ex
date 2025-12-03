defmodule Support.TransactionConsumer do
  use GenServer, restart: :temporary

  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.Begin
  alias Electric.Replication.TransactionBuilder

  import ExUnit.Assertions

  def name(stack_id, shape_handle) do
    Electric.Shapes.ConsumerRegistry.name(stack_id, shape_handle)
  end

  def name(opts) when is_list(opts) do
    name(Keyword.fetch!(opts, :stack_id), Keyword.fetch!(opts, :shape_handle))
  end

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: name(opts))
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

          [%Begin{xid: xid} | _] ->
            assert %Transaction{} = received
            assert xid == received.xid
            received.xid
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

  def stop(pid, reason) do
    GenServer.cast(pid, {:stop, reason})
  end

  def init(opts) do
    Process.flag(:trap_exit, true)
    {:ok, stack_id} = Keyword.fetch(opts, :stack_id)
    {:ok, parent} = Keyword.fetch(opts, :parent)
    {:ok, id} = Keyword.fetch(opts, :id)
    action = Keyword.get(opts, :action, :create)
    shape = Keyword.fetch!(opts, :shape)
    shape_handle = Keyword.fetch!(opts, :shape_handle)

    Electric.Replication.ShapeLogCollector.subscribe(stack_id, shape_handle, shape, action)

    {:ok, %{id: id, stack_id: stack_id, parent: parent, shape_handle: shape_handle}}
  end

  def handle_call({:handle_event, %Transaction{} = txn, _ctx}, _from, state) do
    send(state.parent, {__MODULE__, {state.id, self()}, [txn]})
    {:reply, :ok, state}
  end

  def handle_call({:handle_event, changes, _ctx}, _from, state) when is_list(changes) do
    # Build Transaction from list of changes
    builder = TransactionBuilder.new()
    {results, _builder} = TransactionBuilder.build(changes, builder)
    send(state.parent, {__MODULE__, {state.id, self()}, results})
    {:reply, :ok, state}
  end

  def handle_call({:handle_event, %Relation{} = relation, _ctx}, _from, state) do
    send(state.parent, {__MODULE__, {state.id, self()}, [relation]})
    {:reply, :ok, state}
  end

  def handle_cast({:stop, reason}, state) do
    {:stop, reason, state}
  end

  # we no longer monitor consumer processes in the ShapeLogCollector
  # so consumers must de-register themselves
  def terminate(reason, %{stack_id: stack_id, shape_handle: shape_handle} = state) do
    send(state.parent, {__MODULE__, {state.id, self()}, {:terminate, reason}})
    Electric.Replication.ShapeLogCollector.unsubscribe(stack_id, shape_handle)
  end

  def handle_info(_msg, state), do: {:noreply, state}
end
