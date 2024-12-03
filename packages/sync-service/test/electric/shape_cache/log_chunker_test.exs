defmodule Electric.ShapeCache.LogChunkerTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.LogChunker

  describe "fit_into_chunk/3" do
    test "should reset counter upon exceeding threshold", _ do
      chunk_byte_size = byte_size("test")
      threshold = 3 * chunk_byte_size

      assert {:ok, new_size} = LogChunker.fit_into_chunk(chunk_byte_size, 0, threshold)
      assert new_size == chunk_byte_size

      assert {:ok, new_size} =
               LogChunker.fit_into_chunk(chunk_byte_size, chunk_byte_size, threshold)

      assert new_size == 2 * chunk_byte_size

      assert {:threshold_exceeded, 0} =
               LogChunker.fit_into_chunk(chunk_byte_size, 2 * chunk_byte_size, threshold)
    end

    test "should ignore zero length bytestrings", _ do
      threshold = 10
      just_below_threshold = threshold - 1

      # despite next chunk already being full from the large string, if not
      # bytes are added we should not exceed the threshold
      assert {:ok, ^just_below_threshold} =
               LogChunker.fit_into_chunk(0, just_below_threshold, threshold)

      # adding a single byte should make it exceed
      assert {:threshold_exceeded, 0} =
               LogChunker.fit_into_chunk(1, threshold - 1, threshold)
    end

    test "should reset threshold with single very large values", _ do
      threshold = 10
      large_string = String.duplicate("a", threshold * 2)

      assert {:threshold_exceeded, 0} =
               LogChunker.fit_into_chunk(byte_size(large_string), 0, threshold)
    end
  end
end
