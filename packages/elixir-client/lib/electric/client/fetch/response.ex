defmodule Electric.Client.Fetch.Response do
  alias Electric.Client

  defstruct [
    :status,
    :last_offset,
    :shape_id,
    :schema,
    :next_cursor,
    body: [],
    headers: %{}
  ]

  @type t :: %__MODULE__{
          status: non_neg_integer(),
          body: [map()],
          headers: %{String.t() => String.t()},
          last_offset: nil | Client.Offset.t(),
          shape_id: nil | String.t(),
          schema: nil | Client.schema(),
          next_cursor: nil | Client.cursor()
        }

  @doc false
  def decode!(status, headers, body) when is_integer(status) and is_map(headers) do
    %__MODULE__{
      status: status,
      headers: headers,
      body: body,
      shape_id: decode_shape_id(headers),
      last_offset: decode_offset(headers),
      schema: decode_schema(headers),
      next_cursor: decode_next_cursor(headers)
    }
  end

  defp decode_shape_id(%{"electric-shape-id" => shape_id}) do
    unlist(shape_id)
  end

  defp decode_shape_id(_headers), do: nil

  defp decode_offset(%{"electric-chunk-last-offset" => offset}) do
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

  defp decode_next_cursor(%{"electric-next-cursor" => cursor}) do
    cursor |> unlist() |> String.to_integer()
  end

  defp decode_next_cursor(_), do: nil
end
