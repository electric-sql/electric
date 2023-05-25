defmodule Electric.Postgres.SchemaRegistryTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.SchemaRegistry

  @publication "test_tables"

  def gen_table(name) do
    oid = :erlang.phash2(name, 50_000)

    %{
      name: name,
      schema: "public",
      oid: oid,
      primary_keys: ["id"],
      replica_identity: :all_columns
    }
  end

  @name __MODULE__.SchemaRegistry

  setup do
    {:ok, _pid} = start_supervised({SchemaRegistry, name: @name})
    :ok
  end

  test "registry starts empty" do
    assert SchemaRegistry.fetch_replicated_tables(@name, @publication) == :error
  end

  test "can put and fetch all tables for publication" do
    tables = [
      gen_table("table_1"),
      gen_table("table_2"),
      gen_table("table_3")
    ]

    assert SchemaRegistry.put_replicated_tables(@name, @publication, tables) == :ok
    assert SchemaRegistry.fetch_replicated_tables(@name, @publication) == {:ok, tables}
  end

  test "can add a new table to a publication" do
    tables = [
      gen_table("table_1"),
      gen_table("table_2"),
      gen_table("table_3")
    ]

    assert SchemaRegistry.put_replicated_tables(@name, @publication, tables) == :ok
    table = gen_table("table_4")

    assert SchemaRegistry.put_replicated_tables(@name, @publication, [table]) == :ok
    assert SchemaRegistry.fetch_replicated_tables(@name, @publication) == {:ok, tables ++ [table]}

    for t <- tables ++ [table] do
      assert SchemaRegistry.fetch_table_info(@name, {t.schema, t.name}) == {:ok, t}
    end
  end

  test "can add a new table to an empty publication" do
    table = gen_table("table_4")

    assert SchemaRegistry.put_replicated_tables(@name, @publication, [table]) == :ok
    assert SchemaRegistry.fetch_replicated_tables(@name, @publication) == {:ok, [table]}

    for t <- [table] do
      assert SchemaRegistry.fetch_table_info(@name, {t.schema, t.name}) == {:ok, t}
    end
  end

  test "overwrites existing table info" do
    tables = [
      gen_table("table_1"),
      gen_table("table_2"),
      gen_table("table_3")
    ]

    table = gen_table("table_4")

    assert SchemaRegistry.put_replicated_tables(@name, @publication, tables ++ [table]) == :ok

    table2 = %{table | primary_keys: []}

    assert SchemaRegistry.put_replicated_tables(@name, @publication, [table2]) == :ok

    assert SchemaRegistry.fetch_replicated_tables(@name, @publication) ==
             {:ok, tables ++ [table2]}

    assert SchemaRegistry.fetch_table_info(@name, {table.schema, table.name}) == {:ok, table2}
  end
end
