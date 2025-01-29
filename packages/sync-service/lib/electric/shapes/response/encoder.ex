defmodule Electric.Shapes.Response.Encoder do
  @callback message(term()) :: Enum.t()
  @callback log(term()) :: Enum.t()

  alias __MODULE__

  def validate!(impl) do
    case impl do
      :json ->
        Encoder.JSON

      :term ->
        Encoder.Term

      module when is_atom(module) ->
        # just assume that the module implements the behaviour
        module

      invalid ->
        raise ArgumentError,
          message:
            "Expected a module that implements the Shapes.Response.Encoder protocol. Got #{inspect(invalid)}"
    end
  end
end

defmodule Electric.Shapes.Response.Encoder.JSON do
  @behaviour Electric.Shapes.Response.Encoder

  @impl Electric.Shapes.Response.Encoder
  def message(message) when is_binary(message) do
    [message]
  end

  def message(term) do
    Stream.map([term], &Jason.encode!/1)
  end

  @impl Electric.Shapes.Response.Encoder
  # the log is streamed from storage as a stream of json-encoded messages
  def log(item_stream) do
    to_json_stream(item_stream)
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

defmodule Electric.Shapes.Response.Encoder.Term do
  @behaviour Electric.Shapes.Response.Encoder

  @impl Electric.Shapes.Response.Encoder

  def message(message) when is_binary(message) do
    [Jason.decode!(message)]
  end

  def message(term) do
    [term]
  end

  @impl Electric.Shapes.Response.Encoder
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
