defmodule Electric.ShapeCache.FileStorage.KeyIndexTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.FileStorage.KeyIndex
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.FileStorage.LogFile

  @moduletag :tmp_dir

  describe "write_from_stream/2" do
    test "writes key index from stream", %{tmp_dir: tmp_dir} do
      key_index_path = Path.join(tmp_dir, "key_index")

      log_stream =
        [
          {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
          {%LogOffset{tx_offset: 2, op_offset: 1}, "key2", :insert, "value2"}
        ]
        |> LogFile.normalize_log_stream()

      refute File.exists?(key_index_path)
      result_stream = KeyIndex.write_from_stream(log_stream, key_index_path)
      assert is_function(result_stream)

      # Consume the stream to write the file
      Enum.to_list(result_stream)
      assert File.exists?(key_index_path)
    end
  end

  describe "stream/1" do
    test "streams key index entries", %{tmp_dir: tmp_dir} do
      key_index_path = Path.join(tmp_dir, "key_index")

      log_stream =
        [
          {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
          {%LogOffset{tx_offset: 2, op_offset: 1}, "key2", :insert, "value2"}
        ]
        |> LogFile.normalize_log_stream()

      result_stream = KeyIndex.write_from_stream(log_stream, key_index_path)
      # consume the stream to write the file
      Enum.to_list(result_stream)

      # Test streaming
      result = KeyIndex.stream(key_index_path) |> Enum.to_list()
      assert length(result) > 0
    end
  end
end
