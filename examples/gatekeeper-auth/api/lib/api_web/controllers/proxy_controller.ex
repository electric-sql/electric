defmodule ApiWeb.ProxyController do
  use ApiWeb, :controller

  # Handles `GET /proxy/v1/shape` by proxying the request to Electric.
  # Uses the `Req` HTTP client to stream the body through.
  def show(conn, _params) do
    %{status: status, headers: headers, body: stream} = proxy_request(conn)

    conn
    |> clone_headers(headers)
    |> stream_response(status, stream)
  end

  defp proxy_request(%{req_headers: headers} = conn) do
    conn
    |> build_url()
    |> Req.get!(headers: headers, into: :self)
  end

  defp build_url(%{path_info: [_prefix | segments], query_string: query}) do
    electric_url = Application.fetch_env!(:api, :electric_url)

    "#{electric_url}/#{Path.join(segments)}?#{query}"
  end

  defp clone_headers(conn, headers) do
    headers
    |> Enum.reduce(conn, fn {k, [v]}, acc -> put_resp_header(acc, k, v) end)
  end

  defp stream_response(conn, status, body) do
    conn = send_chunked(conn, status)

    Enum.reduce(body, conn, fn chunk, conn ->
      with {:ok, conn} <- chunk(conn, chunk), do: conn
    end)
  end
end
