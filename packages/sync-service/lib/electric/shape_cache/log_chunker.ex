defmodule Electric.ShapeCache.LogChunker do
  use Agent
  alias Electric.ShapeCache.ShapeStatus
  @size_key :chunk_size
  @chunk_boundary_bytes <<0, 255, 0, 123>>
  @chunk_boundary :chunk_boundary
  @default_threshold 10_000

  @type chunk_boundary :: :chunk_boundary

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

  def for_shape(shape_id, compiled_opts) do
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

  @spec add_to_chunk(ShapeStatus.shape_id(), bitstring(), non_neg_integer()) ::
          {:ok | :threshold_exceeded, bitstring()}
  def add_to_chunk(shape_id, chunk_bytes, opts)

  def add_to_chunk(_shape_id, chunk_bytes = <<>>, _opts), do: {:ok, chunk_bytes}

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
        {2, chunk_bytes_size, byte_threshold, chunk_bytes_size},
        {shape_chunk_size_key, -1}
      )

    if(new_size === chunk_bytes_size) do
      {:threshold_exceeded, prefix_with_chunk_boundary(chunk_bytes)}
    else
      {:ok, chunk_bytes}
    end
  end

  defp prefix_with_chunk_boundary(item) when is_binary(item) do
    <<@chunk_boundary_bytes::binary, item::binary>>
  end

  @spec materialise_chunk_boundaries(Enumerable.t(iodata())) ::
          Enumerable.t(iodata() | chunk_boundary())
  def materialise_chunk_boundaries(stream) do
    stream
    |> Stream.flat_map(fn item ->
      case item do
        <<@chunk_boundary_bytes::binary, rest::binary>> -> [@chunk_boundary, rest]
        _ -> [item]
      end
    end)
  end

  @spec dissolve_chunks(Enumerable.t(any() | chunk_boundary())) :: Enumerable.t(any())
  def dissolve_chunks(stream) do
    stream
    |> Stream.filter(fn item -> item !== @chunk_boundary end)
  end

  @spec take_chunk(Enumerable.t(any() | chunk_boundary())) :: Enumerable.t(any())
  def take_chunk(stream) do
    stream
    |> Stream.take_while(fn item -> item !== @chunk_boundary end)
  end
end
