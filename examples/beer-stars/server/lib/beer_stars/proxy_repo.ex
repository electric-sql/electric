defmodule BeerStars.ProxyRepo do
  use Ecto.Repo,
    otp_app: :beer_stars,
    adapter: Ecto.Adapters.Postgres
end
