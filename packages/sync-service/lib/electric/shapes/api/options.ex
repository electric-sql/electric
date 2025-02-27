defmodule Electric.Shapes.Api.Options do
  @allowed_headers ["if-none-match"]

  def call(%Plug.Conn{} = conn) do
    conn
    |> add_cache_max_age_header()
    |> filter_cors_headers()
    |> add_keep_alive()
    |> send_options_response()
  end

  defp add_cache_max_age_header(conn) do
    conn
    |> Plug.Conn.put_resp_header("access-control-max-age", "86400")
    |> Plug.Conn.delete_resp_header("cache-control")
  end

  defp filter_cors_headers(conn) do
    case Plug.Conn.get_req_header(conn, "access-control-request-headers") do
      [] ->
        conn

      headers ->
        supported_headers =
          headers
          |> Enum.filter(&Enum.member?(@allowed_headers, String.downcase(&1)))
          |> Enum.join(",")

        case supported_headers do
          "" -> conn
          _ -> Plug.Conn.put_resp_header(conn, "access-control-allow-headers", supported_headers)
        end
    end
  end

  defp add_keep_alive(conn), do: Plug.Conn.put_resp_header(conn, "connection", "keep-alive")

  defp send_options_response(conn), do: Plug.Conn.send_resp(conn, 204, "")
end
