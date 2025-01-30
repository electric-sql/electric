defmodule Electric.ShapeCache.FileStorage.LogFileTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.FileStorage.LogFile
  alias Electric.Replication.LogOffset

  @moduletag :tmp_dir

  describe "write_log_file/2" do
    test "writes a log file to disk", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream = [
        {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
        {%LogOffset{tx_offset: 2, op_offset: 2}, "key2", :insert, "value2"},
        {%LogOffset{tx_offset: 3, op_offset: 3}, "key3", :insert, "value3"}
      ]

      refute File.exists?(log_file_path)

      assert {^log_file_path, chunk_index_path, key_index_path} =
               LogFile.write_log_file(log_stream, log_file_path)

      assert File.exists?(log_file_path)
      assert File.exists?(chunk_index_path)
      assert File.exists?(key_index_path)

      assert File.read!(log_file_path) =~ "value1"
      assert File.read!(log_file_path) =~ "value2"
      assert File.read!(log_file_path) =~ "value3"
    end
  end

  describe "read_chunk/2" do
    test "reads a chunk from disk according to the log offset", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream = [
        # Will be in chunk 1
        {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
        {%LogOffset{tx_offset: 1, op_offset: 2}, "key2", :insert, "value2"},
        # Will be in chunk 2
        {%LogOffset{tx_offset: 2, op_offset: 1}, "key3", :insert, "value3"},
        {%LogOffset{tx_offset: 2, op_offset: 2}, "key4", :insert, "value4"},
        # Will be in chunk 3
        {%LogOffset{tx_offset: 3, op_offset: 1}, "key5", :insert, "value5"},
        {%LogOffset{tx_offset: 3, op_offset: 2}, "key6", :insert, "value6"}
      ]

      refute File.exists?(log_file_path)
      # 10-byte chunks
      assert {^log_file_path, _, _} =
               paths = LogFile.write_log_file(log_stream, log_file_path, 10)

      chunk = LogFile.read_chunk(paths, %LogOffset{tx_offset: 0, op_offset: 0})
      assert length(chunk) > 0
    end
  end
end
