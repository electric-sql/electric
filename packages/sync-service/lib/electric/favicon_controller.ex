defmodule Electric.FaviconController do
  @moduledoc """
  Simple controller to handle favicon requests.
  Returns a 204 No Content response to avoid 500 errors.
  """

  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    show(conn, %{})
  end

  def show(conn, _params) do
    conn
    |> send_resp(204, "")
    |> halt()
  end
end
