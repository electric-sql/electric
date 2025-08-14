defmodule TodoPhoenixWeb.HealthController do
  use TodoPhoenixWeb, :controller

  def check(conn, _params) do
    json(conn, %{status: "ok", timestamp: System.system_time(:second)})
  end

  def options(conn, _params) do
    conn
    |> put_resp_header("cache-control", "no-cache, no-store, must-revalidate")
    |> put_resp_header("pragma", "no-cache")
    |> put_resp_header("expires", "0")
    |> send_resp(204, "")
  end
end
