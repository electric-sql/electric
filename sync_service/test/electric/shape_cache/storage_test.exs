defmodule Electric.ShapeCache.StorageTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.Storage
  import Mox

  setup :verify_on_exit!

  test "should pass through the calls to the storage module" do
    storage = {Electric.ShapeCache.MockStorage, :opts}
    shape_id = "test"

    Electric.ShapeCache.MockStorage
    |> Mox.expect(:make_new_snapshot!, fn _, _, _, :opts -> :ok end)
    |> Mox.expect(:snapshot_exists?, fn _, :opts -> true end)
    |> Mox.expect(:get_snapshot, fn _, :opts -> {1, []} end)
    |> Mox.expect(:append_to_log!, fn _, _, _, _, :opts -> :ok end)
    |> Mox.expect(:get_log_stream, fn _, _, :opts -> [] end)
    |> Mox.expect(:cleanup!, fn _, :opts -> :ok end)

    Storage.make_new_snapshot!(shape_id, %{}, [], storage)
    Storage.snapshot_exists?(shape_id, storage)
    Storage.get_snapshot(shape_id, storage)
    Storage.append_to_log!(shape_id, 1, 1, [], storage)
    Storage.get_log_stream(shape_id, -1, storage)
    Storage.cleanup!(shape_id, storage)
  end
end
