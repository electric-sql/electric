defmodule Electric.Postgres.Support.Migrations.CreateThing do
  use Electric.Postgres.Extension.Migration

  def up(schema) do
    [
      "CREATE TABLE #{schema}.things (id uuid PRIMARY KEY)"
    ]
  end

  def down(schema) do
    [
      "DROP TABLE #{schema}.things CASCADE"
    ]
  end
end
