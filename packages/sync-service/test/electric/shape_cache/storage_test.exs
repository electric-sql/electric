defmodule Electric.ShapeCache.StorageTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.Storage
  alias Electric.Replication.LogOffset

  alias Support.Mock

  import Mox

  setup :verify_on_exit!

  test "should pass through the calls to the storage module" do
    storage = {Mock.Storage, :opts}
    shape_id = "test"

    Mock.Storage
    |> Mox.stub(:for_shape, fn ^shape_id, :opts, _ -> {shape_id, :opts} end)
    |> Mox.expect(:make_new_snapshot!, fn _, {^shape_id, :opts} -> :ok end)
    |> Mox.expect(:snapshot_started?, fn {^shape_id, :opts} -> true end)
    |> Mox.expect(:get_snapshot, fn {^shape_id, :opts} -> {1, []} end)
    |> Mox.expect(:append_to_log!, fn _, {^shape_id, :opts} -> :ok end)
    |> Mox.expect(:get_log_stream, fn _, _, {^shape_id, :opts} -> [] end)

    shape_storage = Storage.for_shape(shape_id, storage)

    Storage.make_new_snapshot!([], shape_storage)
    Storage.snapshot_started?(shape_storage)
    Storage.get_snapshot(shape_storage)
    Storage.append_to_log!([], shape_storage)
    Storage.get_log_stream(LogOffset.first(), shape_storage)
  end

  test "get_log_stream/4 correctly guards offset ordering" do
    storage = {Mock.Storage, :opts}

    Mock.Storage
    |> Mox.stub(:for_shape, fn shape_id, :opts, _ -> {shape_id, :opts} end)
    |> Mox.expect(:get_log_stream, fn _, _, {_shape_id, :opts} -> [] end)

    l1 = LogOffset.new(26_877_408, 10)
    l2 = LogOffset.new(26_877_648, 0)

    shape_storage = Storage.for_shape("test", storage)

    Storage.get_log_stream(l1, l2, shape_storage)

    assert_raise FunctionClauseError, fn ->
      Storage.get_log_stream(l2, l1, shape_storage)
    end
  end
end
