defmodule Electric.Postgres.Proxy.Migrations.Ecto.CreateTable do
  use Ecto.Migration

  def change do
    create table("table1", prefix: "public", primary_key: false) do
      add(:id, :text, primary_key: true)
      add(:name, :text)
    end

    execute("ALTER TABLE public.table1 ENABLE ELECTRIC")
  end
end
