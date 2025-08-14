defmodule Burn.Repo.Migrations.CreateFacts do
  use Ecto.Migration

  def change do
    create table(:facts, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :predicate, :string, null: false
      add :object, :string, null: false
      add :category, :string, null: false
      add :confidence, :decimal, default: "0.8", null: false
      add :disputed, :boolean, default: false, null: false

      add :thread_id, references(:threads, on_delete: :delete_all, type: :binary_id), null: false

      add :source_event_id, references(:events, on_delete: :delete_all, type: :binary_id),
        null: false

      add :tool_use_event_id, references(:events, on_delete: :delete_all, type: :binary_id),
        null: false

      add :subject_id, references(:users, on_delete: :delete_all, type: :binary_id), null: false

      timestamps(type: :utc_datetime)
    end

    create index(:facts, [:thread_id])
    create index(:facts, [:source_event_id])
    create index(:facts, [:tool_use_event_id])
    create index(:facts, [:subject_id])
  end
end
