defmodule Electric.Postgres.Proxy.Migrations.Ecto.AlterTable do
  use Ecto.Migration

  def change do
    alter table("table1", prefix: "public") do
      add(:value, :text)
    end
  end
end
