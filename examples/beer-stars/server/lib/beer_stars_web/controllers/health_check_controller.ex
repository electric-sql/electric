defmodule BeerStarsWeb.HealthCheckController do
  use BeerStarsWeb, :controller

  def show(conn, _params) do
    conn
    |> json(%{})
  end
end
