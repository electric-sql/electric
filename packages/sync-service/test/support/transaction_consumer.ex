defmodule Support.TransactionConsumer do
  use GenServer, restart: :temporary

  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.TransactionFragment

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
          %TransactionFragment{} = txn_fragment ->
            assert %TransactionFragment{} = received

            assert Map.drop(received, [:changes, :affected_relations, :change_count]) ==
                     Map.drop(txn_fragment, [:changes, :affected_relations, :change_count])

            assert length(received.changes) == length(txn_fragment.changes)

            Enum.zip(received.changes, txn_fragment.changes)
            |> Enum.each(fn {received_change, expected_change} ->
              assert Map.drop(received_change, [:key, :old_key]) ==
                       Map.drop(expected_change, [:key, :old_key])
            end)

            txn_fragment.xid

          %Relation{id: id} ->
            assert %Relation{id: ^id} = received
            id
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
    {:ok, producer} = Keyword.fetch(opts, :producer)
    {:ok, parent} = Keyword.fetch(opts, :parent)
    {:ok, id} = Keyword.fetch(opts, :id)
    action = Keyword.get(opts, :action, :create)
    shape = Keyword.fetch!(opts, :shape)
    shape_handle = Keyword.fetch!(opts, :shape_handle)

    Electric.Replication.ShapeLogCollector.subscribe(producer, shape_handle, shape, action)

    {:ok, %{id: id, producer: producer, parent: parent, shape_handle: shape_handle}}
  end

  def handle_call({:handle_event, %TransactionFragment{} = txn_fragment, _ctx}, _from, state) do
    send(state.parent, {__MODULE__, {state.id, self()}, [txn_fragment]})
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
  def terminate(reason, %{producer: producer, shape_handle: shape_handle} = state) do
    send(state.parent, {__MODULE__, {state.id, self()}, {:terminate, reason}})
    Electric.Replication.ShapeLogCollector.remove_shape(producer, shape_handle)
  end

  def handle_info(_msg, state), do: {:noreply, state}
end
