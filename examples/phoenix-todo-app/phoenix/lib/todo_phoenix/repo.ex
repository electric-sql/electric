defmodule TodoPhoenix.Repo do
  use Ecto.Repo,
    otp_app: :todo_phoenix,
    adapter: Ecto.Adapters.Postgres
end
