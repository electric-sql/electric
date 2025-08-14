defmodule Electric.Shapes.Consumer.MaterializerTest do
  use ExUnit.Case
  import Support.ComponentSetup
  use Repatch.ExUnit

  alias Electric.Replication.Changes
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Consumer
  alias Electric.Shapes.Consumer.Materializer

  setup [:with_stack_id_from_test, :with_in_memory_storage]

  setup %{storage: storage, stack_id: stack_id} do
    {:via, Registry, {registry_name, key}} = Consumer.name(stack_id, "test")

    Registry.register(registry_name, key, :consumer)

    Storage.for_shape("test", storage) |> Storage.start_link()
    Storage.for_shape("test", storage) |> Storage.mark_snapshot_as_started()
    Storage.for_shape("test", storage) |> then(&Storage.make_new_snapshot!([], &1))

    {:ok, shape_handle: "test"}
  end

  test "can get ready",
       %{storage: storage, stack_id: stack_id, shape_handle: shape_handle} = ctx do
    {:ok, pid} =
      Materializer.start_link(%{
        stack_id: stack_id,
        shape_handle: shape_handle,
        storage: storage,
        columns: ["value"],
        materialized_type: {:array, :int8}
      })

    receive do
      {:"$gen_call", {from, ref}, :await_snapshot_start} ->
        send(from, {ref, :ok})
    end

    assert Materializer.wait_until_ready(ctx) == :ok
  end

  test "new changes are materialized correctly",
       %{storage: storage, stack_id: stack_id, shape_handle: shape_handle} = ctx do
    {:ok, pid} =
      Materializer.start_link(%{
        stack_id: stack_id,
        shape_handle: shape_handle,
        storage: storage,
        columns: ["value"],
        materialized_type: {:array, :int8}
      })

    receive do
      {:"$gen_call", {from, ref}, :await_snapshot_start} ->
        send(from, {ref, :ok})
    end

    assert Materializer.wait_until_ready(ctx) == :ok

    Materializer.new_changes(ctx, [
      %Changes.NewRecord{key: "1", record: %{"value" => "1"}},
      %Changes.NewRecord{key: "2", record: %{"value" => "2"}},
      %Changes.NewRecord{key: "3", record: %{"value" => "3"}}
    ])

    assert Materializer.get_link_values(ctx) == MapSet.new([1, 2, 3])
  end
end
