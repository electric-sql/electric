defmodule Burn.Repo.Migrations.CreateThreads do
  use Ecto.Migration

  def change do
    create table(:threads, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :name, :string, null: false
      add :status, :string, null: false

      timestamps(type: :utc_datetime)
    end
  end
end
