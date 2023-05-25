defmodule Electric.Postgres.Dialect.SqliteTest do
  use Electric.Postgres.Case, async: false
  use ExUnitProperties
  # currently we only allow additive migrations to propagate from pg to sqlite
  # so this only tests for create table, alter table.. add column and add index
  # in theory add constraint would also be covered by this but here be dragons

  alias Electric.Postgres.Dialect.SQLite

  setup do
    {:ok, liteconn} = Exqlite.Sqlite3.open(":memory:")
    {:ok, liteconn: liteconn}
  end

  def oid_loader(type, schema, name) do
    {:ok, Enum.join(["#{type}", schema, name], ".") |> :erlang.phash2(50_000)}
  end

  def to_sqlite(pgsql, cxt, opts \\ []) do
    sqls =
      pgsql
      |> parse()
      |> Enum.map(&SQLite.to_sql(&1, opts))

    # IO.puts(Enum.join(sqls, "\n--\n\n"))

    if Keyword.get(opts, :validate, true) do
      for sql <- sqls do
        # IO.puts("sqlite> " <> sql)
        # Validate that the sql will run
        :ok = Exqlite.Sqlite3.execute(cxt.liteconn, sql)
      end
    end

    sqls
  end

  test "column type mapping", _cxt do
    make_type = fn
      type when is_binary(type) ->
        %Proto.Column.Type{name: type}

      {type, array: array} ->
        %Proto.Column.Type{name: type, array: array}

      {type, size: size} ->
        %Proto.Column.Type{name: type, size: size}
    end

    map_type = fn types ->
      Enum.map(types, make_type)
    end

    map_array_type = fn types ->
      Enum.map(types, &make_type.({&1, array: [-1]}))
    end

    map_sized_type = fn types ->
      Enum.map(types, &make_type.({&1, size: [23]}))
    end

    types = [
      # INTEGER
      {map_type.(Postgres.integer_types()), "INTEGER"},
      {map_array_type.(Postgres.integer_types()), "TEXT_JSON"},
      # FLOAT
      {map_type.(Postgres.float_types()), "REAL"},
      {map_array_type.(Postgres.float_types()), "TEXT_JSON"},
      # TEXT
      {map_type.(Postgres.text_types()), "TEXT"},
      {map_array_type.(Postgres.text_types()), "TEXT_JSON"},
      {map_sized_type.(Postgres.text_types()), "TEXT(23)"},
      # BLOB
      {map_type.(Postgres.binary_types()), "BLOB"},
      # not sure this is right
      {map_array_type.(Postgres.binary_types()), "TEXT_JSON"},
      # DATE/TIME/DATETIME
      {map_type.(Postgres.datetime_types()), "TEXT"},
      {map_array_type.(Postgres.datetime_types()), "TEXT_JSON"},
      # BOOL
      {map_type.(Postgres.bool_types()), "INTEGER"},
      {map_array_type.(Postgres.bool_types()), "TEXT_JSON"},
      # UUID
      {map_type.(Postgres.uuid_types()), "BLOB"},
      {map_array_type.(Postgres.bool_types()), "TEXT_JSON"},
      # JSON
      {map_type.(Postgres.json_types()), "TEXT_JSON"}
    ]

    for {pg_types, sqlite_type} <- types do
      for pg_type <- pg_types do
        assert SQLite.map_type(pg_type) == sqlite_type
      end
    end
  end

  describe "CREATE TABLE" do
    test "maps column types", cxt do
      sql = """
      CREATE TABLE i (
        id smallint PRIMARY KEY,
        i1 smallint,
        i2 int[],
        i3 uuid,
        i4 timestamp without time zone,
        i5 jsonb,
        i6 bigint,
        i7 float8
      );
      """

      [sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE TABLE "i" (
               "id" INTEGER NOT NULL,
               "i1" INTEGER,
               "i2" TEXT_JSON,
               "i3" BLOB,
               "i4" TEXT,
               "i5" TEXT_JSON,
               "i6" INTEGER,
               "i7" REAL,
               CONSTRAINT "i_pkey" PRIMARY KEY ("id")
             ) WITHOUT ROWID;
             """
    end

    test "allows for compact output", cxt do
      sql = """
      CREATE TABLE i (
        id smallint PRIMARY KEY,
        i1 smallint,
        i2 int[],
        i3 uuid,
        i4 timestamp without time zone,
        i5 jsonb,
        i6 bigint,
        i7 float8
      );
      """

      [sqlite] = to_sqlite(sql, cxt, pretty: false)

      assert sqlite ==
               IO.iodata_to_binary([
                 ~s[CREATE TABLE "i" (],
                 ~s["id" INTEGER NOT NULL,],
                 ~s["i1" INTEGER,],
                 ~s["i2" TEXT_JSON,],
                 ~s["i3" BLOB,],
                 ~s["i4" TEXT,],
                 ~s["i5" TEXT_JSON,],
                 ~s["i6" INTEGER,],
                 ~s["i7" REAL,],
                 ~s[CONSTRAINT "i_pkey" PRIMARY KEY ("id")],
                 ~s[) WITHOUT ROWID;]
               ])
    end

    test "if not exists", cxt do
      sql = """
      CREATE TABLE IF NOT EXISTS i (id smallint PRIMARY KEY);
      """

      [sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE TABLE IF NOT EXISTS "i" (
               "id" INTEGER NOT NULL,
               CONSTRAINT "i_pkey" PRIMARY KEY ("id")
             ) WITHOUT ROWID;
             """
    end

    test "ignores schema", cxt do
      sql = """
      CREATE TABLE "myschema"."i" (
        id smallint PRIMARY KEY
      );
      """

      [sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE TABLE "i" (
               "id" INTEGER NOT NULL,
               CONSTRAINT "i_pkey" PRIMARY KEY ("id")
             ) WITHOUT ROWID;
             """
    end

    test "adds primary key constraints", cxt do
      sql = """
      CREATE TABLE "i" (
        id int8 PRIMARY KEY,
        name varchar(256) NOT NULL
      );
      """

      [sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE TABLE "i" (
               "id" INTEGER NOT NULL,
               "name" TEXT(256) NOT NULL,
               CONSTRAINT "i_pkey" PRIMARY KEY ("id")
             ) WITHOUT ROWID;
             """
    end

    test "adds foreign key constraints", cxt do
      sql = """
      CREATE TABLE "i" (
        id int8 PRIMARY KEY,
        j_id int8 REFERENCES j (id) ON DELETE CASCADE ON UPDATE SET DEFAULT,
        j_id2 int8 REFERENCES j (id),
        name varchar(256) NOT NULL
      );
      """

      [sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE TABLE "i" (
               "id" INTEGER NOT NULL,
               "j_id" INTEGER,
               "j_id2" INTEGER,
               "name" TEXT(256) NOT NULL,
               CONSTRAINT "i_j_id_fkey" FOREIGN KEY ("j_id") REFERENCES "j" ("id") ON DELETE CASCADE ON UPDATE SET DEFAULT,
               CONSTRAINT "i_j_id2_fkey" FOREIGN KEY ("j_id2") REFERENCES "j" ("id"),
               CONSTRAINT "i_pkey" PRIMARY KEY ("id")
             ) WITHOUT ROWID;
             """
    end

    test "adds check constraints", cxt do
      sql = """
      CREATE TABLE "i" (
        id int8 PRIMARY KEY,
        c1 int8 CONSTRAINT "not_zero" CHECK (c1 > 0),
        c2 int8 CONSTRAINT "percent" CHECK ((c2 >= 0) AND (c2 <= 100)),
        c3 text CONSTRAINT "starts" CHECK (substring(c3 from 1 for 3) == 'his'),
        CONSTRAINT "makes_sense" CHECK ((c1 + c2) < 100)
      );
      """

      [sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE TABLE "i" (
               "id" INTEGER NOT NULL,
               "c1" INTEGER,
               "c2" INTEGER,
               "c3" TEXT,
               CONSTRAINT "makes_sense" CHECK ((("c1" + "c2") < 100)),
               CONSTRAINT "not_zero" CHECK (("c1" > 0)),
               CONSTRAINT "starts" CHECK ((substring("c3", 1, 3) == 'his')),
               CONSTRAINT "percent" CHECK ((("c2" >= 0) AND ("c2" <= 100))),
               CONSTRAINT "i_pkey" PRIMARY KEY ("id")
             ) WITHOUT ROWID;
             """
    end

    test "adds unique column constraints", cxt do
      sql = """
      CREATE TABLE "i" (
        id int8 PRIMARY KEY,
        c1 int8 UNIQUE NULLS NOT DISTINCT
      );
      """

      [sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE TABLE "i" (
               "id" INTEGER NOT NULL,
               "c1" INTEGER,
               CONSTRAINT "i_pkey" PRIMARY KEY ("id"),
               CONSTRAINT "i_c1_key" UNIQUE ("c1")
             ) WITHOUT ROWID;
             """
    end

    test "adds unique table constraints", cxt do
      sql = """
      CREATE TABLE "i" (
        id int8 primary key,
        c1 int8,
        c2 int8,
        UNIQUE NULLS NOT DISTINCT (c1, c2)
      );
      """

      [sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE TABLE "i" (
               "id" INTEGER NOT NULL,
               "c1" INTEGER,
               "c2" INTEGER,
               CONSTRAINT "i_pkey" PRIMARY KEY ("id"),
               CONSTRAINT "i_c1_c2_key" UNIQUE ("c1", "c2")
             ) WITHOUT ROWID;
             """
    end

    test "defaults", cxt do
      sql = """
      CREATE TABLE "i" (
        id int8 PRIMARY KEY,
        c1 int8 DEFAULT 13,
        c2 boolean DEFAULT true,
        c3 boolean DEFAULT false,
        c4 varchar (35) DEFAULT 'something',
        c5 float4 DEFAULT 3.14,
        c6 json DEFAULT '{"this":"thing"}',
        c7 bytea DEFAULT '\\x2F',
        c8 int8 DEFAULT '13'::int8,
        c9 timestamptz DEFAULT CURRENT_TIMESTAMP
      );
      """

      [sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE TABLE "i" (
               "id" INTEGER NOT NULL,
               "c1" INTEGER DEFAULT 13,
               "c2" INTEGER DEFAULT 1,
               "c3" INTEGER DEFAULT 0,
               "c4" TEXT(35) DEFAULT 'something',
               "c5" REAL DEFAULT 3.14,
               "c6" TEXT_JSON DEFAULT '{"this":"thing"}',
               "c7" BLOB DEFAULT x'2F',
               "c8" INTEGER DEFAULT (CAST('13' AS INTEGER)),
               "c9" TEXT DEFAULT current_timestamp,
               CONSTRAINT "i_pkey" PRIMARY KEY ("id")
             ) WITHOUT ROWID;
             """
    end

    test "generated columns", cxt do
      # trim(leading 'x' from v2) gets mapped by the parser to ltrim(v2, 'x') which is sqlite compatible...
      sql = """
      CREATE TABLE "i" (
        id int8 primary key,
        v1 text,
        v2 text,
        v3 text,
        vv1 text generated always as (v1 || v2) STORED,
        vv2 text generated always as (concat(upper(v1), trim(LEADING 'x' FROM v2), v3)) STORED
      );
      """

      [sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE TABLE "i" (
               "id" INTEGER NOT NULL,
               "v1" TEXT,
               "v2" TEXT,
               "v3" TEXT,
               "vv1" TEXT GENERATED ALWAYS AS ("v1" || "v2") STORED,
               "vv2" TEXT GENERATED ALWAYS AS (coalesce(upper("v1"), '') || coalesce(ltrim("v2", 'x'), '') || coalesce("v3", '')) STORED,
               CONSTRAINT "i_pkey" PRIMARY KEY ("id")
             ) WITHOUT ROWID;
             """
    end
  end

  describe "ALTER TABLE ... ADD COLUMN" do
    test "maps column definition", cxt do
      sql = """
      CREATE TABLE i (id INTEGER PRIMARY KEY);
      ALTER TABLE i ADD COLUMN c11 varchar (35) DEFAULT 'something';
      """

      [_, sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             ALTER TABLE "i" ADD COLUMN "c11" TEXT(35) DEFAULT 'something';
             """
    end

    test "includes column constraints", cxt do
      sql = """
      CREATE TABLE i (id INTEGER PRIMARY KEY);
      ALTER TABLE i ADD COLUMN c3 text CONSTRAINT "starts" CHECK (substring(c3 from 1 for 3) == 'his');
      """

      [_, sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             ALTER TABLE "i" ADD COLUMN "c3" TEXT CONSTRAINT "starts" CHECK ((substring("c3", 1, 3) == 'his'));
             """
    end

    # see https://sqlite.org/lang_altertable.html
    # The column may not have a PRIMARY KEY or UNIQUE constraint
    test "raises when trying to add pk", cxt do
      sql = """
      CREATE TABLE i (val text);
      ALTER TABLE i ADD COLUMN id uuid PRIMARY KEY;
      """

      assert_raise SQLite.Error, fn ->
        to_sqlite(sql, cxt)
      end
    end

    test "raises when trying to add unique constraint", cxt do
      sql = """
      CREATE TABLE i (val text);
      ALTER TABLE i ADD COLUMN id uuid UNIQUE;
      """

      assert_raise SQLite.Error, fn ->
        to_sqlite(sql, cxt)
      end
    end

    test "includes fk definitions", cxt do
      sql = """
      CREATE TABLE i (id int8 PRIMARY KEY, val text);
      CREATE TABLE j (id int8 PRIMARY KEY);
      ALTER TABLE i ADD COLUMN j_id int8 REFERENCES j (id) ON DELETE CASCADE ON UPDATE SET DEFAULT;
      """

      [_, _, sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             ALTER TABLE "i" ADD COLUMN "j_id" INTEGER CONSTRAINT "i_j_id_fkey" REFERENCES "j" ("id") ON DELETE CASCADE ON UPDATE SET DEFAULT;
             """
    end

    test "converts compound statements into multiple", cxt do
      sql = """
      CREATE TABLE i (id int8 PRIMARY KEY);
      ALTER TABLE i ADD COLUMN value text, ADD COLUMN size integer DEFAULT 1;
      """

      [_sql1, sql2, sql3] = to_sqlite(sql, cxt)

      assert sql2 == """
             ALTER TABLE "i" ADD COLUMN "value" TEXT;
             """

      assert sql3 == """
             ALTER TABLE "i" ADD COLUMN "size" INTEGER DEFAULT 1;
             """
    end

    # FIXME: VAX-600 we don't actually support serial pks, this test is here as an intermediate
    # fix until we are more intelligent about only sending ddl for electrified tables
    test "SERIAL primary keys", cxt do
      sql = """
      CREATE TABLE i (id SERIAL, k INTEGER DEFAULT '0' NOT NULL, PRIMARY KEY (id));
      """

      [sql1] = to_sqlite(sql, cxt)

      assert sql1 == """
             CREATE TABLE "i" (
               "id" INTEGER NOT NULL,
               "k" INTEGER DEFAULT '0' NOT NULL,
               CONSTRAINT "i_pkey" PRIMARY KEY ("id")
             ) WITHOUT ROWID;
             """
    end
  end

  describe "CREATE INDEX" do
    test "maps to sqlite equivalent", cxt do
      sql = """
      CREATE TABLE i (id int8 PRIMARY KEY, val1 int, val2 varchar);
      CREATE INDEX CONCURRENTLY i_idx ON i (val1 DESC, val2);
      """

      [_, sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE INDEX "i_idx" ON "i" ("val1" DESC, "val2" ASC);
             """
    end

    test "if not exists", cxt do
      sql = """
      CREATE TABLE i (id int8 PRIMARY KEY, val1 int, val2 varchar);
      CREATE INDEX CONCURRENTLY IF NOT EXISTS i_idx ON i (val1 DESC, val2 ASC);
      """

      [_, sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE INDEX IF NOT EXISTS "i_idx" ON "i" ("val1" DESC, "val2" ASC);
             """
    end

    test "unique indexes", cxt do
      sql = """
      CREATE TABLE i (id int8 PRIMARY KEY, val1 int, val2 varchar);
      CREATE UNIQUE INDEX i_idx ON i (val1 DESC, val2 ASC);
      """

      [_, sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE UNIQUE INDEX "i_idx" ON "i" ("val1" DESC, "val2" ASC);
             """
    end

    test "partial indexes", cxt do
      sql = """
      CREATE TABLE i (id int8 PRIMARY KEY, val1 int, val2 varchar);
      CREATE UNIQUE INDEX i_idx ON i (val1 DESC, val2 ASC) WHERE val1 IS NOT NULL;
      CREATE UNIQUE INDEX i_idx1 ON i (val1 DESC, val2 ASC) WHERE val2 IS NULL;
      CREATE UNIQUE INDEX i_idx2 ON i (val1 DESC, val2 ASC) WHERE val1 > 0 AND val2 != '';
      """

      [_, sqlite1, sqlite2, sqlite3] = to_sqlite(sql, cxt)

      assert sqlite1 == """
             CREATE UNIQUE INDEX "i_idx" ON "i" ("val1" DESC, "val2" ASC) WHERE "val1" IS NOT NULL;
             """

      assert sqlite2 == """
             CREATE UNIQUE INDEX "i_idx1" ON "i" ("val1" DESC, "val2" ASC) WHERE "val2" IS NULL;
             """

      assert sqlite3 == """
             CREATE UNIQUE INDEX "i_idx2" ON "i" ("val1" DESC, "val2" ASC) WHERE (("val1" > 0) AND ("val2" <> ''));
             """
    end

    test "index on expression", cxt do
      sql = """
      CREATE TABLE i (id int8 PRIMARY KEY, val1 int, val2 varchar);
      CREATE INDEX i_idx ON i (upper(val2) ASC);
      """

      [_, sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE INDEX "i_idx" ON "i" (upper("val2") ASC);
             """
    end

    test "collations", cxt do
      # https://www.sqlite.org/datatype3.html#collating_sequences
      # sqlite has 3 collations:
      # - BINARY Compares string data using memcmp(), regardless of text encoding
      # - NOCASE - Similar to binary, except that it uses sqlite3_strnicmp() for the comparison
      # - RTRIM - The same as binary, except that trailing space characters are ignored
      # so let's just ignore pg collations. completely. for now.
      sql = """
      CREATE TABLE i (id int8 PRIMARY KEY, val1 int, val2 varchar);
      CREATE INDEX i_idx ON i (val2 COLLATE "en_GB.utf8");
      """

      [_, sqlite] = to_sqlite(sql, cxt)

      assert sqlite == """
             CREATE INDEX "i_idx" ON "i" ("val2" ASC);
             """
    end
  end

  property "generated sql", cxt do
    {:ok, pid} = SQLGenerator.SchemaAgent.start_link()

    check all(
            sql <-
              SQLGenerator.sql_stream(
                [:create_table, :create_index],
                schema: pid,
                create_table: [
                  temporary_tables: false,
                  serial: false,
                  exclude_types: [:bit]
                ],
                alter_table: [
                  except: [:drop_not_null, :generated, :set_type, :alter_constraint]
                ],
                create_index: [
                  named: :always,
                  only_supported: true
                ]
              )
          ) do
      # IO.puts("> " <> sql)
      to_sqlite(sql, cxt, validate: true)
    end
  end
end
