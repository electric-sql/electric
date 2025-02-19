defmodule Electric.PhoenixEmbedded.Repo do
  use Ecto.Repo,
    otp_app: :electric_phoenix_embedded,
    adapter: Ecto.Adapters.Postgres
end
