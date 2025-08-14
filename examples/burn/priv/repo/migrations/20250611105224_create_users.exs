defmodule Burn.Repo.Migrations.CreateUsersAuthTables do
  use Ecto.Migration

  def change do
    create table(:users, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :name, :string, null: false
      add :type, :string, null: false
      add :avatar_url, :string

      timestamps(type: :utc_datetime)
    end

    create index(:users, [:type])

    create unique_index(:users, [:name],
             where: "type = 'human'",
             name: :users_human_name_unique_idx
           )
  end
end
