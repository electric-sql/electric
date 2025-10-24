defmodule Electric.Plug.CORSHeaderPlug do
  @behaviour Plug
  import Plug.Conn
  def init(opts), do: opts

  def call(conn, opts),
    do:
      conn
      |> put_resp_header("access-control-allow-origin", get_allowed_origin(conn, opts))
      |> put_resp_header("access-control-expose-headers", headers_to_expose())
      |> put_resp_header("access-control-allow-methods", get_allowed_methods(conn, opts))

  defp get_allowed_methods(_conn, opts), do: Access.get(opts, :methods, []) |> Enum.join(", ")

  defp get_allowed_origin(conn, opts) do
    Access.get(
      opts,
      :origin,
      case Plug.Conn.get_req_header(conn, "origin") do
        [origin] -> origin
        [] -> "*"
      end
    )
  end

  defp headers_to_expose do
    Enum.join(Electric.Shapes.Api.Response.electric_headers(), ",")
  end
end
