defmodule Electric.ShapeCache.StorageTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache.MockStorage
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes

  import Mox

  setup :verify_on_exit!

  test "should pass through the calls to the storage module" do
    storage = {MockStorage, :opts}
    shape_id = "test"

    MockStorage
    |> Mox.expect(:make_new_snapshot!, fn _, _, _, _, :opts -> :ok end)
    |> Mox.expect(:snapshot_exists?, fn _, :opts -> true end)
    |> Mox.expect(:get_snapshot, fn _, :opts -> {1, []} end)
    |> Mox.expect(:append_to_log!, fn _, _, :opts -> :ok end)
    |> Mox.expect(:get_log_stream, fn _, _, _, :opts -> [] end)
    |> Mox.expect(:has_log_entry?, fn _, _, :opts -> [] end)
    |> Mox.expect(:cleanup!, fn _, :opts -> :ok end)

    Storage.make_new_snapshot!(shape_id, %{}, %{}, [], storage)
    Storage.snapshot_exists?(shape_id, storage)
    Storage.get_snapshot(shape_id, storage)
    Storage.append_to_log!(shape_id, [], storage)
    Storage.get_log_stream(shape_id, LogOffset.first(), storage)
    Storage.has_log_entry?(shape_id, 1, storage)
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

  describe "prepare_change_for_storage/3" do
    test "stores an entire `NewRecord` value" do
      record = %Changes.NewRecord{
        key: "my_key",
        record: %{"pk" => "10", "hello" => "world"},
        log_offset: LogOffset.first(),
        relation: {"public", "test"}
      }

      assert Storage.prepare_change_for_storage(record, 1, ["pk"]) ==
               [
                 {LogOffset.first(), "my_key", :insert, %{"pk" => "10", "hello" => "world"},
                  %{txid: 1, relation: ["public", "test"]}}
               ]

      # And with empty PK
      assert Storage.prepare_change_for_storage(record, 1, []) ==
               [
                 {LogOffset.first(), "my_key", :insert, %{"pk" => "10", "hello" => "world"},
                  %{txid: 1, relation: ["public", "test"]}}
               ]
    end

    test "stores only PK of a `DeletedRecord` value" do
      record = %Changes.DeletedRecord{
        key: "my_key",
        old_record: %{"pk" => "10", "hello" => "world"},
        log_offset: LogOffset.first(),
        relation: {"public", "test"}
      }

      assert Storage.prepare_change_for_storage(record, 1, ["pk"]) ==
               [
                 {LogOffset.first(), "my_key", :delete, %{"pk" => "10"},
                  %{txid: 1, relation: ["public", "test"]}}
               ]
    end

    test "stores entire `DeletedRecord` value if table has no PK" do
      record = %Changes.DeletedRecord{
        key: "my_key",
        old_record: %{"value" => "10", "hello" => "world"},
        log_offset: LogOffset.first(),
        relation: {"public", "test"}
      }

      assert Storage.prepare_change_for_storage(record, 1, []) ==
               [
                 {LogOffset.first(), "my_key", :delete, %{"value" => "10", "hello" => "world"},
                  %{txid: 1, relation: ["public", "test"]}}
               ]
    end

    test "stores any changed columns and PK of an `UpdatedRecord` value" do
      record =
        Changes.UpdatedRecord.new(%{
          key: "my_key",
          old_record: %{"pk" => "10", "hello" => "world", "test" => "me"},
          record: %{"pk" => "10", "hello" => "world", "test" => "new"},
          log_offset: LogOffset.first(),
          relation: {"public", "test"}
        })

      assert Storage.prepare_change_for_storage(record, 1, ["pk"]) ==
               [
                 {LogOffset.first(), "my_key", :update, %{"pk" => "10", "test" => "new"},
                  %{txid: 1, relation: ["public", "test"]}}
               ]
    end

    test "splits up the `UpdatedRecord` if a key was changed, adding a reference to both" do
      record =
        Changes.UpdatedRecord.new(%{
          old_key: "old_key",
          key: "new_key",
          old_record: %{"pk" => "9", "hello" => "world", "test" => "me"},
          record: %{"pk" => "10", "hello" => "world", "test" => "new"},
          log_offset: LogOffset.first(),
          relation: {"public", "test"}
        })

      assert Storage.prepare_change_for_storage(record, 1, ["pk"]) ==
               [
                 {LogOffset.first(), "old_key", :delete, %{"pk" => "9"},
                  %{txid: 1, relation: ["public", "test"], key_change_to: "new_key"}},
                 {LogOffset.increment(LogOffset.first()), "new_key", :insert,
                  %{"pk" => "10", "hello" => "world", "test" => "new"},
                  %{txid: 1, relation: ["public", "test"], key_change_from: "old_key"}}
               ]
    end

    test "splits up the `UpdatedRecord` if a key was changed, adding a reference to both when no PK is defined" do
      record =
        Changes.UpdatedRecord.new(%{
          old_key: "old_key",
          key: "new_key",
          old_record: %{"hello" => "world", "test" => "me"},
          record: %{"hello" => "world", "test" => "new"},
          log_offset: LogOffset.first(),
          relation: {"public", "test"}
        })

      assert Storage.prepare_change_for_storage(record, 1, []) ==
               [
                 {LogOffset.first(), "old_key", :delete, %{"hello" => "world", "test" => "me"},
                  %{txid: 1, relation: ["public", "test"], key_change_to: "new_key"}},
                 {LogOffset.increment(LogOffset.first()), "new_key", :insert,
                  %{"hello" => "world", "test" => "new"},
                  %{txid: 1, relation: ["public", "test"], key_change_from: "old_key"}}
               ]
    end
  end
end
