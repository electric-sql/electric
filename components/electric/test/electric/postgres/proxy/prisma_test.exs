defmodule Electric.Postgres.Proxy.PrismaTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Extension.SchemaLoader
  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Prisma
  alias Electric.Postgres.MockSchemaLoader

  def config do
    %Prisma{server_version: {"14.9", 140_009}}
  end

  # as these queries evolve in differing versions of prisma, add the updated
  # queries to the appropriate query lists
  # although that doesn't account for the queries expecting different responses...

  # arity: 0
  @queries [
    {Electric.Postgres.Proxy.Prisma.Query.VersionV5_2, "SELECT version()"},
    {
      Electric.Postgres.Proxy.Prisma.Query.NamespaceVersionV5_2,
      """
      SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = $1), version(), current_setting('server_version_num')::integer as numeric_version;
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.NamespaceV5_2,
      """
      SELECT namespace.nspname as namespace_name
      FROM pg_namespace as namespace
      WHERE namespace.nspname = ANY ( $1 )
      ORDER BY namespace_name;
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.TypeV4_8,
      """
      SELECT t.typname as name, e.enumlabel as value, n.nspname as namespace
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = ANY ( $1 )
      ORDER BY e.enumsortorder
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.TableListV4_8,
      """
      SELECT tbl.relname AS table_name, namespace.nspname as namespace
      FROM pg_class AS tbl
      INNER JOIN pg_namespace AS namespace ON namespace.oid = tbl.relnamespace
      WHERE tbl.relkind = 'r' AND namespace.nspname = ANY ( $1 )
      ORDER BY namespace, table_name;
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.TableV5_2,
      """
      SELECT
      tbl.relname AS table_name,
      namespace.nspname as namespace,
      (tbl.relhassubclass and tbl.relkind = 'p') as is_partition,
      (tbl.relhassubclass and tbl.relkind = 'r') as has_subclass,
      tbl.relrowsecurity as has_row_level_security,
      reloptions,
      obj_description(tbl.oid, 'pg_class') as description
      FROM pg_class AS tbl
      INNER JOIN pg_namespace AS namespace ON namespace.oid = tbl.relnamespace
      WHERE
      ( -- (relkind = 'r' and relispartition = 't') matches partition table "duplicates"
      (tbl.relkind = 'r' AND tbl.relispartition = 'f')
      OR -- when it's a partition
      tbl.relkind = 'p'
      )
      AND namespace.nspname = ANY ( $1 )
      ORDER BY namespace, table_name;
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.ConstraintV5_2,
      """
      SELECT
      schemainfo.nspname AS namespace,
      tableinfo.relname AS table_name,
      constr.conname AS constraint_name,
      constr.contype AS constraint_type,
      pg_get_constraintdef(constr.oid) AS constraint_definition,
      constr.condeferrable AS is_deferrable,
      constr.condeferred AS is_deferred
      FROM pg_constraint constr
      JOIN pg_class AS tableinfo
      ON tableinfo.oid = constr.conrelid
      JOIN pg_namespace AS schemainfo
      ON schemainfo.oid = tableinfo.relnamespace
      WHERE schemainfo.nspname = ANY ( $1 )
      AND contype NOT IN ('p', 'u', 'f')
      ORDER BY namespace, table_name, constr.contype, constraint_name;
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.ViewV4_8,
      """
      SELECT viewname AS view_name, definition AS view_sql, schemaname as namespace
      FROM pg_catalog.pg_views
      WHERE schemaname = ANY ( $1 )
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.ViewV5_2,
      """
      SELECT
      views.viewname AS view_name,
      views.definition AS view_sql,
      views.schemaname AS namespace,
      obj_description(class.oid, 'pg_class') AS description
      FROM pg_catalog.pg_views views
      INNER JOIN pg_catalog.pg_namespace ns ON views.schemaname = ns.nspname
      INNER JOIN pg_catalog.pg_class class ON class.relnamespace = ns.oid AND class.relname = views.viewname
      WHERE schemaname = ANY ( $1 )
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.TypeV5_2,
      """
       SELECT
       t.typname AS name,
       e.enumlabel AS value,
       n.nspname AS namespace,
       obj_description(t.oid, 'pg_type') AS description
       FROM pg_type t
       JOIN pg_enum e ON t.oid = e.enumtypid
       JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = ANY ( $1 )
       ORDER BY e.enumsortorder
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.ColumnV4_8,
      """
      SELECT
          oid.namespace,
          info.table_name,
          info.column_name,
          format_type(att.atttypid, att.atttypmod) as formatted_type,
          info.numeric_precision,
          info.numeric_scale,
          info.numeric_precision_radix,
          info.datetime_precision,
          info.data_type,
          info.udt_name as full_data_type,
          pg_get_expr(attdef.adbin, attdef.adrelid) AS column_default,
          info.is_nullable,
          info.is_identity,
          info.character_maximum_length
      FROM information_schema.columns info
      JOIN pg_attribute att ON att.attname = info.column_name
      JOIN (
           SELECT pg_class.oid, relname, pg_namespace.nspname as namespace
           FROM pg_class
           JOIN pg_namespace on pg_namespace.oid = pg_class.relnamespace
           AND pg_namespace.nspname = ANY ( $1 )
          ) as oid on oid.oid = att.attrelid 
            AND relname = info.table_name
            AND namespace = info.table_schema
      LEFT OUTER JOIN pg_attrdef attdef ON attdef.adrelid = att.attrelid AND attdef.adnum = att.attnum AND table_schema = namespace
      WHERE table_schema = ANY ( $1 ) 
      ORDER BY namespace, table_name, ordinal_position;
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.ColumnV5_2,
      """
      SELECT
          oid.namespace,
          info.table_name,
          info.column_name,
          format_type(att.atttypid, att.atttypmod) as formatted_type,
          info.numeric_precision,
          info.numeric_scale,
          info.numeric_precision_radix,
          info.datetime_precision,
          info.data_type,
          info.udt_schema as type_schema_name,
          info.udt_name as full_data_type,
          pg_get_expr(attdef.adbin, attdef.adrelid) AS column_default,
          info.is_nullable,
          info.is_identity,
          info.character_maximum_length,
          col_description(att.attrelid, ordinal_position) AS description
      FROM information_schema.columns info
      JOIN pg_attribute att ON att.attname = info.column_name
      JOIN (
      SELECT pg_class.oid, relname, pg_namespace.nspname as namespace
      FROM pg_class
      JOIN pg_namespace on pg_namespace.oid = pg_class.relnamespace
      AND pg_namespace.nspname = ANY ( $1 )
      ) as oid on oid.oid = att.attrelid
      AND relname = info.table_name
      AND namespace = info.table_schema
      LEFT OUTER JOIN pg_attrdef attdef ON attdef.adrelid = att.attrelid AND attdef.adnum = att.attnum AND table_schema = namespace
      WHERE table_schema = ANY ( $1 )
      ORDER BY namespace, table_name, ordinal_position;
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.ForeignKeyV4_8,
      """
      SELECT
          con.oid         AS \"con_id\",
          att2.attname    AS \"child_column\",
          cl.relname      AS \"parent_table\",
          att.attname     AS \"parent_column\",
          con.confdeltype,
          con.confupdtype,
          rel_ns.nspname  AS \"referenced_schema_name\",
          conname         AS constraint_name,
          child,
          parent,
          table_name, 
          namespace
      FROM (SELECT 
                  ns.nspname AS \"namespace\",
                  unnest(con1.conkey)                AS \"parent\",
                  unnest(con1.confkey)                AS \"child\",
                  cl.relname                          AS table_name,
                  ns.nspname                          AS schema_name,
                  generate_subscripts(con1.conkey, 1) AS colidx,
                  con1.oid,
                  con1.confrelid,
                  con1.conrelid,
                  con1.conname,
                  con1.confdeltype,
                  con1.confupdtype
          FROM pg_class cl
                  join pg_constraint con1 on con1.conrelid = cl.oid
                  join pg_namespace ns on cl.relnamespace = ns.oid
          WHERE
              ns.nspname = ANY ( $1 )
              and con1.contype = 'f'
          ORDER BY colidx
          ) con
              JOIN pg_attribute att on att.attrelid = con.confrelid and att.attnum = con.child
              JOIN pg_class cl on cl.oid = con.confrelid
              JOIN pg_attribute att2 on att2.attrelid = con.conrelid and att2.attnum = con.parent
              JOIN pg_class rel_cl on con.confrelid = rel_cl.oid
              JOIN pg_namespace rel_ns on rel_cl.relnamespace = rel_ns.oid
      ORDER BY namespace, table_name, constraint_name, con_id, con.colidx;
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.ForeignKeyV5_2,
      """
      SELECT
      con.oid AS "con_id",
      att2.attname AS "child_column",
      cl.relname AS "parent_table",
      att.attname AS "parent_column",
      con.confdeltype,
      con.confupdtype,
      rel_ns.nspname AS "referenced_schema_name",
      conname AS constraint_name,
      child,
      parent,
      table_name,
      namespace,
      condeferrable,
      condeferred
      FROM (SELECT
      ns.nspname AS "namespace",
      unnest(con1.conkey) AS "parent",
      unnest(con1.confkey) AS "child",
      cl.relname AS table_name,
      ns.nspname AS schema_name,
      generate_subscripts(con1.conkey, 1) AS colidx,
      con1.oid,
      con1.confrelid,
      con1.conrelid,
      con1.conname,
      con1.confdeltype,
      con1.confupdtype,
      con1.condeferrable AS condeferrable,
      con1.condeferred AS condeferred
      FROM pg_class cl
      join pg_constraint con1 on con1.conrelid = cl.oid
      join pg_namespace ns on cl.relnamespace = ns.oid
      WHERE
      ns.nspname = ANY ( $1 )
      and con1.contype = 'f'
      ORDER BY colidx
      ) con
      JOIN pg_attribute att on att.attrelid = con.confrelid and att.attnum = con.child
      JOIN pg_class cl on cl.oid = con.confrelid
      JOIN pg_attribute att2 on att2.attrelid = con.conrelid and att2.attnum = con.parent
      JOIN pg_class rel_cl on con.confrelid = rel_cl.oid
      JOIN pg_namespace rel_ns on rel_cl.relnamespace = rel_ns.oid
      ORDER BY namespace, table_name, constraint_name, con_id, con.colidx;
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.IndexV4_8,
      """
      WITH rawindex AS (
          SELECT
              indrelid, 
              indexrelid,
              indisunique,
              indisprimary,
              unnest(indkey) AS indkeyid,
              generate_subscripts(indkey, 1) AS indkeyidx,
              unnest(indclass) AS indclass,
              unnest(indoption) AS indoption
          FROM pg_index -- https://www.postgresql.org/docs/current/catalog-pg-index.html
          WHERE
              indpred IS NULL -- filter out partial indexes
              AND array_position(indkey::int2[], 0::int2) IS NULL -- filter out expression indexes
      )
      SELECT
          schemainfo.nspname AS namespace,
          indexinfo.relname AS index_name,
          tableinfo.relname AS table_name,
          columninfo.attname AS column_name,
          rawindex.indisunique AS is_unique,
          rawindex.indisprimary AS is_primary_key,
          rawindex.indkeyidx AS column_index,
          opclass.opcname AS opclass,
          opclass.opcdefault AS opcdefault,
          indexaccess.amname AS index_algo,
          CASE rawindex.indoption & 1
              WHEN 1 THEN 'DESC'
              ELSE 'ASC' END
              AS column_order
      FROM
          rawindex
          INNER JOIN pg_class AS tableinfo ON tableinfo.oid = rawindex.indrelid
          INNER JOIN pg_class AS indexinfo ON indexinfo.oid = rawindex.indexrelid
          INNER JOIN pg_namespace AS schemainfo ON schemainfo.oid = tableinfo.relnamespace
          INNER JOIN pg_attribute AS columninfo
              ON columninfo.attrelid = tableinfo.oid AND columninfo.attnum = rawindex.indkeyid
          INNER JOIN pg_am AS indexaccess ON indexaccess.oid = indexinfo.relam
          LEFT JOIN pg_opclass AS opclass -- left join because crdb has no opclasses
              ON opclass.oid = rawindex.indclass
      WHERE schemainfo.nspname = ANY ( $1 )
      ORDER BY namespace, table_name, index_name, column_index;
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.IndexV5_2,
      """
      WITH rawindex AS (
       SELECT
       indrelid,
       indexrelid,
       indisunique,
       indisprimary,
       unnest(indkey) AS indkeyid,
       generate_subscripts(indkey, 1) AS indkeyidx,
       unnest(indclass) AS indclass,
       unnest(indoption) AS indoption
       FROM pg_index -- https://www.postgresql.org/docs/current/catalog-pg-index.html
       WHERE
       indpred IS NULL -- filter out partial indexes
       AND NOT indisexclusion -- filter out exclusion constraints
      )
      SELECT
       schemainfo.nspname AS namespace,
       indexinfo.relname AS index_name,
       tableinfo.relname AS table_name,
       columninfo.attname AS column_name,
       rawindex.indisunique AS is_unique,
       rawindex.indisprimary AS is_primary_key,
       rawindex.indkeyidx AS column_index,
       opclass.opcname AS opclass,
       opclass.opcdefault AS opcdefault,
       indexaccess.amname AS index_algo,
       CASE rawindex.indoption & 1
       WHEN 1 THEN 'DESC'
       ELSE 'ASC' END
       AS column_order,
       CASE rawindex.indoption & 2
       WHEN 2 THEN true
       ELSE false END
       AS nulls_first,
       pc.condeferrable AS condeferrable,
       pc.condeferred AS condeferred
      FROM
       rawindex
       INNER JOIN pg_class AS tableinfo ON tableinfo.oid = rawindex.indrelid
       INNER JOIN pg_class AS indexinfo ON indexinfo.oid = rawindex.indexrelid
       INNER JOIN pg_namespace AS schemainfo ON schemainfo.oid = tableinfo.relnamespace
       LEFT JOIN pg_attribute AS columninfo
       ON columninfo.attrelid = tableinfo.oid AND columninfo.attnum = rawindex.indkeyid
       INNER JOIN pg_am AS indexaccess ON indexaccess.oid = indexinfo.relam
       LEFT JOIN pg_opclass AS opclass -- left join because crdb has no opclasses
       ON opclass.oid = rawindex.indclass
       LEFT JOIN pg_constraint pc ON rawindex.indexrelid = pc.conindid AND pc.contype <> 'f'
      WHERE schemainfo.nspname = ANY ( $1 )
      ORDER BY namespace, table_name, index_name, column_index;
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.FunctionV5_2,
      """
      SELECT p.proname AS name, n.nspname as namespace,
      CASE WHEN l.lanname = 'internal' THEN p.prosrc
      ELSE pg_get_functiondef(p.oid)
      END as definition
      FROM pg_proc p
      LEFT JOIN pg_namespace n ON p.pronamespace = n.oid
      LEFT JOIN pg_language l ON p.prolang = l.oid
      WHERE n.nspname = ANY ( $1 )

      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.ExtensionV5_2,
      """
      SELECT
      ext.extname AS extension_name,
      ext.extversion AS extension_version,
      ext.extrelocatable AS extension_relocatable,
      pn.nspname AS extension_schema
      FROM pg_extension ext
      INNER JOIN pg_namespace pn ON ext.extnamespace = pn.oid
      ORDER BY ext.extname ASC
      """
    },
    {
      Electric.Postgres.Proxy.Prisma.Query.SequenceV5_2,
      """
       SELECT
       sequence_name,
       sequence_schema AS namespace,
       start_value::INT8,
       minimum_value::INT8 AS min_value,
       maximum_value::INT8 AS max_value,
       increment::INT8 AS increment_by,
       (CASE cycle_option WHEN 'yes' THEN TRUE ELSE FALSE END) AS cycle,
       0::INT8 AS cache_size
       FROM information_schema.sequences
       WHERE sequence_schema = ANY ( $1 )
       ORDER BY sequence_name

      """
    }
  ]

  describe "parse_query/1" do
    test "introspection queries" do
      for {module, sql} <- @queries do
        assert {:ok, ^module} = Prisma.parse_query(sql)
      end
    end

    test "other sql" do
      assert :passthrough = Prisma.parse_query("SET NAMES 'UTF-8';")
    end

    test "query with multiple statements" do
      assert :passthrough = Prisma.parse_query("SET NAMES 'UTF-8'; SELECT * FROM something;")
    end
  end

  describe "parse_bind_array/1" do
    test "parses a single item array" do
      assert ["public"] =
               Prisma.parse_bind_array(
                 <<0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 19, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 6, 112,
                   117, 98, 108, 105, 99>>
               )
    end

    test "parses a multi-element array" do
      assert ["public", "private", "blue"] =
               Prisma.parse_bind_array(
                 <<0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 19, 0, 0, 0, 3, 0, 0, 0, 1, 0, 0, 0, 6, 112,
                   117, 98, 108, 105, 99, 0, 0, 0, 7, 112, 114, 105, 118, 97, 116, 101, 0, 0, 0,
                   4, 98, 108, 117, 101>>
               )
    end

    test "parses empty array" do
      assert [] =
               Prisma.parse_bind_array(
                 <<0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 19, 0, 0, 0, 0, 0, 0, 0, 1>>
               )
    end
  end

  describe "injector" do
    import Electric.Postgres.Proxy.TestScenario

    setup do
      migrations = [
        {"001",
         [
           "CREATE TABLE items (id uuid PRIMARY KEY, value text, created_at timestamptz)",
           "CREATE TABLE item_things (id uuid PRIMARY KEY, value text, created_at timestamptz, items_id uuid NOT NULL REFERENCES items (id))"
         ]}
      ]

      {module, opts} = MockSchemaLoader.backend_spec(migrations: migrations)
      {:ok, conn} = module.connect([], opts)
      {:ok, injector} = Prisma.injector(config(), loader: {module, conn})
      {:ok, injector: injector, loader: {module, conn}}
    end

    test "client server session", cxt do
      {:ok, _version, schema} = SchemaLoader.load(cxt.loader)

      Enum.reduce(@queries, {cxt.injector, 0}, fn {module, sql}, {injector, n} ->
        m = n + 1
        name = "s#{m}"

        binds =
          case module.parameter_description(config()) do
            [] ->
              []

            [19] ->
              # name
              ["public"]

            [1003] ->
              # 1003 = name[]
              # [112, 117, 98, 108, 105, 99] = ~c"public"
              [
                <<0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 19, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 6, 112,
                  117, 98, 108, 105, 99>>
              ]
          end

        data_rows = module.data_rows(binds, schema, config())

        injector =
          injector
          |> client([%M.Query{query: "SET NAMES 'UTF-8';"}],
            client: [%M.CommandComplete{tag: "SET NAMES"}, %M.ReadyForQuery{status: :idle}]
          )
          |> client(
            [
              %M.Close{type: "S", name: "n#{n}"},
              %M.Sync{}
            ],
            client: [
              %M.CloseComplete{},
              %M.ReadyForQuery{status: :idle}
            ]
          )
          |> client(
            [
              %M.Parse{name: name, query: sql},
              %M.Describe{type: "S", name: name},
              %M.Sync{}
            ],
            client: [
              %M.ParseComplete{},
              %M.ParameterDescription{params: module.parameter_description(config())},
              %M.RowDescription{fields: module.row_description(config())},
              %M.ReadyForQuery{status: :idle}
            ]
          )
          |> client(
            [
              %M.Bind{
                portal: "",
                source: name,
                parameters: binds,
                parameter_format_codes: [1],
                result_format_codes: [1]
              },
              %M.Execute{portal: "", max_rows: 0},
              %M.Sync{}
            ],
            client:
              [%M.BindComplete{}] ++
                Enum.map(data_rows, &%M.DataRow{fields: &1}) ++
                [
                  %M.CommandComplete{tag: "SELECT #{length(data_rows)}"},
                  %M.ReadyForQuery{status: :idle}
                ]
          )

        {injector, m}
      end)
    end
  end
end
