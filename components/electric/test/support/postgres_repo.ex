defmodule Electric.PostgresRepo do
  use Ecto.Repo, adapter: Ecto.Adapters.Postgres, otp_app: :electric
end

defmodule Electric.PostgresRepo2 do
  use Ecto.Repo, adapter: Ecto.Adapters.Postgres, otp_app: :electric
end
