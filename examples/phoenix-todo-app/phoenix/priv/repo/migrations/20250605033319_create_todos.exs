defmodule TodoPhoenix.Repo.Migrations.CreateTodos do
  use Ecto.Migration

  def change do
    create table(:todos, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :title, :text, null: false
      add :completed, :boolean, null: false, default: false

      timestamps(type: :utc_datetime_usec)
    end

    create index(:todos, [:inserted_at])
    create index(:todos, [:completed])
  end
end
