defmodule Electric.ShapeCache.StorageTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache.MockStorage
  alias Electric.Replication.LogOffset

  import Mox

  setup :verify_on_exit!

  test "should pass through the calls to the storage module" do
    storage = {MockStorage, :opts}
    shape_id = "test"

    MockStorage
    |> Mox.expect(:make_new_snapshot!, fn _, _, _, _, :opts -> :ok end)
    |> Mox.expect(:snapshot_started?, fn _, :opts -> true end)
    |> Mox.expect(:get_snapshot, fn _, :opts -> {1, []} end)
    |> Mox.expect(:append_to_log!, fn _, _, :opts -> :ok end)
    |> Mox.expect(:get_log_stream, fn _, _, _, :opts -> [] end)
    |> Mox.expect(:has_shape?, fn _, :opts -> [] end)
    |> Mox.expect(:cleanup!, fn _, :opts -> :ok end)

    Storage.make_new_snapshot!(shape_id, %{}, %{}, [], storage)
    Storage.snapshot_started?(shape_id, storage)
    Storage.get_snapshot(shape_id, storage)
    Storage.append_to_log!(shape_id, [], storage)
    Storage.get_log_stream(shape_id, LogOffset.first(), storage)
    Storage.has_shape?(shape_id, storage)
    Storage.cleanup!(shape_id, storage)
  end

  test "get_log_stream/4 correctly guards offset ordering" do
    storage = {Electric.ShapeCache.MockStorage, :opts}

    MockStorage
    |> Mox.expect(:get_log_stream, fn _, _, _, :opts -> [] end)

    l1 = LogOffset.new(26_877_408, 10)
    l2 = LogOffset.new(26_877_648, 0)

    Storage.get_log_stream("test", l1, l2, storage)

    assert_raise FunctionClauseError, fn ->
      Storage.get_log_stream("test", l2, l1, storage)
    end
  end
end
