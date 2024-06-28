defmodule Electric.Postgres.Proxy.TestRepo do
  use Ecto.Repo,
    otp_app: :electric,
    adapter: Ecto.Adapters.Postgres
end
