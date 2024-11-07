defmodule Electric.PhoenixExample.Repo do
  use Ecto.Repo,
    otp_app: :electric_phoenix_example,
    adapter: Ecto.Adapters.Postgres
end
