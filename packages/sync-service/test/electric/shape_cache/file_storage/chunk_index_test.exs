defmodule Electric.ShapeCache.FileStorage.ChunkIndexTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.FileStorage.LogFile
  alias Electric.ShapeCache.FileStorage.ChunkIndex
  alias Electric.Replication.LogOffset

  @moduletag :tmp_dir

  describe "write_from_stream/3" do
    test "writes a chunk index", %{tmp_dir: tmp_dir} do
      chunk_index_path = Path.join(tmp_dir, "chunk_index")

      log_stream =
        [
          {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
          {%LogOffset{tx_offset: 2, op_offset: 2}, "key2", :insert, "value2"},
          {%LogOffset{tx_offset: 3, op_offset: 3}, "key3", :insert, "value3"}
        ]
        |> LogFile.normalize_log_stream()

      refute File.exists?(chunk_index_path)

      ChunkIndex.write_from_stream(log_stream, chunk_index_path, 10)
      |> Stream.run()

      assert File.exists?(chunk_index_path)
    end
  end

  describe "fetch_chunk/2" do
    test "fetches a chunk by offset", %{tmp_dir: tmp_dir} do
      chunk_index_path = Path.join(tmp_dir, "chunk_index")

      log_stream =
        [
          {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
          {%LogOffset{tx_offset: 2, op_offset: 2}, "key2", :insert, "value2"}
        ]
        |> LogFile.normalize_log_stream()

      result_stream = ChunkIndex.write_from_stream(log_stream, chunk_index_path, 10)
      # consume the stream to write the file
      Enum.to_list(result_stream)

      result = ChunkIndex.fetch_chunk(chunk_index_path, %LogOffset{tx_offset: 0, op_offset: 0})
      assert match?({:ok, %LogOffset{}, {_, _}}, result)
    end
  end
end
