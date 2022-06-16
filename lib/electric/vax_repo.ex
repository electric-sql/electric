defmodule Electric.VaxRepo do
  use Ecto.Repo, adapter: Vax.Adapter, otp_app: :electric
end
