defmodule BeerStars.Repo.Migrations.ElectrifyTables do
  use Ecto.Migration

  def change do
    execute("ALTER TABLE beers ENABLE ELECTRIC")
    execute("ALTER TABLE stars ENABLE ELECTRIC")
  end
end
