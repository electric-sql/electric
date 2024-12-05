defmodule Electric.Telemetry.SentryReqHTTPClient do
  @moduledoc """
  A custom Sentry HTTP client implementation using Req.
  """
  @behaviour Sentry.HTTPClient

  @impl true
  def post(url, headers, body) do
    case Req.post(url, headers: headers, body: body, decode_body: false) do
      {:ok, %Req.Response{status: status, headers: headers, body: body}} ->
        {:ok, status, headers |> Enum.into([], fn {k, [v]} -> {k, v} end), body}

      {:error, error} ->
        {:error, error}
    end
  end
end
