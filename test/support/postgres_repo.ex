defmodule Electric.PostgresRepo do
  use Ecto.Repo, adapter: Ecto.Adapters.Postgres, otp_app: :electric
end
