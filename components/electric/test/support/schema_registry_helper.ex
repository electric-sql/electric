defmodule Electric.Test.SchemaRegistryHelper do
  alias Electric.Postgres.SchemaRegistry

  def initialize_registry(
        publication,
        {schema, name},
        columns,
        primary_keys \\ ["id"],
        oid \\ 100_001
      ) do
    SchemaRegistry.put_replicated_tables(publication, [
      %{
        schema: schema,
        name: name,
        oid: oid,
        replica_identity: :all_columns,
        primary_keys: primary_keys
      }
    ])

    columns =
      Enum.map(columns, fn {name, type} ->
        %{name: to_string(name), type: type, type_modifier: -1, part_of_identity?: true}
      end)

    SchemaRegistry.put_table_columns({schema, name}, columns)
  end
end
