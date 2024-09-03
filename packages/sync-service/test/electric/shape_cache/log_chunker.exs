defmodule Electric.ShapeCache.LogChunkerTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.LogChunker

  @test_shape_id "test_shape_id"

  describe "add_chunk/3" do
    test "should reset counter upon exceeding threshold", _ do
      chunk_bytes = "test"
      chunk_byte_size = byte_size(chunk_bytes)
      threshold = 3 * chunk_byte_size

      assert {:ok, new_size} = LogChunker.add_to_chunk(chunk_bytes, 0, threshold)
      assert new_size == chunk_byte_size

      assert {:ok, new_size} = LogChunker.add_to_chunk(chunk_bytes, chunk_byte_size, threshold)
      assert new_size == 2 * chunk_byte_size

      assert {:threshold_exceeded, 0} =
               LogChunker.add_to_chunk(chunk_bytes, 2 * chunk_byte_size, threshold)
    end

    test "should ignore zero length bytestrings", _ do
      threshold = 10
      just_below_threshold = threshold - 1

      # despite next chunk already being full from the large string, if not
      # bytes are added we should not exceed the threshold
      assert {:ok, ^just_below_threshold} =
               LogChunker.add_to_chunk("", just_below_threshold, threshold)

      assert {:ok, ^just_below_threshold} =
               LogChunker.add_to_chunk(<<>>, just_below_threshold, threshold)

      # adding a single byte should make it exceed
      assert {:threshold_exceeded, 0} =
               LogChunker.add_to_chunk(<<0>>, threshold - 1, threshold)
    end

    test "should reset threshold with single very large values", _ do
      threshold = 10
      large_string = String.duplicate("a", threshold * 2)
      assert {:threshold_exceeded, 0} = LogChunker.add_to_chunk(large_string, 0, threshold)
    end
  end
end
