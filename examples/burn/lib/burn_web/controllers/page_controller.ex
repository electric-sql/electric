defmodule BurnWeb.PageController do
  use BurnWeb, :controller

  def home(conn, _params) do
    conn
    |> put_layout(false)
    |> render(:empty)
  end
end
