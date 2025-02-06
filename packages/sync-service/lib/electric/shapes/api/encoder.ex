defmodule Electric.Shapes.Api.Encoder do
  @callback message(term()) :: Enum.t()
  @callback log(term()) :: Enum.t()

  def validate!(impl) do
    case impl do
      module when is_atom(module) ->
        # just assume that the module implements the behaviour
        module

      invalid ->
        raise ArgumentError,
          message:
            "Expected a module that implements the #{__MODULE__} protocol. Got #{inspect(invalid)}"
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

  defp ensure_json(json) when is_binary(json) do
    json
  end

  defp ensure_json(term) do
    Jason.encode_to_iodata!(term)
  end

  @json_list_start "["
  @json_list_end "]"
  @json_item_separator ","

  defp to_json_stream(items) do
    Stream.concat([
      [@json_list_start],
      Stream.intersperse(items, @json_item_separator),
      [@json_list_end]
    ])
    |> Stream.chunk_every(500)
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

  defp maybe_decode_json!(json) when is_binary(json) do
    Jason.decode!(json)
  end

  defp maybe_decode_json!(term) do
    term
  end
end
