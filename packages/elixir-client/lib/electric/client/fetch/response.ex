defmodule Electric.Client.Fetch.Response do
  alias Electric.Client

  defstruct [
    :status,
    :last_offset,
    :shape_handle,
    :schema,
    :next_cursor,
    :request_timestamp,
    body: [],
    headers: %{}
  ]

  @type t :: %__MODULE__{
          status: non_neg_integer(),
          body: [map()],
          headers: %{String.t() => [String.t()]},
          last_offset: nil | Client.Offset.t(),
          shape_handle: nil | Client.shape_handle(),
          schema: nil | Client.schema(),
          next_cursor: nil | Client.cursor(),
          request_timestamp: DateTime.t()
        }

  @doc false
  @spec decode!(t()) :: t()
  def decode!(%__MODULE__{headers: headers} = resp) do
    resp
    |> Map.put(:shape_handle, decode_shape_handle(headers))
    |> Map.put(:last_offset, decode_offset(headers))
    |> Map.put(:schema, decode_schema(headers))
    |> Map.put(:next_cursor, decode_next_cursor(headers))
  end

  @doc false
  @spec decode!(pos_integer(), %{optional(binary()) => binary()}, [term()], DateTime.t()) :: t()
  def decode!(status, headers, body, timestamp \\ DateTime.utc_now())
      when is_integer(status) and is_map(headers) do
    %__MODULE__{
      status: status,
      headers: decode_headers(headers),
      body: body,
      shape_handle: decode_shape_handle(headers),
      last_offset: decode_offset(headers),
      schema: decode_schema(headers),
      next_cursor: decode_next_cursor(headers),
      request_timestamp: timestamp
    }
  end

  defp decode_headers(headers) do
    Map.new(headers, fn {k, v} -> {k, List.wrap(v)} end)
  end

  defp decode_shape_handle(%{"electric-handle" => shape_handle}) do
    unlist(shape_handle)
  end

  defp decode_shape_handle(_headers), do: nil

  defp decode_offset(%{"electric-offset" => offset}) do
    offset |> unlist() |> Client.Offset.from_string!()
  end

  defp decode_offset(_headers), do: nil

  defp decode_schema(%{"electric-schema" => schema}) do
    schema |> unlist() |> Jason.decode!(keys: :atoms)
  end

  defp decode_schema(_headers), do: nil

  defp unlist([elem | _]), do: elem
  defp unlist([]), do: nil
  defp unlist(value), do: value

  defp decode_next_cursor(%{"electric-cursor" => cursor}) do
    cursor |> unlist() |> String.to_integer()
  end

  defp decode_next_cursor(_), do: nil
end
