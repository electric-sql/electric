defmodule BeerStars.Repo.Migrations.ElectrifyTables do
  use Ecto.Migration

  def change do
    execute "CALL electric.electrify('beers')"
    execute "CALL electric.electrify('stars')"
  end
end
