defmodule Electric.ShapeCache.LogChunkerTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.LogChunker

  @test_shape_id "test_shape_id"

  describe "add_chunk/3" do
    setup %{} do
      shared_opts = LogChunker.shared_opts()
      opts = LogChunker.for_shape(@test_shape_id, shared_opts)
      LogChunker.start_link(opts)
      opts
    end

    test "should reset counter upon exceeding threshold", opts do
      chunk_bytes = "test"
      threshold = 3 * byte_size(chunk_bytes) - 1
      threshold_opts = Map.put(opts, :chunk_bytes_threshold, threshold)

      # try as many times as the threshold bytes to ensure no cyclical offset gets added
      for _ <- 1..threshold do
        assert :ok = LogChunker.add_to_chunk(@test_shape_id, chunk_bytes, threshold_opts)
        assert :ok = LogChunker.add_to_chunk(@test_shape_id, chunk_bytes, threshold_opts)

        assert :threshold_exceeded =
                 LogChunker.add_to_chunk(@test_shape_id, chunk_bytes, threshold_opts)
      end
    end

    test "should ignore zero length bytestrings", opts do
      threshold = 10
      large_string = String.duplicate("a", threshold)

      threshold_opts = Map.put(opts, :chunk_bytes_threshold, threshold)

      assert :ok = LogChunker.add_to_chunk(@test_shape_id, large_string, threshold_opts)

      # despite next chunk already being full from the large string, if not
      # bytes are added we should not exceed the threshold
      assert :ok = LogChunker.add_to_chunk(@test_shape_id, "", threshold_opts)
      assert :ok = LogChunker.add_to_chunk(@test_shape_id, <<>>, threshold_opts)

      # adding a single byte should make it exceed
      assert :threshold_exceeded =
               LogChunker.add_to_chunk(@test_shape_id, <<0>>, threshold_opts)
    end
  end
end
