defmodule Electric.Postgres.Proxy.Prisma.QueryTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.MockSchemaLoader
  alias Electric.Postgres.Proxy.Prisma
  alias Electric.Postgres.Proxy.Prisma.Query

  # '{public}'
  @public <<0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 19, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 6, 112, 117, 98,
            108, 105, 99>>
  def config do
    %Prisma{}
  end

  @migration_dir Path.expand("../../../../support/prisma", __DIR__)

  setup do
    # the migrations are in files to make it easier to reproduce the schema
    # on a real db e.g. `psql database < test/support/prisma/001_query_test.sql`
    migrations = [
      {"001", [File.read!(Path.join(@migration_dir, "001_query_test.sql"))]},
      {"002", [File.read!(Path.join(@migration_dir, "002_query_test.sql"))]}
    ]

    loader_spec = MockSchemaLoader.backend_spec(migrations: migrations)
    {:ok, loader} = SchemaLoader.connect(loader_spec, [])
    {:ok, schema_version} = SchemaLoader.load(loader)
    {:ok, version: schema_version.version, schema: schema_version, loader: loader}
  end

  test "TableV5_2", cxt do
    data_rows = Query.TableV5_2.data_rows([@public], cxt.schema, config())

    assert Enum.sort(data_rows) ==
             Enum.sort([
               ["with_constraint", "public", <<0>>, <<0>>, <<0>>, nil, nil],
               ["checked", "public", <<0>>, <<0>>, <<0>>, nil, nil],
               ["interesting", "public", <<0>>, <<0>>, <<0>>, nil, nil],
               ["pointy", "public", <<0>>, <<0>>, <<0>>, nil, nil],
               ["pointy2", "public", <<0>>, <<0>>, <<0>>, nil, nil]
             ])
  end

  test "ConstraintV5_2", cxt do
    data_rows = Query.ConstraintV5_2.data_rows([@public], cxt.schema, config())

    assert Enum.sort(data_rows) ==
             Enum.sort([
               [
                 "public",
                 "with_constraint",
                 "limited_check",
                 "c",
                 ~s[CHECK (("limited" < 100))],
                 <<0>>,
                 <<0>>
               ],
               [
                 "public",
                 "checked",
                 "count_check",
                 "c",
                 ~s[CHECK ((("count" < 100) AND ("count" > 10)))],
                 <<0>>,
                 <<0>>
               ],
               [
                 "public",
                 "checked",
                 "combined",
                 "c",
                 ~s[CHECK ((("number" + "count") < 200))],
                 <<0>>,
                 <<0>>
               ]
             ])
  end

  test "ViewV5_2", cxt do
    [] = Query.ViewV5_2.data_rows([@public], cxt.schema, config())
  end

  test "TypeV5_2", cxt do
    [] = Query.TypeV5_2.data_rows([@public], cxt.schema, config())
  end

  test "ColumnV5_2", cxt do
    columns = Query.ColumnV5_2.data_rows([@public], cxt.schema, config())

    # get these values from pg by creating the public tables above ^ then
    # setting the proxy mode to transparent and run prisma against the db via
    # the proxy
    assert Enum.sort(columns) ==
             Enum.sort([
               [
                 "public",
                 "checked",
                 "id",
                 "text",
                 nil,
                 nil,
                 nil,
                 nil,
                 "text",
                 "pg_catalog",
                 "text",
                 nil,
                 "NO",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "checked",
                 "count",
                 "integer",
                 <<0, 0, 0, 32>>,
                 <<0, 0, 0, 0>>,
                 <<0, 0, 0, 2>>,
                 nil,
                 "integer",
                 "pg_catalog",
                 "int4",
                 nil,
                 "YES",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "interesting",
                 "id",
                 "uuid",
                 nil,
                 nil,
                 nil,
                 nil,
                 "uuid",
                 "pg_catalog",
                 "uuid",
                 nil,
                 "NO",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "interesting",
                 "nn",
                 "numeric(12, 6)",
                 <<0, 0, 0, 12>>,
                 <<0, 0, 0, 6>>,
                 <<0, 0, 0, 10>>,
                 nil,
                 "numeric",
                 "pg_catalog",
                 "numeric",
                 nil,
                 "YES",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "checked",
                 "value",
                 "text",
                 nil,
                 nil,
                 nil,
                 nil,
                 "text",
                 "pg_catalog",
                 "text",
                 nil,
                 "NO",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "checked",
                 "number",
                 "integer",
                 <<0, 0, 0, 32>>,
                 <<0, 0, 0, 0>>,
                 <<0, 0, 0, 2>>,
                 nil,
                 "integer",
                 "pg_catalog",
                 "int4",
                 nil,
                 "YES",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "interesting",
                 "value",
                 "character varying(255)",
                 nil,
                 nil,
                 nil,
                 nil,
                 "character varying",
                 "pg_catalog",
                 "varchar",
                 # this is what pg returns
                 # "'something'::character varying",
                 # but rather than dealing with the type case, we just return a string
                 "'something'",
                 "YES",
                 "NO",
                 <<0, 0, 0, 255>>,
                 nil
               ],
               [
                 "public",
                 "interesting",
                 "iii",
                 "bigint[]",
                 nil,
                 nil,
                 nil,
                 nil,
                 "ARRAY",
                 "pg_catalog",
                 "_int8",
                 nil,
                 "NO",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "interesting",
                 "big",
                 "bigint",
                 <<0, 0, 0, 64>>,
                 <<0, 0, 0, 0>>,
                 <<0, 0, 0, 2>>,
                 nil,
                 "bigint",
                 "pg_catalog",
                 "int8",
                 nil,
                 "YES",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "interesting",
                 "small",
                 "smallint",
                 <<0, 0, 0, 16>>,
                 <<0, 0, 0, 0>>,
                 <<0, 0, 0, 2>>,
                 nil,
                 "smallint",
                 "pg_catalog",
                 "int2",
                 nil,
                 "YES",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "interesting",
                 "ts",
                 "timestamp with time zone",
                 nil,
                 nil,
                 nil,
                 <<0, 0, 0, 6>>,
                 "timestamp with time zone",
                 "pg_catalog",
                 "timestamptz",
                 "now()",
                 "YES",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "interesting",
                 "updated",
                 "timestamp(3) with time zone",
                 nil,
                 nil,
                 nil,
                 <<0, 0, 0, 3>>,
                 "timestamp with time zone",
                 "pg_catalog",
                 "timestamptz",
                 nil,
                 "YES",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "with_constraint",
                 "id",
                 "text",
                 nil,
                 nil,
                 nil,
                 nil,
                 "text",
                 "pg_catalog",
                 "text",
                 nil,
                 "NO",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "with_constraint",
                 "value",
                 "text",
                 nil,
                 nil,
                 nil,
                 nil,
                 "text",
                 "pg_catalog",
                 "text",
                 nil,
                 "NO",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "with_constraint",
                 "limited",
                 "integer",
                 <<0, 0, 0, 32>>,
                 <<0, 0, 0, 0>>,
                 <<0, 0, 0, 2>>,
                 nil,
                 "integer",
                 "pg_catalog",
                 "int4",
                 nil,
                 "YES",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "pointy",
                 "id",
                 "text",
                 nil,
                 nil,
                 nil,
                 nil,
                 "text",
                 "pg_catalog",
                 "text",
                 nil,
                 "NO",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "pointy",
                 "checked_id",
                 "text",
                 nil,
                 nil,
                 nil,
                 nil,
                 "text",
                 "pg_catalog",
                 "text",
                 nil,
                 "NO",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "pointy2",
                 "checked_id",
                 "text",
                 nil,
                 nil,
                 nil,
                 nil,
                 "text",
                 "pg_catalog",
                 "text",
                 nil,
                 "NO",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "pointy2",
                 "checked_value",
                 "text",
                 nil,
                 nil,
                 nil,
                 nil,
                 "text",
                 "pg_catalog",
                 "text",
                 nil,
                 "NO",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "pointy2",
                 "id",
                 "text",
                 nil,
                 nil,
                 nil,
                 nil,
                 "text",
                 "pg_catalog",
                 "text",
                 nil,
                 "NO",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "pointy2",
                 "amount",
                 "smallint",
                 <<0, 0, 0, 16>>,
                 <<0, 0, 0, 0>>,
                 <<0, 0, 0, 2>>,
                 nil,
                 "smallint",
                 "pg_catalog",
                 "int2",
                 nil,
                 "YES",
                 "NO",
                 nil,
                 nil
               ],
               [
                 "public",
                 "pointy2",
                 "code",
                 "smallint",
                 <<0, 0, 0, 16>>,
                 <<0, 0, 0, 0>>,
                 <<0, 0, 0, 2>>,
                 nil,
                 "smallint",
                 "pg_catalog",
                 "int2",
                 nil,
                 "YES",
                 "NO",
                 nil,
                 nil
               ]
             ])
  end

  test "ForeignKeyV5_2", cxt do
    data_rows = Query.ForeignKeyV5_2.data_rows([@public], cxt.schema, config())

    # can't do an equality check as the actual oids 
    assert Enum.sort(data_rows) ==
             Enum.sort([
               [
                 <<0, 45, 226, 126>>,
                 "checked_id",
                 "checked",
                 "id",
                 "a",
                 "a",
                 "public",
                 "pointy_checked_id_fkey",
                 <<0, 1>>,
                 <<0, 2>>,
                 "pointy",
                 "public",
                 <<0>>,
                 <<0>>
               ],
               [
                 <<0, 34, 178, 22>>,
                 "checked_id",
                 "checked",
                 "id",
                 "a",
                 "a",
                 "public",
                 "pointy2_checked_id_checked_value_fkey",
                 <<0, 1>>,
                 <<0, 2>>,
                 "pointy2",
                 "public",
                 <<0>>,
                 <<0>>
               ],
               [
                 <<0, 34, 178, 22>>,
                 "checked_value",
                 "checked",
                 "value",
                 "a",
                 "a",
                 "public",
                 "pointy2_checked_id_checked_value_fkey",
                 <<0, 2>>,
                 <<0, 3>>,
                 "pointy2",
                 "public",
                 <<0>>,
                 <<0>>
               ]
             ])
  end

  test "IndexV5_2", cxt do
    data_rows = Query.IndexV5_2.data_rows([@public], cxt.schema, config())

    # can't do an equality check as the actual oids 
    assert Enum.sort(data_rows) ==
             Enum.sort([
               [
                 "public",
                 "checked_fk_idx",
                 "checked",
                 "id",
                 <<1>>,
                 <<0>>,
                 <<0, 0, 0, 0>>,
                 "text_ops",
                 <<1>>,
                 "btree",
                 "ASC",
                 <<0>>,
                 nil,
                 nil
               ],
               [
                 "public",
                 "checked_fk_idx",
                 "checked",
                 "value",
                 <<1>>,
                 <<0>>,
                 <<0, 0, 0, 1>>,
                 "text_ops",
                 <<1>>,
                 "btree",
                 "ASC",
                 <<0>>,
                 nil,
                 nil
               ],
               [
                 "public",
                 "checked_pkey",
                 "checked",
                 "id",
                 <<1>>,
                 <<1>>,
                 <<0, 0, 0, 0>>,
                 "text_ops",
                 <<1>>,
                 "btree",
                 "ASC",
                 <<0>>,
                 <<0>>,
                 <<0>>
               ],
               [
                 "public",
                 "interesting_idx",
                 "interesting",
                 "value",
                 <<1>>,
                 <<0>>,
                 <<0, 0, 0, 0>>,
                 "text_ops",
                 <<1>>,
                 "btree",
                 "DESC",
                 <<0>>,
                 nil,
                 nil
               ],
               [
                 "public",
                 "interesting_idx",
                 "interesting",
                 "ts",
                 <<1>>,
                 <<0>>,
                 <<0, 0, 0, 1>>,
                 "timestamptz_ops",
                 <<1>>,
                 "btree",
                 "ASC",
                 <<0>>,
                 nil,
                 nil
               ],
               [
                 "public",
                 "interesting_pkey",
                 "interesting",
                 "id",
                 <<1>>,
                 <<1>>,
                 <<0, 0, 0, 0>>,
                 "uuid_ops",
                 <<1>>,
                 "btree",
                 "ASC",
                 <<0>>,
                 <<0>>,
                 <<0>>
               ],
               [
                 "public",
                 "pointy_pkey",
                 "pointy",
                 "id",
                 <<1>>,
                 <<1>>,
                 <<0, 0, 0, 0>>,
                 "text_ops",
                 <<1>>,
                 "btree",
                 "ASC",
                 <<0>>,
                 <<0>>,
                 <<0>>
               ],
               [
                 "public",
                 "pointy2_amount_code_key",
                 "pointy2",
                 "amount",
                 <<1>>,
                 <<0>>,
                 <<0, 0, 0, 0>>,
                 "int2_ops",
                 <<1>>,
                 "btree",
                 "ASC",
                 <<0>>,
                 <<0>>,
                 <<0>>
               ],
               [
                 "public",
                 "pointy2_amount_code_key",
                 "pointy2",
                 "code",
                 <<1>>,
                 <<0>>,
                 <<0, 0, 0, 1>>,
                 "int2_ops",
                 <<1>>,
                 "btree",
                 "ASC",
                 <<0>>,
                 <<0>>,
                 <<0>>
               ],
               [
                 "public",
                 "pointy2_pkey",
                 "pointy2",
                 "id",
                 <<1>>,
                 <<1>>,
                 <<0, 0, 0, 0>>,
                 "text_ops",
                 <<1>>,
                 "btree",
                 "ASC",
                 <<0>>,
                 <<0>>,
                 <<0>>
               ],
               [
                 "public",
                 "with_constraint_idx",
                 "with_constraint",
                 "value",
                 <<0>>,
                 <<0>>,
                 <<0, 0, 0, 0>>,
                 "text_ops",
                 <<1>>,
                 "btree",
                 "ASC",
                 <<0>>,
                 nil,
                 nil
               ],
               [
                 "public",
                 "with_constraint_pkey",
                 "with_constraint",
                 "id",
                 <<1>>,
                 <<1>>,
                 <<0, 0, 0, 0>>,
                 "text_ops",
                 <<1>>,
                 "btree",
                 "ASC",
                 <<0>>,
                 <<0>>,
                 <<0>>
               ]
             ])
  end

  test "FunctionV5_2", cxt do
    [] = Query.FunctionV5_2.data_rows([@public], cxt.schema, config())
  end

  test "ExtensionV5_2", cxt do
    [] = Query.ExtensionV5_2.data_rows([@public], cxt.schema, config())
  end

  test "SequenceV5_2", cxt do
    [] = Query.SequenceV5_2.data_rows([@public], cxt.schema, config())
  end
end
