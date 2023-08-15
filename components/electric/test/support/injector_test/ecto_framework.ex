defmodule Electric.Proxy.InjectorTest.EctoFramework do
  def description, do: "ecto"
  def tag, do: :ecto

  def ps_name(id) do
    "ecto_insert_schema_migrations_#{id}"
  end

  def migration_query(version) do
    %{
      action: :insert,
      table: migration_table(),
      values: [version: version, inserted_at: DateTime.utc_now()],
      name: ps_name(0),
      tag: "INSERT 1"
    }
  end

  def migration_table do
    %Electric.Proxy.InjectorTest.Table{
      schema: "public",
      name: "schema_migrations",
      columns: %{
        version: %Electric.Proxy.InjectorTest.Column{
          name: "version",
          type: :int8
        },
        inserted_at: %Electric.Proxy.InjectorTest.Column{
          name: "inserted_at",
          type: :timestamptz
        }
      }
    }
  end

  # def set_migration_version()
end
