defmodule Electric.ShapeCache.LogChunker do
  use Agent
  alias Electric.ShapeCache.ShapeStatus

  @size_key :chunk_size
  @default_threshold 10_000

  defp name(shape_id) when is_binary(shape_id) do
    Electric.Application.process_name(__MODULE__, shape_id)
  end

  def shared_opts(opts \\ %{}) do
    chunk_size_ets_table_name = Access.get(opts, :chunk_size_ets_table, :chunk_size_ets_table)
    chunk_bytes_threshold = Access.get(opts, :chunk_bytes_threshold, @default_threshold)

    %{
      chunk_size_ets_table_base: chunk_size_ets_table_name,
      chunk_size_ets_table: nil,
      chunk_bytes_threshold: chunk_bytes_threshold,
      shape_id: nil
    }
  end

  def for_shape(shape_id, %{shape_id: shape_id} = compiled_opts) do
    compiled_opts
  end

  def for_shape(shape_id, compiled_opts) when is_binary(shape_id) do
    chunk_size_ets_table_name = Map.fetch!(compiled_opts, :chunk_size_ets_table_base)

    %{
      compiled_opts
      | shape_id: shape_id,
        chunk_size_ets_table: :"#{chunk_size_ets_table_name}-#{shape_id}"
    }
  end

  def start_link(%{shape_id: shape_id, chunk_size_ets_table: table_name} = _compiled_opts)
      when is_binary(shape_id) do
    # NOTE: perhaps unnecessary as we know that this will always run along the
    # storage processes?
    Agent.start_link(
      fn ->
        %{
          chunk_size_ets_table: :ets.new(table_name, [:public, :named_table, :set])
        }
      end,
      name: name(shape_id)
    )
  end

  @doc """
  Add bytes to the current chunk of a given shape - if the chunk exceeds the specified
  byte size threshold, a new chunk is reset and `:threshold_exceeded` is returned.
  """
  @spec add_to_chunk(ShapeStatus.shape_id(), bitstring(), non_neg_integer()) ::
          :ok | :threshold_exceeded
  def add_to_chunk(shape_id, chunk_bytes, opts)

  # Ignore zero-length bytestrings - they can always be "added" to an existing chunk
  def add_to_chunk(_shape_id, _chunk_bytes = <<>>, _opts), do: :ok

  def add_to_chunk(shape_id, chunk_bytes, %{
        chunk_size_ets_table: table_name,
        chunk_bytes_threshold: byte_threshold
      }) do
    chunk_bytes_size = byte_size(chunk_bytes)
    shape_chunk_size_key = {@size_key, shape_id}

    new_size =
      :ets.update_counter(
        table_name,
        shape_chunk_size_key,
        {2, chunk_bytes_size, byte_threshold, 0},
        {shape_chunk_size_key, 0}
      )

    # if size is reset to 0 it can only mean that the chunk has
    # filled up - since 0-length bytestrings do not get counted
    if new_size === 0, do: :threshold_exceeded, else: :ok
  end
end
