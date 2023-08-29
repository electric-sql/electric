defmodule BeerStarsWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :beer_stars

  # Code reloading can be explicitly enabled under the
  # :code_reloader configuration of your endpoint.
  if code_reloading? do
    plug Phoenix.CodeReloader
    plug Phoenix.Ecto.CheckRepoStatus, otp_app: :beer_stars
  end

  plug Plug.RequestId

  plug Plug.Parsers,
    parsers: [:json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library()

  plug Plug.MethodOverride
  plug Plug.Head
  plug BeerStarsWeb.Router
end
