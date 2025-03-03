defmodule Electric.ShapeCache.FileStorage.CompactionTest do
  use ExUnit.Case, async: true
  alias Support.TestUtils
  import Support.TestUtils, only: [ins: 1, del: 1, upd: 1]
  alias Electric.ShapeCache.FileStorage.Compaction
  alias Electric.ShapeCache.FileStorage.LogFile
  alias Electric.Replication.LogOffset

  @moduletag :tmp_dir

  describe "compact_in_place/2" do
    test "removes txid headers during first compaction only", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "txid_test_log")

      log_stream = [
        {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert,
         ~S|{"value":"v1","headers":{"operation": "insert", "txids":[123]}}|},
        {%LogOffset{tx_offset: 2, op_offset: 1}, "key1", :update,
         ~S|{"value":"v2","headers":{"operation": "update", "txids":[124]}}|},
        {%LogOffset{tx_offset: 3, op_offset: 1}, "key2", :delete,
         ~S|{"value":"v3","headers":{"operation": "delete", "txids":[125]}}|}
      ]

      paths = LogFile.write_log_file(log_stream, log_file_path)

      # First compaction
      paths = Compaction.compact_in_place(paths, 1_000_000)

      # Verify first compaction removed txid from insert/delete but left update untouched
      entries = LogFile.read_chunk(paths, LogOffset.first()) |> Enum.to_list()

      assert [
               %{"operation" => "insert"},
               %{"operation" => "update"},
               %{"operation" => "delete"}
             ] == Enum.map(entries, &(Jason.decode!(&1) |> Map.get("headers")))

      # Second compaction
      paths = Compaction.compact_in_place(paths, 1_000_000)

      # Verify txid remains removed and JSON stays the same
      reentries = LogFile.read_chunk(paths, LogOffset.first()) |> Enum.to_list()
      assert entries == reentries
    end

    test "compacts a log file", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream =
        [
          ins(offset: {1, 1}, rec: [id: "key1", value: "value1"]),
          upd(offset: {2, 1}, rec: [id: "key1", value: {"value1", "value2"}]),
          ins(offset: {3, 1}, rec: [id: "key2", value: "value3"]),
          upd(offset: {4, 1}, rec: [id: "key1", value: {"value2", "value new 1"}]),
          upd(offset: {5, 1}, rec: [id: "key1", value: {"value new 1", "value new 2"}]),
          upd(offset: {6, 1}, rec: [id: "key1", value: {"value new 2", "value new 3"}]),
          upd(offset: {7, 1}, rec: [id: "key1", value: {"value new 3", "value new 4"}]),
          upd(offset: {8, 1}, rec: [id: "key1", value: {"value new 4", "value new 5"}]),
          del(offset: {9, 1}, rec: [id: "key2", value: "value"])
        ]
        |> TestUtils.changes_to_log_items()

      paths = LogFile.write_log_file(log_stream, log_file_path)

      assert LogFile.read_chunk(paths, %LogOffset{tx_offset: 0, op_offset: 0})
             |> Enum.to_list()
             |> length == 9

      assert {log_file_path, chunk_index_path, key_index_path} =
               Compaction.compact_in_place(paths, 1_000_000)

      assert File.exists?(log_file_path)
      assert File.exists?(chunk_index_path)
      assert File.exists?(key_index_path)

      assert LogFile.read_chunk(paths, %LogOffset{tx_offset: 0, op_offset: 0})
             |> Enum.to_list()
             |> length == 4
    end

    test "compacts a log file with replica mode full", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream =
        [
          ins(offset: {1, 1}, rec: [id: "key1", value: "value1"]),
          upd(offset: {2, 1}, rec: [id: "key1", value: {"value1", "value2"}]),
          ins(offset: {3, 1}, rec: [id: "key2", value: "value3"]),
          upd(offset: {4, 1}, rec: [id: "key1", value: {"value2", "value new 1"}]),
          upd(offset: {5, 1}, rec: [id: "key1", value: {"value new 1", "value new 2"}]),
          upd(offset: {6, 1}, rec: [id: "key1", value: {"value new 2", "value new 3"}]),
          upd(offset: {7, 1}, rec: [id: "key1", value: {"value new 3", "value new 4"}]),
          upd(offset: {8, 1}, rec: [id: "key1", value: {"value new 4", "value new 5"}]),
          del(offset: {9, 1}, rec: [id: "key2", value: "value"])
        ]
        |> TestUtils.changes_to_log_items(replica: :full)

      paths = LogFile.write_log_file(log_stream, log_file_path)

      assert LogFile.read_chunk(paths, %LogOffset{tx_offset: 0, op_offset: 0})
             |> Enum.to_list()
             |> length == 9

      assert {log_file_path, chunk_index_path, key_index_path} =
               Compaction.compact_in_place(paths, 1_000_000)

      assert File.exists?(log_file_path)
      assert File.exists?(chunk_index_path)
      assert File.exists?(key_index_path)

      assert [
               %{"headers" => %{"operation" => "insert"}},
               %{"headers" => %{"operation" => "insert"}},
               %{
                 "headers" => %{"operation" => "update"},
                 "value" => %{"id" => "key1", "value" => "value new 5"},
                 "old_value" => %{"value" => "value1"}
               },
               %{"headers" => %{"operation" => "delete"}}
             ] =
               LogFile.read_chunk(paths, %LogOffset{tx_offset: 0, op_offset: 0})
               |> Enum.to_list()
               |> Enum.map(&Jason.decode!/1)
    end

    test "compacts a large enough log file full of updates (failing property)", %{
      tmp_dir: tmp_dir
    } do
      log_file_path = Path.join(tmp_dir, "log_file")

      paths =
        Enum.map(1..10_000, fn i ->
          # Test with different key sizes and UTF symbols
          key =
            Enum.random(
              ~w|key1 k2 longer_key_3 very_very_very_very_very_long_key_4 nice_important_key_5 المفتاح_6 密钥7|
            )

          upd(offset: {i, 1}, rec: [id: key, value: {"value1", "value new #{i}"}])
        end)
        |> TestUtils.changes_to_log_items()
        |> Stream.reject(&match?({:chunk_boundary, _}, &1))
        |> LogFile.write_log_file(log_file_path)

      paths = Compaction.compact_in_place(paths, 50_000)

      assert LogFile.read_chunk(paths, %LogOffset{tx_offset: 0, op_offset: 0})
             |> Enum.to_list()
             |> length == 7
    end
  end
end
