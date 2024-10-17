defmodule Support.Repo do
  use Ecto.Repo,
    otp_app: :electric_client,
    adapter: Ecto.Adapters.Postgres
end
