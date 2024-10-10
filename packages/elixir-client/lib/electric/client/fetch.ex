defmodule Electric.Client.Fetch do
  alias Electric.Client

  defmodule Response do
    defstruct [:status, :last_offset, :shape_id, :schema, body: [], headers: %{}]

    @type t :: %__MODULE__{
            status: non_neg_integer(),
            body: [map()],
            headers: %{String.t() => String.t()},
            last_offset: nil | Client.Offset.t(),
            shape_id: nil | String.t(),
            schema: nil | Client.schema()
          }

    def decode!(status, headers, body) when is_integer(status) and is_map(headers) do
      %__MODULE__{
        status: status,
        headers: headers,
        body: body,
        shape_id: decode_shape_id(headers),
        last_offset: decode_offset(headers),
        schema: decode_schema(headers)
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
  end

  @callback fetch(Request.t(), Keyword.t()) :: :ok
end

defmodule Electric.Client.Fetch.HTTP do
  @moduledoc false

  alias Electric.Client.Fetch
  alias Electric.Client.ShapeDefinition

  @behaviour Electric.Client.Fetch

  def fetch(%Fetch.Request{} = request, opts) do
    request_opts = Keyword.get(opts, :request, [])
    {connect_options, request_opts} = Keyword.pop(request_opts, :connect_options, [])

    %{
      method: method,
      base_url: base_url,
      shape: %ShapeDefinition{} = shape
    } = request

    params = Electric.Client.params(request)

    [
      method: method,
      base_url: base_url,
      url: "/v1/shape/#{ShapeDefinition.url_table_name(shape)}",
      params: params,
      retry_delay: &retry_delay/1,
      max_retries: 6,
      # finch: Electric.Client.Finch,
      # we use long polling with a timeout of 20s so we don't want Req to error before 
      # Electric has returned something
      receive_timeout: 60_000,
      connect_options:
        Keyword.merge(
          [protocols: [:http2]],
          connect_options
        )
    ]
    |> Keyword.merge(request_opts)
    |> Req.new()
    |> request()
  end

  defp request(request) do
    request |> Req.request() |> wrap_resp()
  end

  defp wrap_resp({:ok, %Req.Response{} = resp}) do
    %{status: status, headers: headers, body: body} = resp
    {:ok, Fetch.Response.decode!(status, headers, body)}
  end

  defp wrap_resp({:error, _} = error) do
    error
  end

  defp retry_delay(n) do
    (Integer.pow(2, n) * 1000 * jitter())
    |> min(30_000 * (1 - 0.1 * :rand.uniform()))
    |> trunc()
  end

  defp jitter() do
    1 - 0.1 * :rand.uniform()
  end
end
