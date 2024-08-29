defmodule Electric.ShapeCache.LogChunkerTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.LogChunker

  @test_shape_id "test_shape_id"

  describe "add_chunk/3" do
    setup %{} do
      LogChunker.start_link(@test_shape_id)
      :ok
    end

    test "should reset counter upon exceeding threshold", %{} do
      chunk_bytes = "test"
      threshold = 3 * byte_size(chunk_bytes) - 2
      assert :ok = LogChunker.add_to_chunk(@test_shape_id, chunk_bytes, threshold)
      assert :ok = LogChunker.add_to_chunk(@test_shape_id, chunk_bytes, threshold)
      assert :threshold_exceeded = LogChunker.add_to_chunk(@test_shape_id, chunk_bytes, threshold)
      assert :ok = LogChunker.add_to_chunk(@test_shape_id, chunk_bytes, threshold)
      assert :threshold_exceeded = LogChunker.add_to_chunk(@test_shape_id, chunk_bytes, threshold)
      assert :ok = LogChunker.add_to_chunk(@test_shape_id, chunk_bytes, threshold)
      assert :threshold_exceeded = LogChunker.add_to_chunk(@test_shape_id, chunk_bytes, threshold)
    end

    test "should ignore zero length bytestrings", %{} do
      large_string = String.duplicate("a", 100)
      threshold = 10

      assert :threshold_exceeded =
               LogChunker.add_to_chunk(@test_shape_id, large_string, threshold)

      # despite next chunk already being full from the large string, if not
      # bytes are added we should not exceed the threshold
      assert :ok = LogChunker.add_to_chunk(@test_shape_id, "", threshold)
      assert :ok = LogChunker.add_to_chunk(@test_shape_id, <<>>, threshold)

      # adding a single byte should make it exceed
      assert :threshold_exceeded = LogChunker.add_to_chunk(@test_shape_id, <<0>>, threshold)
    end
  end
end
