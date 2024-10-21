defmodule Electric.Plug.OptionsShapePlug do
  require Logger
  use Plug.Builder

  plug :add_cache_max_age_header
  plug :filter_cors_headers
  plug :add_keep_alive
  plug :send_options_response

  @allowed_headers ["if-none-match"]

  defp add_cache_max_age_header(conn, _) do
    conn
    |> Plug.Conn.put_resp_header("access-control-max-age", "86400")
    |> Plug.Conn.delete_resp_header("cache-control")
  end

  # Filters out the unsupported headers from the provided "access-control-request-headers"
  defp filter_cors_headers(conn, _) do
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

  defp add_keep_alive(conn, _), do: Plug.Conn.put_resp_header(conn, "connection", "keep-alive")

  defp send_options_response(conn, _), do: send_resp(conn, 204, "")
end
