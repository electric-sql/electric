defmodule Electric.Client.Fetch.HTTP do
  @moduledoc false

  alias Electric.Client.Fetch

  @behaviour Electric.Client.Fetch

  def fetch(%Fetch.Request{authenticated: true} = request, opts) do
    request_opts = Keyword.get(opts, :request, [])
    {connect_options, request_opts} = Keyword.pop(request_opts, :connect_options, [])

    [
      method: request.method,
      url: Fetch.Request.url(request),
      headers: request.headers,
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
    |> min(30_000 * jitter())
    |> trunc()
  end

  defp jitter() do
    1 - 0.1 * :rand.uniform()
  end
end
