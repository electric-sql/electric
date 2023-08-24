defmodule BeerStars.Repo.Migrations.CreateBeers do
  use Ecto.Migration

  def change do
    create table(:beers, primary_key: false) do
      add :id, :text, primary_key: true, null: false
      add :star_id, references(:stars, on_delete: :nilify_all, type: :text)
    end

    create index(:beers, [:star_id])
  end
end
