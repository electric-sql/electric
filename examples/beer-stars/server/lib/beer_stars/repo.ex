defmodule BeerStars.Repo do
  use Ecto.Repo,
    otp_app: :beer_stars,
    adapter: Ecto.Adapters.Postgres
end
