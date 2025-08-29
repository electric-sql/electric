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
    {:ok, _pid} =
      Materializer.start_link(%{
        stack_id: stack_id,
        shape_handle: shape_handle,
        storage: storage,
        columns: ["value"],
        materialized_type: {:array, :int8}
      })

    respond_to_call(:await_snapshot_start, :ok)
    respond_to_call(:subscribe_materializer, :ok)

    assert Materializer.wait_until_ready(ctx) == :ok
  end

  test "new changes are materialized correctly",
       %{storage: storage, stack_id: stack_id, shape_handle: shape_handle} = ctx do
    {:ok, _pid} =
      Materializer.start_link(%{
        stack_id: stack_id,
        shape_handle: shape_handle,
        storage: storage,
        columns: ["value"],
        materialized_type: {:array, :int8}
      })

    respond_to_call(:await_snapshot_start, :ok)
    respond_to_call(:subscribe_materializer, :ok)

    assert Materializer.wait_until_ready(ctx) == :ok

    Materializer.new_changes(ctx, [
      %Changes.NewRecord{key: "1", record: %{"value" => "1"}},
      %Changes.NewRecord{key: "2", record: %{"value" => "2"}},
      %Changes.NewRecord{key: "3", record: %{"value" => "3"}}
    ])

    assert Materializer.get_link_values(ctx) == MapSet.new([1, 2, 3])
  end

  test "materializer correctly maps non-pk changes", %{shape_handle: shape_handle} = ctx do
    {:ok, _pid} =
      Materializer.start_link(%{
        stack_id: ctx.stack_id,
        shape_handle: shape_handle,
        storage: ctx.storage,
        columns: ["value"],
        materialized_type: {:array, :int8}
      })

    respond_to_call(:await_snapshot_start, :ok)
    respond_to_call(:subscribe_materializer, :ok)

    assert Materializer.wait_until_ready(ctx) == :ok
    Materializer.subscribe(ctx)

    Materializer.new_changes(ctx, [
      %Changes.NewRecord{key: "1", record: %{"value" => "1"}},
      %Changes.NewRecord{key: "2", record: %{"value" => "2"}},
      %Changes.NewRecord{key: "3", record: %{"value" => "1"}}
    ])

    assert Materializer.get_link_values(ctx) == MapSet.new([1, 2])

    assert_receive {:materializer_changes, ^shape_handle, move_in: 1, move_in: 2}

    Materializer.new_changes(ctx, [
      %Changes.UpdatedRecord{key: "2", record: %{"value" => "3"}, old_record: %{"value" => "2"}},
      %Changes.DeletedRecord{key: "3", old_record: %{"value" => "1"}},
      %Changes.UpdatedRecord{key: "1", record: %{"other" => "1"}, old_record: %{"other" => "0"}}
    ])

    assert Materializer.get_link_values(ctx) == MapSet.new([1, 3])

    assert_receive {:materializer_changes, ^shape_handle, move_out: 2, move_in: 3}
  end

  defp respond_to_call(request, response) do
    receive do
      {:"$gen_call", {from, ref}, ^request} ->
        send(from, {ref, response})
    end
  end
end
