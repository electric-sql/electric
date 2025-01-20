defmodule Electric.ShapeCache.FileStorage.CompactionTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.FileStorage.Compaction
  alias Electric.ShapeCache.FileStorage.LogFile
  alias Electric.Replication.LogOffset

  @moduletag :tmp_dir

  describe "compact_in_place/2" do
    test "compacts a log file", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      # Write initial log file with supporting files
      log_stream = [
        {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, ~S|"value1"|},
        {%LogOffset{tx_offset: 2, op_offset: 1}, "key1", :update, ~S|"value2"|},
        {%LogOffset{tx_offset: 3, op_offset: 1}, "key2", :insert, ~S|"value3"|},
        {%LogOffset{tx_offset: 4, op_offset: 1}, "key1", :update, ~S|"value new 1"|},
        {%LogOffset{tx_offset: 5, op_offset: 1}, "key1", :update, ~S|"value new 2"|},
        {%LogOffset{tx_offset: 6, op_offset: 1}, "key1", :update, ~S|"value new 3"|},
        {%LogOffset{tx_offset: 7, op_offset: 1}, "key1", :update, ~S|"value new 4"|},
        {%LogOffset{tx_offset: 8, op_offset: 1}, "key1", :update, ~S|"value new 5"|},
        {%LogOffset{tx_offset: 9, op_offset: 1}, "key2", :delete, ~S|"value"|}
      ]

      paths = LogFile.write_log_file(log_stream, log_file_path)

      assert LogFile.read_chunk(paths, %LogOffset{tx_offset: 0, op_offset: 0})
             |> Enum.to_list()
             |> length == 9

      assert {log_file_path, chunk_index_path, key_index_path} =
               Compaction.compact_in_place(paths, 1_000_000, &(&1 <> &2))

      assert File.exists?(log_file_path)
      assert File.exists?(chunk_index_path)
      assert File.exists?(key_index_path)

      assert LogFile.read_chunk(paths, %LogOffset{tx_offset: 0, op_offset: 0})
             |> Enum.to_list()
             |> length == 4
    end
  end
end
