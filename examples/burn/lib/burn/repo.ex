defmodule Burn.Repo do
  use Phoenix.Sync.Sandbox.Postgres

  use Ecto.Repo,
    otp_app: :burn,
    adapter: Phoenix.Sync.Sandbox.Postgres.adapter()
end
