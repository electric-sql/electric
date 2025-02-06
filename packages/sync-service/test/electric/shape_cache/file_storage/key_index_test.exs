defmodule Electric.ShapeCache.FileStorage.KeyIndexTest do
  use ExUnit.Case, async: true
  import Electric.ShapeCache.FileStorage.KeyIndex, only: [key_index_item: 2]
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

  describe "sort/1" do
    test "sorts key file in place while maintaining correct structure", %{tmp_dir: tmp_dir} do
      key_index_path = Path.join(tmp_dir, "key_index")

      offsets = Enum.map(1..10_000, &{&1, 1})
      offsets = Enum.map(offsets, &LogOffset.new/1)

      offsets
      |> Enum.map(fn offset ->
        {offset, "much longer key #{offset}", :insert, "much longer value"}
      end)
      |> LogFile.normalize_log_stream()
      |> KeyIndex.write_from_stream(key_index_path)
      |> Stream.run()

      items =
        KeyIndex.stream(key_index_path)
        |> Enum.to_list()

      assert items
             |> Enum.map(&key_index_item(&1, :offset)) == offsets

      KeyIndex.sort(key_index_path)

      assert KeyIndex.stream(key_index_path)
             |> Enum.to_list()
             |> Enum.map(&key_index_item(&1, :offset)) ==
               Enum.sort_by(
                 offsets,
                 &{"much longer key #{&1}", &1.tx_offset, &1.op_offset}
               )

      # end
    end
  end
end
