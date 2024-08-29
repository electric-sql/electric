defmodule Electric.ShapeCache.LogChunker do
  @size_key :chunk_size
  @chunk_signature <<32, 32, 32>>
  @default_threshold 10_000

  defp name(shape_id) when is_binary(shape_id) do
    Electric.Application.process_name(__MODULE__, shape_id)
  end

  defp table_name(shape_id) when is_binary(shape_id) do
    :"chunk_size_ets_table-#{shape_id}"
  end

  def start_link(shape_id) when is_binary(shape_id) do
    Agent.start_link(
      fn ->
        %{
          chunk_size_ets_table: :ets.new(table_name(shape_id), [:public, :named_table, :set])
        }
      end,
      name: name(shape_id)
    )
  end

  def add_to_chunk(shape_id, chunk_bytes, byte_threshold \\ @default_threshold)
  def add_to_chunk(_shape_id, _chunk_bytes = <<>>, _threshold), do: :ok

  def add_to_chunk(shape_id, chunk_bytes, byte_threshold) do
    chunk_bytes_size = byte_size(chunk_bytes)

    new_size =
      :ets.update_counter(
        table_name(shape_id),
        @size_key,
        {2, chunk_bytes_size, byte_threshold, chunk_bytes_size},
        {@size_key, -1}
      )

    if(new_size === chunk_bytes_size) do
      :threshold_exceeded
    else
      :ok
    end
  end

  defmacro chunk_signature() do
    @chunk_signature
  end
end
