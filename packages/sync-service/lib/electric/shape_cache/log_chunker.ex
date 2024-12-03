defmodule Electric.ShapeCache.LogChunker do
  # Default chunk size of 10 MB to ensure caches accept them
  # see: https://github.com/electric-sql/electric/issues/1581
  @default_threshold 10 * 1024 * 1024

  @doc """
  Check if adding the given number of bytes to the current chunk would exceed the threshold.

  Returns either an ok-tuple with the new total chunk size or a threshold_exceeded-tuple with the
  new chunk size of 0.
  """
  @spec fit_into_chunk(non_neg_integer(), non_neg_integer(), non_neg_integer()) ::
          {:ok | :threshold_exceeded, non_neg_integer()}
  def fit_into_chunk(chunk_bytes, total_chunk_size, chunk_bytes_threshold \\ @default_threshold)

  def fit_into_chunk(0, total_chunk_byte_size, _chunk_bytes_threshold),
    do: {:ok, total_chunk_byte_size}

  def fit_into_chunk(chunk_bytes_size, total_chunk_byte_size, chunk_bytes_threshold)
      when is_number(chunk_bytes_size) and is_number(total_chunk_byte_size) and
             is_number(chunk_bytes_threshold) and
             total_chunk_byte_size + chunk_bytes_size >= chunk_bytes_threshold,
      do: {:threshold_exceeded, 0}

  def fit_into_chunk(chunk_bytes_size, total_chunk_byte_size, chunk_bytes_threshold)
      when is_number(chunk_bytes_size) and is_number(total_chunk_byte_size) and
             is_number(chunk_bytes_threshold),
      do: {:ok, total_chunk_byte_size + chunk_bytes_size}

  @spec default_chunk_size_threshold() :: non_neg_integer()
  def default_chunk_size_threshold(), do: @default_threshold
end
