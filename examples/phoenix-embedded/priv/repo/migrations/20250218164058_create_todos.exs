defmodule Electric.PhoenixEmbedded.Repo.Migrations.CreateTodos do
  use Ecto.Migration

  def change do
    create table("todos", primary_key: false) do
      add :id, :uuid, primary_key: true, null: false
      add :title, :string, null: false
      add :completed, :boolean, null: false
      timestamps()
    end
  end
end
