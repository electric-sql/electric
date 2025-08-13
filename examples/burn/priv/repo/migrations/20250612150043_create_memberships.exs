defmodule Burn.Repo.Migrations.CreateMemberships do
  use Ecto.Migration

  def change do
    create table(:memberships, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :role, :string, null: false

      add :thread_id, references(:threads, on_delete: :delete_all, type: :binary_id), null: false
      add :user_id, references(:users, on_delete: :delete_all, type: :binary_id), null: false

      timestamps(type: :utc_datetime)
    end

    create index(:memberships, [:thread_id])
    create index(:memberships, [:user_id])
  end
end
