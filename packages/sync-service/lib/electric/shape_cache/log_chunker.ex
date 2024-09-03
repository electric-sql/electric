defmodule Electric.ShapeCache.LogChunker do
  @default_threshold 10_000

  @doc """
  Add bytes to the current chunk of a given shape - if the chunk exceeds the specified
  byte size threshold, a new chunk is reset and `:threshold_exceeded` is returned.
  """
  @spec add_to_chunk(bitstring(), non_neg_integer(), non_neg_integer()) ::
          {:ok | :threshold_exceeded, non_neg_integer()}
  def add_to_chunk(chunk_bytes, total_chunk_size, chunk_bytes_threshold \\ @default_threshold)

  # Ignore zero-length bytestrings - they can always be "added" to an existing chunk
  def add_to_chunk(_chunk_bytes = <<>>, total_chunk_byte_size, _chunk_bytes_threshold),
    do: {:ok, total_chunk_byte_size}

  def add_to_chunk(chunk_bytes, total_chunk_byte_size, chunk_bytes_threshold)
      when is_number(chunk_bytes_threshold) do
    chunk_bytes_size = byte_size(chunk_bytes)
    total_chunk_byte_size = total_chunk_byte_size + chunk_bytes_size

    if total_chunk_byte_size >= chunk_bytes_threshold,
      do: {:threshold_exceeded, 0},
      else: {:ok, total_chunk_byte_size}
  end

  @spec default_chunk_size_threshold() :: non_neg_integer()
  defmacro default_chunk_size_threshold(), do: @default_threshold
end
