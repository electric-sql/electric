defmodule BeerStars.Repo.Migrations.CreateStargazers do
  use Ecto.Migration

  def change do
    create table(:stars, primary_key: false) do
      add :id, :text, primary_key: true, null: false
      add :avatar_url, :text, null: false
      add :name, :text
      add :starred_at, :text, null: false
      add :username, :text, null: false
    end
  end
end
