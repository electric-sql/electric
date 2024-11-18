defmodule ApiWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :api

  plug Plug.Parsers,
    parsers: [:json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library()

  plug ApiWeb.Router
end
