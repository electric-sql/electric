defmodule Electric.Postgres.Proxy.Prisma.QueryTest do
  use ExUnit.Case, async: true

  alias Hex.Solver.Constraint
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.MockSchemaLoader
  alias Electric.Postgres.Proxy.Prisma

  alias Electric.Postgres.Proxy.Prisma.Query.{
    ColumnV5_2,
    ConstraintV5_2,
    IndexV5_2,
    ExtensionV5_2,
    ForeignKeyV5_2,
    FunctionV5_2,
    SequenceV5_2,
    TypeV5_2,
    ViewV5_2
  }

  # '{public}'
  @public <<0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 19, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 6, 112, 117, 98,
            108, 105, 99>>
  def config do
    %Prisma{}
  end

  setup do
    migrations = [
      {"001",
       [
         "CREATE TABLE public.with_constraint (id text PRIMARY KEY, value TEXT NOT NULL, limited int4 CONSTRAINT limited_check CHECK (limited < 100));",
         "CREATE INDEX with_constraint_idx ON with_constraint (value)"
       ]},
      {"002",
       [
         """
         CREATE TABLE public.checked (
            id text PRIMARY KEY,
            value TEXT NOT NULL,
            count int4 CONSTRAINT count_check CHECK ((count < 100) AND (count > 10)),
            number int4,
            CONSTRAINT combined CHECK (number + count < 200)
         );
         """,
         "CREATE TABLE other.with_constraint (id text PRIMARY KEY, value TEXT NOT NULL, limited int4 CHECK (limited < 100))",
         """
         CREATE TABLE public.interesting (
            id uuid PRIMARY KEY,
            value varchar(255) DEFAULT 'something',
            iii int8[][3] NOT NULL,
            big int8, 
            small int2, 
            nn numeric(12, 6),
            ts timestamptz DEFAULT now(),
            updated timestamptz(3)
         );
         """,
         "CREATE UNIQUE INDEX interesting_idx ON public.interesting USING gist (value DESC NULLS LAST, ts)",
         """
         CREATE TABLE public.pointy (
            id text PRIMARY KEY,
            checked_id text NOT NULL REFERENCES public.checked (id)
         )
         """,
         #  # fake an unique constraint on the fk cols
         "CREATE UNIQUE INDEX checked_fk_idx ON public.checked (id, value)",
         """
         CREATE TABLE public.pointy2 (
            id text PRIMARY KEY,
            checked_id text NOT NULL,
            checked_value text NOT NULL,
            amount smallint,
            code smallint,
            FOREIGN KEY (checked_id, checked_value) REFERENCES public.checked (id, value),
            UNIQUE NULLS DISTINCT (amount, code)
         );
         """
       ]}
    ]

    loader_spec = MockSchemaLoader.backend_spec(migrations: migrations)
    {:ok, loader} = SchemaLoader.connect(loader_spec, [])
    {:ok, version, schema} = SchemaLoader.load(loader)
    {:ok, version: version, schema: schema, loader: loader}
  end

  test "ConstraintV5_2", cxt do
    data_rows = ConstraintV5_2.data_rows([@public], cxt.schema, config())

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
    [] = ViewV5_2.data_rows([@public], cxt.schema, config())
  end

  test "TypeV5_2", cxt do
    [] = TypeV5_2.data_rows([@public], cxt.schema, config())
  end

  test "ColumnV5_2", cxt do
    columns = ColumnV5_2.data_rows([@public], cxt.schema, config())

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
    data_rows = ForeignKeyV5_2.data_rows([@public], cxt.schema, config())

    # can't do an equality check as the actual oids 
    assert Enum.sort(data_rows) ==
             Enum.sort([
               [
                 <<0, 30, 174, 92>>,
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
                 <<0, 30, 211, 77>>,
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
                 <<0, 30, 211, 77>>,
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
    data_rows = IndexV5_2.data_rows([@public], cxt.schema, config())

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
    [] = FunctionV5_2.data_rows([@public], cxt.schema, config())
  end

  test "ExtensionV5_2", cxt do
    [] = ExtensionV5_2.data_rows([@public], cxt.schema, config())
  end

  test "SequenceV5_2", cxt do
    [] = SequenceV5_2.data_rows([@public], cxt.schema, config())
  end
end
