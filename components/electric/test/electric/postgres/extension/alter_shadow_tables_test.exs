defmodule Electric.Postgres.Extension.AlterShadowTablesTest do
  use Electric.Extension.Case,
    async: false

  alias Electric.Postgres.Schema

  require Record

  Record.defrecord(:column,
    ord: nil,
    name: nil,
    type: nil,
    size: nil,
    not_null: nil,
    default: nil,
    ident: nil,
    gen: nil,
    comment: nil,
    primary_key: nil,
    is_local: nil,
    storage: nil,
    collation: nil,
    namespace: nil,
    class_name: nil,
    sql_identifier: nil,
    relid: nil,
    options: nil,
    definition: nil,
    sequence: nil
  )

  def get_tombstone_schema(conn, schema, table) do
    {tombstone_schema, tombstone_table} = Schema.tombstone_table_name(schema, table)
    get_table_schema(conn, tombstone_schema, tombstone_table)
  end

  def get_shadow_schema(conn, schema, table) do
    {shadow_schema, shadow_table} = Schema.shadow_table_name(schema, table)
    get_table_schema(conn, shadow_schema, shadow_table)
  end

  def get_table_schema(conn, schema, table) do
    {:ok, _, rows} =
      :epgsql.equery(
        conn,
        "SELECT electric.ddlgen_describe('#{schema}.#{table}'::regclass)"
      )

    {:ok,
     Enum.map(rows, fn {row} ->
       row |> Tuple.to_list() |> then(&[:column | &1]) |> List.to_tuple()
     end)}
  end

  def trigger_function_source(conn, function_name) do
    {:ok, _, [{src}]} =
      :epgsql.equery(
        conn,
        "select prosrc from pg_proc p inner join pg_namespace n  on n.oid = p.pronamespace where p.proname = $1 and n.nspname = $2",
        [function_name, "electric"]
      )

    {:ok, src}
  end

  defp column_names(rows) do
    Enum.map(rows, fn column(name: name) -> name end) |> MapSet.new()
  end

  test_tx "procedure adds correct columns to shadow tables", fn conn ->
    sql1 = "CREATE TABLE public.buttercup (id text PRIMARY KEY, value text);"
    sql2 = "CALL electric.electrify('public.buttercup')"

    for sql <- [sql1, sql2] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, [_]} = Extension.ddl_history(conn)

    {:ok, rows} = get_shadow_schema(conn, "public", "buttercup")

    names = column_names(rows)

    for n <- ~w(__reordered_name _tag_name) do
      refute MapSet.member?(names, n)
    end

    {:ok, rows} = get_tombstone_schema(conn, "public", "buttercup")
    names = column_names(rows)

    for n <- ~w(name) do
      refute MapSet.member?(names, n)
    end

    # test representative generated trigger function
    {:ok, src} = trigger_function_source(conn, "generate_tombstone_entry___public__buttercup")

    assert src =~ ~r/OLD\.id/
    refute src =~ ~r/OLD\.name/

    {:ok, _, _} = :epgsql.squery(conn, "ALTER TABLE public.buttercup ADD name text")

    {:ok, _, _} =
      :epgsql.squery(
        conn,
        "CALL electric.alter_shadow_table('public', 'buttercup', 'add', 'name', 'text')"
      )

    {:ok, rows} = get_shadow_schema(conn, "public", "buttercup")

    names = column_names(rows)

    for n <- ~w(__reordered_name _tag_name) do
      assert MapSet.member?(names, n)
    end

    {:ok, rows} = get_tombstone_schema(conn, "public", "buttercup")
    names = column_names(rows)

    for n <- ~w(name) do
      assert MapSet.member?(names, n)
    end

    {:ok, src} = trigger_function_source(conn, "generate_tombstone_entry___public__buttercup")

    assert src =~ ~r/OLD\.name/
  end
end
