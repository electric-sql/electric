defmodule Electric.Shapes.Api.Encoder do
  @callback message(term()) :: Enum.t()
  @callback log(term()) :: Enum.t()
  @callback subset(term()) :: Enum.t()

  def validate!(impl) do
    case impl do
      module when is_atom(module) ->
        # just assume that the module implements the behaviour
        module

      invalid ->
        raise ArgumentError,
          message:
            "Expected a module that implements the #{inspect(__MODULE__)} protocol. Got #{inspect(invalid)}"
    end
  end
end

defmodule Electric.Shapes.Api.Encoder.JSON do
  @behaviour Electric.Shapes.Api.Encoder

  @impl Electric.Shapes.Api.Encoder
  def message(message) when is_binary(message) do
    [message]
  end

  def message(term) do
    Stream.map([term], &Jason.encode_to_iodata!/1)
  end

  @impl Electric.Shapes.Api.Encoder
  # the log is streamed from storage as a stream of json-encoded messages
  def log(item_stream) do
    item_stream |> Stream.map(&ensure_json/1) |> to_json_stream()
  end

  @impl Electric.Shapes.Api.Encoder
  def subset({metadata, item_stream}) do
    metadata =
      metadata
      |> Map.update!(:xmin, &to_string/1)
      |> Map.update!(:xmax, &to_string/1)
      |> Map.update!(:xip_list, &Enum.map(&1, fn xid -> to_string(xid) end))

    Stream.concat([
      [
        ~s|{"metadata":|,
        Jason.encode_to_iodata!(metadata),
        ~s|, "data": |
      ],
      to_json_stream(item_stream),
      [~s|}|]
    ])
  end

  defp ensure_json(json) when is_binary(json) do
    json
  end

  defp ensure_json(term) do
    Jason.encode_to_iodata!(term)
  end

  @json_list_start "["
  @json_list_end "]"
  @json_item_separator ","

  # Batch stream items into iodata units bounded by BOTH item count and byte
  # size. Each response body element is held in full by the request process
  # and by the socket's driver queue while it is being written, so a serve to
  # a slow or stalled client pins the whole unit for as long as the serve
  # lives. Bounding the unit size bounds the memory pinned per connection.
  @max_batch_items 500
  @max_batch_bytes 256 * 1024

  @doc """
  Upper bound in bytes for a single encoded response body element (a batch of
  log items). Consumers of encoded streams may size their write units to this:
  elements at or under it can be written as-is.
  """
  def max_batch_bytes, do: @max_batch_bytes

  defp to_json_stream(items) do
    Stream.concat([
      [@json_list_start],
      Stream.intersperse(items, @json_item_separator),
      [@json_list_end]
    ])
    |> chunk_by_count_and_bytes(@max_batch_items, @max_batch_bytes)
  end

  defp chunk_by_count_and_bytes(stream, max_items, max_bytes) do
    Stream.transform(
      stream,
      fn -> {[], 0, 0} end,
      fn item, {acc, count, bytes} ->
        acc = [item | acc]
        count = count + 1
        bytes = bytes + IO.iodata_length(item)

        if count >= max_items or bytes >= max_bytes do
          {[Enum.reverse(acc)], {[], 0, 0}}
        else
          {[], {acc, count, bytes}}
        end
      end,
      fn
        {[], _count, _bytes} -> {[], nil}
        {acc, _count, _bytes} -> {[Enum.reverse(acc)], nil}
      end,
      fn _acc -> :ok end
    )
  end
end

defmodule Electric.Shapes.Api.Encoder.SSE do
  @behaviour Electric.Shapes.Api.Encoder

  @impl Electric.Shapes.Api.Encoder
  def log(item_stream) do
    # Note that, unlike the JSON log encoder, this doesn't currently use
    # `Stream.chunk_every/1`.
    #
    # This is because it's only handling live events and is usually used
    # for small updates (the point of enabling SSE mode is to avoid request
    # overhead when consuming small changes).

    item_stream
    |> Stream.flat_map(&message/1)
  end

  @impl Electric.Shapes.Api.Encoder
  def message(message) do
    ["data: ", ensure_json(message), "\n\n"]
  end

  @impl Electric.Shapes.Api.Encoder
  def subset(_), do: raise("Subset encoding not supported for SSE")

  defp ensure_json(json) when is_binary(json) do
    json
  end

  defp ensure_json(term) do
    Jason.encode_to_iodata!(term)
  end
end

defmodule Electric.Shapes.Api.Encoder.Term do
  @behaviour Electric.Shapes.Api.Encoder

  @impl Electric.Shapes.Api.Encoder
  def message(message) when is_binary(message) do
    [Jason.decode!(message)]
  end

  def message(term) do
    [term]
  end

  @impl Electric.Shapes.Api.Encoder
  # the log is streamed from storage as a stream of json-encoded messages
  def log(item_stream) do
    Stream.map(item_stream, &maybe_decode_json!/1)
  end

  @impl Electric.Shapes.Api.Encoder
  def subset({metadata, item_stream}) do
    {metadata, Stream.map(item_stream, &maybe_decode_json!/1)}
  end

  defp maybe_decode_json!(json) when is_binary(json) do
    Jason.decode!(json)
  end

  defp maybe_decode_json!(term) do
    term
  end
end
