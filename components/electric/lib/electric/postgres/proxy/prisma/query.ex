defmodule Electric.Postgres.Proxy.Prisma.Query do
  alias Electric.Postgres.Proxy.Prisma
  alias Electric.Postgres.Schema
  alias PgProtocol.Message, as: M

  @type data_row() :: [binary()]
  @callback column_names() :: [String.t()]
  @callback parameter_description(Prisma.t()) :: [integer()]
  @callback row_description(Prisma.t()) :: [M.RowDescription.Field.t()]
  @callback data_rows([term()], Schema.t(), Prisma.t()) :: [data_row()]

  # PG_VERSION_NUM => sprintf("%d%04d", $majorver, $minorver)
  defguard is_major_version(config, v)
           when is_struct(config, Electric.Postgres.Proxy.Prisma) and
                  div(elem(config.server_version, 1), 10_000) == v

  def field(args) do
    struct(
      %M.RowDescription.Field{
        oid: 0,
        attnum: 0,
        type: 19,
        typlen: -1,
        typmod: -1,
        fmt: 0
      },
      args
    )
  end

  def server_version_string(%{server_version: {v, _}}) do
    "PostgreSQL #{v} Electric"
  end

  def namespace_exists?(schema, namespace) do
    Enum.any?(schema.tables, &(&1.name.schema == namespace))
  end

  def bool(b) when is_boolean(b) do
    if b, do: <<1>>, else: <<0>>
  end

  def bool(nil), do: nil

  def i16(v) when is_integer(v) do
    <<v::integer-signed-big-16>>
  end

  def i16(nil) do
    nil
  end

  def i32(v) when is_integer(v) do
    <<v::integer-signed-big-32>>
  end

  def i32(nil) do
    nil
  end

  def i64(v) when is_integer(v) do
    <<v::integer-signed-big-64>>
  end

  def i64(nil) do
    nil
  end

  def parse_name_array(name_array) do
    Prisma.parse_bind_array(name_array)
  end

  def tables_in_schema(nspname_array, schema) do
    nspname_array
    |> parse_name_array()
    |> Enum.flat_map(&tables_for_schema(&1, schema))
  end

  defp tables_for_schema(nspname, schema) do
    Enum.filter(schema.tables, &(&1.name.schema == nspname))
  end
end

defmodule Electric.Postgres.Proxy.Prisma.Query.VersionV5_2 do
  @moduledoc """
  SELECT version()
  """
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  import Electric.Postgres.Proxy.Prisma.Query

  # not actually used
  def column_names() do
    ["version()"]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    []
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "version", type: 25)
    ]
  end

  def data_rows(_binds, _schema, config) do
    [[server_version_string(config)]]
  end
end

defmodule Electric.Postgres.Proxy.Prisma.Query.NamespaceVersionV5_2 do
  @moduledoc """
  SELECT 
    EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = $1),
    version(),
    current_setting('server_version_num')::integer as numeric_version;
  """
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    ["", "", "numeric_version"]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [19]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "exists", type: 16, typlen: 1),
      field(name: "version", type: 25),
      field(name: "numeric_version", type: 23, typlen: 4)
    ]
  end

  def data_rows([nspname], schema, %{server_version: {_, v}} = config) do
    exists = namespace_exists?(schema, nspname)
    [[bool(exists), server_version_string(config), i32(v)]]
  end
end

defmodule Electric.Postgres.Proxy.Prisma.Query.NamespaceV5_2 do
  @moduledoc """
  SELECT namespace.nspname as namespace_name
  FROM pg_namespace as namespace
  WHERE namespace.nspname = ANY ( $1 )
  ORDER BY namespace_name;

  Honestly baffled as to the point of this query...
  """
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    ["namespace_name"]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "namespace_name", oid: 2615, attnum: 2, type: 19, typlen: 64)
    ]
  end

  def data_rows([nspname_array], schema, _config) do
    # see above re questions over purpose of this..
    # exists = namespace_exists?(schema, nspname)
    nspname_array
    |> parse_name_array()
    |> Enum.filter(&namespace_exists?(schema, &1))
    |> Enum.map(&[&1])
    |> Enum.sort()
  end
end

defmodule Electric.Postgres.Proxy.Prisma.Query.TableListV4_8 do
  @moduledoc """
  SELECT tbl.relname AS table_name, namespace.nspname as namespace
  FROM pg_class AS tbl
  INNER JOIN pg_namespace AS namespace ON namespace.oid = tbl.relnamespace
  WHERE tbl.relkind = 'r' AND namespace.nspname = ANY ( $1 )
  ORDER BY namespace, table_name;
  """
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    ["table_name", "namespace"]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "table_name", oid: 1259, attnum: 2, type: 19, typlen: 64),
      field(name: "namespace", oid: 2615, attnum: 2, type: 19, typlen: 64)
    ]
  end

  def data_rows([nspname_array], schema, _config) do
    nspname_array
    |> tables_in_schema(schema)
    |> Enum.map(&table_entry/1)
    |> Enum.sort_by(fn [t, s] -> [s, t] end)
  end

  defp table_entry(table) do
    [table.name.name, table.name.schema]
  end
end

defmodule Electric.Postgres.Proxy.Prisma.Query.TableV5_2 do
  @moduledoc """
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
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    [
      "table_name",
      "namespace",
      "is_partition",
      "has_subclass",
      "has_row_level_security",
      "reloptions",
      "description"
    ]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "table_name", oid: 1259, attnum: 2, type: 19, typlen: 64),
      field(name: "namespace", oid: 2615, attnum: 2, type: 19, typlen: 64),
      field(name: "is_partition", type: 16, typlen: 1),
      field(name: "has_subclass", type: 16, typlen: 1),
      field(name: "has_row_level_security", oid: 1259, attnum: 23, type: 16, typlen: 1),
      field(name: "reloptions", oid: 1259, attnum: 32, type: 1009),
      field(name: "description", type: 25)
    ]
  end

  def data_rows([nspname_array], schema, _config) do
    nspname_array
    |> tables_in_schema(schema)
    |> Enum.flat_map(&table_description/1)
    |> Enum.sort_by(fn [t, s | _] -> [s, t] end)
  end

  defp table_description(table) do
    [[table.name.name, table.name.schema, bool(false), bool(false), bool(false), nil, nil]]
  end
end

defmodule Electric.Postgres.Proxy.Prisma.Query.ConstraintV5_2 do
  @moduledoc """
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

  Lists: 

  - check constraints
  - constraint trigger
  - exclusion constraints

  Does not list:

  - primary keys
  - unique constraints
  - foreign keys
  """
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  alias Electric.Postgres.Dialect

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    [
      "namespace",
      "table_name",
      "constraint_name",
      "constraint_type",
      "constraint_definition",
      "is_deferrable",
      "is_deferred"
    ]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "namespace", oid: 2615, attnum: 2, type: 19, typlen: 64),
      field(name: "table_name", oid: 1259, attnum: 2, type: 19, typlen: 64),
      field(name: "constraint_name", oid: 2606, attnum: 2, type: 19, typlen: 64),
      field(name: "constraint_type", oid: 2606, attnum: 4, type: 18, typlen: 1),
      field(name: "constraint_definition", type: 25),
      field(name: "is_deferrable", oid: 2606, attnum: 5, type: 16, typlen: 1),
      field(name: "is_deferred", oid: 2606, attnum: 6, type: 16, typlen: 1)
    ]
  end

  def data_rows([nspname_array], schema, _config) do
    nspname_array
    |> tables_in_schema(schema)
    |> Enum.flat_map(&table_check_constraints/1)
    |> Enum.sort_by(fn [ns, tn, cn, ct | _] -> [ns, tn, cn, ct] end)
  end

  defp table_check_constraints(table) do
    table.constraints
    |> Enum.filter(&is_check_constraint/1)
    |> Enum.map(fn %{constraint: {:check, check}} = constraint ->
      [
        table.name.schema,
        table.name.name,
        check.name,
        "c",
        Dialect.Postgresql.to_sql(constraint, named_constraint: false),
        bool(false),
        bool(false)
      ]
    end)
  end

  defp is_check_constraint(%{constraint: {:check, _}}), do: true
  defp is_check_constraint(%{constraint: {_, _}}), do: false
end

defmodule Electric.Postgres.Proxy.Prisma.Query.ViewV4_8 do
  @moduledoc """
  SELECT viewname AS view_name, definition AS view_sql, schemaname as namespace
  FROM pg_catalog.pg_views
  WHERE schemaname = ANY ( $1 )
  """
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    ["view_name", "view_sql", "namespace"]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "view_name", oid: 12245, attnum: 2, type: 19, typlen: 64),
      field(name: "view_sql", oid: 12245, attnum: 4, type: 25),
      field(name: "namespace", oid: 12245, attnum: 1, type: 19, typlen: 64)
    ]
  end

  # we don't support views
  def data_rows([_nspname], _schema, _config) do
    []
  end
end

defmodule Electric.Postgres.Proxy.Prisma.Query.ViewV5_2 do
  @moduledoc """
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
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    ["view_name", "view_sql", "namespace", "description"]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "view_name", oid: 12245, attnum: 2, type: 19, typlen: 64),
      field(name: "view_sql", oid: 12245, attnum: 4, type: 25),
      field(name: "namespace", oid: 12245, attnum: 1, type: 19, typlen: 64),
      field(name: "description", type: 25)
    ]
  end

  # we don't support views
  def data_rows([_nspname], _schema, _config) do
    []
  end
end

defmodule Electric.Postgres.Proxy.Prisma.Query.TypeV4_8 do
  @moduledoc """
  SELECT t.typname as name, e.enumlabel as value, n.nspname as namespace
  FROM pg_type t
  JOIN pg_enum e ON t.oid = e.enumtypid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = ANY ( $1 )
  ORDER BY e.enumsortorder
  """
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    ["name", "value", "namespace"]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "name", oid: 1247, attnum: 2, type: 19, typlen: 64),
      field(name: "value", oid: 3501, attnum: 4, type: 19, typlen: 64),
      field(name: "namespace", oid: 2615, attnum: 2, type: 19, typlen: 64)
    ]
  end

  # we don't support custom types
  def data_rows([_nspname], _schema, _config) do
    []
  end
end

defmodule Electric.Postgres.Proxy.Prisma.Query.TypeV5_2 do
  @moduledoc """
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
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    ["name", "value", "namespace", "description"]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "name", oid: 1247, attnum: 2, type: 19, typlen: 64),
      field(name: "value", oid: 3501, attnum: 4, type: 19, typlen: 64),
      field(name: "namespace", oid: 2615, attnum: 2, type: 19, typlen: 64),
      field(name: "description", type: 25)
    ]
  end

  # we don't support custom types
  def data_rows([_nspname], _schema, _config) do
    []
  end
end

defmodule Electric.Postgres.Proxy.Prisma.Query.ColumnV4_8 do
  @moduledoc """
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
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  alias Electric.Postgres.Dialect

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    [
      "oid.namespace",
      "info.table_name",
      "info.column_name",
      "formatted_type",
      "info.numeric_precision",
      "info.numeric_scale",
      "info.numeric_precision_radix",
      "info.datetime_precision",
      "info.data_type",
      "full_data_type",
      "column_default",
      "info.is_nullable",
      "info.is_identity",
      "info.character_maximum_length"
    ]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "namespace", oid: 2615, attnum: 2, type: 19, typlen: 64),
      field(name: "table_name", oid: 13499, attnum: 3, type: 19, typlen: 64),
      field(name: "column_name", oid: 13499, attnum: 4, type: 19, typlen: 64),
      field(name: "formatted_type", type: 25),
      field(name: "numeric_precision", oid: 13499, attnum: 11, type: 23, typlen: 4),
      field(name: "numeric_scale", oid: 13499, attnum: 13, type: 23, typlen: 4),
      field(name: "numeric_precision_radix", oid: 13499, attnum: 12, type: 23, typlen: 4),
      field(name: "datetime_precision", oid: 13499, attnum: 14, type: 23, typlen: 4),
      field(name: "data_type", oid: 13499, attnum: 8, type: 1043),
      field(name: "full_data_type", oid: 13499, attnum: 28, type: 19, typlen: 64),
      field(name: "column_default", type: 25),
      field(name: "is_nullable", oid: 13499, attnum: 7, type: 1043, typmod: 7),
      field(name: "is_identity", oid: 13499, attnum: 35, type: 1043, typmod: 7),
      field(name: "character_maximum_length", oid: 13499, attnum: 9, type: 23, typlen: 4)
    ]
  end

  def data_rows([nspname_array], schema, _config) do
    # ["public", "items", "id", "text", nil, nil, nil, nil, "text", "pg_catalog", "text", nil, "NO", "NO", nil, nil],
    nspname_array
    |> tables_in_schema(schema)
    |> Enum.flat_map(&table_columns/1)
    |> Enum.sort_by(fn [op, ns, tn | _] -> [ns, tn, op] end)
    |> Enum.map(fn [_ | rest] -> rest end)
  end

  defp table_columns(table) do
    table.columns
    |> Enum.with_index()
    |> Enum.map(fn {column, i} ->
      {precision, scale, radix} = numeric_precision_scale(column)

      [
        # the index maps to the `ordinal_position` in the query
        # and is used for sorting the columns before being stripped out
        i,
        table.name.schema,
        table.name.name,
        column.name,
        formatted_type(column.type),
        precision,
        scale,
        radix,
        datetime_precision(column),
        data_type(column.type),
        # WTF udt_name (underlying type)
        full_data_type(column.type),
        # expression
        column_default(column),
        is_nullable(column),
        # not sure what an "identity" column is, doesn't seem to be primary key
        yesno(false),
        # the () bit of char columns
        character_maximum_length(column)
      ]
    end)
  end

  @arbitrary_precision_types Electric.Postgres.arbitrary_precision_types()
  @timestamp_types Electric.Postgres.timestamp_types()
  @text_types Electric.Postgres.text_types()
  @integer_types Electric.Postgres.integer_types()

  def formatted_type(%{name: n, array: bounds, size: size}) do
    dim =
      case bounds do
        [] -> ""
        [_ | _] -> "[]"
      end

    formatted_type_name(n, size) <> dim
  end

  defp sized([]), do: ""

  defp sized(s),
    do: IO.iodata_to_binary(["(", s |> Enum.map(&to_string/1) |> Enum.intersperse(", "), ")"])

  defp formatted_type_name("int4", _size), do: "integer"
  defp formatted_type_name("int2", _size), do: "smallint"
  defp formatted_type_name("int8", _size), do: "bigint"

  defp formatted_type_name("timestamptz", size),
    do: "timestamp#{sized(size)} with time zone"

  defp formatted_type_name("varchar", size), do: "character varying" <> sized(size)
  defp formatted_type_name(name, size), do: name <> sized(size)

  defp data_type(%{name: "timestamptz"}) do
    "timestamp with time zone"
  end

  defp data_type(%{array: [_ | _]}) do
    "ARRAY"
  end

  defp data_type(%{name: "varchar"}) do
    "character varying"
  end

  defp data_type(%{name: name}) when name in @integer_types do
    formatted_type_name(name, [])
  end

  defp data_type(%{name: name}) do
    name
  end

  # pg seems to represent internal array types as "_" <> orig type, so e.g. "_int8", "_name"
  defp full_data_type(%{name: name, array: [_ | _]}), do: "_" <> name
  defp full_data_type(%{name: name}), do: name

  defp numeric_precision_scale(%{type: %{name: name} = type})
       when name in @arbitrary_precision_types do
    %{size: [p, s | _]} = type
    {i32(p), i32(s), i32(10)}
  end

  defp numeric_precision_scale(%{type: %{name: name, array: [_ | _]}})
       when name in @integer_types do
    {nil, nil, nil}
  end

  defp numeric_precision_scale(%{type: %{name: name}}) when name in @integer_types do
    n =
      case name do
        big when big in ["int8", "bigint"] -> 64
        int when int in ["int", "integer", "int4"] -> 32
        small when small in ["int2", "smallint"] -> 16
      end

    {i32(n), i32(0), i32(2)}
  end

  defp numeric_precision_scale(_type) do
    {nil, nil, nil}
  end

  defp datetime_precision(%{type: %{name: name} = type}) when name in @timestamp_types do
    type.size
    |> List.first(6)
    |> i32()
  end

  defp datetime_precision(_column), do: nil

  defp is_nullable(column) do
    is_not_null_constraint = fn
      %{constraint: {:not_null, _}} -> true
      _ -> false
    end

    !Enum.any?(column.constraints, is_not_null_constraint) |> yesno()
  end

  defp character_maximum_length(%{type: %{name: name} = type}) when name in @text_types do
    type.size
    |> List.first(nil)
    |> i32()
  end

  defp character_maximum_length(_), do: nil

  defp column_default(column) do
    is_default_constraint = fn
      %{constraint: {:default, default}} -> default.expr
      _ -> false
    end

    column.constraints
    |> Enum.find_value(is_default_constraint)
    |> Dialect.Postgresql.expression()
  end

  defp yesno(true), do: "YES"
  defp yesno(false), do: "NO"
end

defmodule Electric.Postgres.Proxy.Prisma.Query.ColumnV5_2 do
  @moduledoc """
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
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  alias Electric.Postgres.Dialect

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    [
      "oid.namespace",
      "info.table_name",
      "info.column_name",
      "formatted_type",
      "info.numeric_precision",
      "info.numeric_scale",
      "info.numeric_precision_radix",
      "info.datetime_precision",
      "info.data_type",
      "type_schema_name",
      "full_data_type",
      "column_default",
      "info.is_nullable",
      "info.is_identity",
      "info.character_maximum_length",
      "description"
    ]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "namespace", oid: 2615, attnum: 2, type: 19, typlen: 64),
      field(name: "table_name", oid: 13499, attnum: 3, type: 19, typlen: 64),
      field(name: "column_name", oid: 13499, attnum: 4, type: 19, typlen: 64),
      field(name: "formatted_type", type: 25),
      field(name: "numeric_precision", oid: 13499, attnum: 11, type: 23, typlen: 4),
      field(name: "numeric_scale", oid: 13499, attnum: 13, type: 23, typlen: 4),
      field(name: "numeric_precision_radix", oid: 13499, attnum: 12, type: 23, typlen: 4),
      field(name: "datetime_precision", oid: 13499, attnum: 14, type: 23, typlen: 4),
      field(name: "data_type", oid: 13499, attnum: 8, type: 1043),
      field(name: "type_schema_name", oid: 13499, attnum: 27, type: 19, typlen: 64),
      field(name: "full_data_type", oid: 13499, attnum: 28, type: 19, typlen: 64),
      field(name: "column_default", type: 25),
      field(name: "is_nullable", oid: 13499, attnum: 7, type: 1043, typmod: 7),
      field(name: "is_identity", oid: 13499, attnum: 35, type: 1043, typmod: 7),
      field(name: "character_maximum_length", oid: 13499, attnum: 9, type: 23, typlen: 4),
      field(name: "description", type: 25)
    ]
  end

  def data_rows([nspname_array], schema, _config) do
    # ["public", "items", "id", "text", nil, nil, nil, nil, "text", "pg_catalog", "text", nil, "NO", "NO", nil, nil],
    nspname_array
    |> tables_in_schema(schema)
    |> Enum.flat_map(&table_columns/1)
    |> Enum.sort_by(fn [op, ns, tn | _] -> [ns, tn, op] end)
    |> Enum.map(fn [_ | rest] -> rest end)
  end

  defp table_columns(table) do
    table.columns
    |> Enum.with_index()
    |> Enum.map(fn {column, i} ->
      {precision, scale, radix} = numeric_precision_scale(column)

      [
        # the index maps to the `ordinal_position` in the query
        # and is used for sorting the columns before being stripped out
        i,
        table.name.schema,
        table.name.name,
        column.name,
        formatted_type(column.type),
        precision,
        scale,
        radix,
        datetime_precision(column),
        data_type(column.type),
        "pg_catalog",
        # WTF udt_name (underlying type)
        full_data_type(column.type),
        # expression
        column_default(column),
        is_nullable(column),
        # not sure what an "identity" column is, doesn't seem to be primary key
        yesno(false),
        # the () bit of char columns
        character_maximum_length(column),
        nil
      ]
    end)
  end

  @arbitrary_precision_types Electric.Postgres.arbitrary_precision_types()
  @timestamp_types Electric.Postgres.timestamp_types()
  @text_types Electric.Postgres.text_types()
  @integer_types Electric.Postgres.integer_types()

  def formatted_type(%{name: n, array: bounds, size: size}) do
    dim =
      case bounds do
        [] -> ""
        [_ | _] -> "[]"
      end

    formatted_type_name(n, size) <> dim
  end

  defp sized([]), do: ""

  defp sized(s),
    do: IO.iodata_to_binary(["(", s |> Enum.map(&to_string/1) |> Enum.intersperse(", "), ")"])

  defp formatted_type_name("int4", _size), do: "integer"
  defp formatted_type_name("int2", _size), do: "smallint"
  defp formatted_type_name("int8", _size), do: "bigint"

  defp formatted_type_name("timestamptz", size),
    do: "timestamp#{sized(size)} with time zone"

  defp formatted_type_name("varchar", size), do: "character varying" <> sized(size)
  defp formatted_type_name(name, size), do: name <> sized(size)

  defp data_type(%{name: "timestamptz"}) do
    "timestamp with time zone"
  end

  defp data_type(%{array: [_ | _]}) do
    "ARRAY"
  end

  defp data_type(%{name: "varchar"}) do
    "character varying"
  end

  defp data_type(%{name: name}) when name in @integer_types do
    formatted_type_name(name, [])
  end

  defp data_type(%{name: name}) do
    name
  end

  # pg seems to represent internal array types as "_" <> orig type, so e.g. "_int8", "_name"
  defp full_data_type(%{name: name, array: [_ | _]}), do: "_" <> name
  defp full_data_type(%{name: name}), do: name

  defp numeric_precision_scale(%{type: %{name: name} = type})
       when name in @arbitrary_precision_types do
    %{size: [p, s | _]} = type
    {i32(p), i32(s), i32(10)}
  end

  defp numeric_precision_scale(%{type: %{name: name, array: [_ | _]}})
       when name in @integer_types do
    {nil, nil, nil}
  end

  defp numeric_precision_scale(%{type: %{name: name}}) when name in @integer_types do
    n =
      case name do
        big when big in ["int8", "bigint"] -> 64
        int when int in ["int", "integer", "int4"] -> 32
        small when small in ["int2", "smallint"] -> 16
      end

    {i32(n), i32(0), i32(2)}
  end

  defp numeric_precision_scale(_type) do
    {nil, nil, nil}
  end

  defp datetime_precision(%{type: %{name: name} = type}) when name in @timestamp_types do
    type.size
    |> List.first(6)
    |> i32()
  end

  defp datetime_precision(_column), do: nil

  defp is_nullable(column) do
    is_not_null_constraint = fn
      %{constraint: {:not_null, _}} -> true
      _ -> false
    end

    !Enum.any?(column.constraints, is_not_null_constraint) |> yesno()
  end

  defp character_maximum_length(%{type: %{name: name} = type}) when name in @text_types do
    type.size
    |> List.first(nil)
    |> i32()
  end

  defp character_maximum_length(_), do: nil

  defp column_default(column) do
    is_default_constraint = fn
      %{constraint: {:default, default}} -> default.expr
      _ -> false
    end

    column.constraints
    |> Enum.find_value(is_default_constraint)
    |> Dialect.Postgresql.expression()
  end

  defp yesno(true), do: "YES"
  defp yesno(false), do: "NO"
end

defmodule Electric.Postgres.Proxy.Prisma.Query.ForeignKeyV4_8 do
  @moduledoc """
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
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  alias Electric.Postgres.Schema

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    [
      "con_id",
      "child_column",
      "parent_table",
      "parent_column",
      "con.confdeltype",
      "con.confupdtype",
      "referenced_schema_name",
      "constraint_name",
      "child",
      "parent",
      "table_name",
      "namespace"
    ]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "con_id", oid: 2606, attnum: 1, type: 26, typlen: 4),
      field(name: "child_column", oid: 1249, attnum: 2, type: 19, typlen: 64),
      field(name: "parent_table", oid: 1249, attnum: 2, type: 19, typlen: 64),
      field(name: "parent_column", oid: 1249, attnum: 2, type: 19, typlen: 64),
      field(name: "confdeltype", oid: 2606, attnum: 14, type: 18, typlen: 1),
      field(name: "confupdtype", oid: 2606, attnum: 13, type: 18, typlen: 1),
      field(name: "referenced_schema_name", oid: 2615, attnum: 2, type: 19, typlen: 64),
      field(name: "constraint_name", oid: 2606, attnum: 2, type: 19, typlen: 64),
      field(name: "child", type: 21, typlen: 2),
      field(name: "parent", type: 21, typlen: 2),
      field(name: "table_name", oid: 1259, attnum: 2, type: 19, typlen: 64),
      field(name: "namespace", oid: 2615, attnum: 2, type: 19, typlen: 64)
    ]
  end

  def data_rows([nspname_array], schema, _config) do
    nspname_array
    |> tables_in_schema(schema)
    |> Enum.flat_map(&table_fks(&1, schema))
    |> Enum.sort_by(fn [colidx, ci, _, _, _, _, _, _, cn, _, _, tn, ns] ->
      [ns, tn, cn, ci, colidx]
    end)
    |> Enum.map(fn [_ | rest] -> rest end)
  end

  defp table_fks(table, schema) do
    table.constraints
    |> Enum.filter(&is_fk/1)
    |> Enum.flat_map(fn %{constraint: {:foreign, fk}} ->
      fk.pk_cols
      |> Enum.zip(fk.fk_cols)
      |> Enum.with_index()
      |> Enum.map(fn {{parent_column, child_column}, i} ->
        {:ok, parent_table} = Schema.fetch_table(schema, fk.pk_table)

        parent_idx =
          Enum.find_index(parent_table.columns, &(&1.name == parent_column)) ||
            raise "column #{child_column} not found in table #{table.name}"

        child_idx =
          Enum.find_index(table.columns, &(&1.name == child_column)) ||
            raise "column #{child_column} not found in table #{table.name}"

        [
          # index for ordering only and will be stripped
          i,
          # make up an oid that we're unlikely to hit in real life
          # and make sure every fk oid is different
          i32(table.oid + 2_000_000 + :erlang.phash2(fk.name, 1_000_000)),
          child_column,
          fk.pk_table.name,
          parent_column,
          action(fk.on_delete),
          action(fk.on_update),
          fk.pk_table.schema,
          fk.name,
          # I think they have these values the wrong way around, in that the
          # col index of the referenced column is named as the "child"
          i16(parent_idx + 1),
          i16(child_idx + 1),
          table.name.name,
          table.name.schema
        ]
      end)
    end)
  end

  defp is_fk(%{constraint: {:foreign, _}}), do: true
  defp is_fk(_), do: false

  defp action(:NO_ACTION), do: "a"
  defp action(:RESTRICT), do: "r"
  defp action(:CASCADE), do: "c"
  defp action(:SET_NULL), do: "n"
  defp action(:SET_DEFAULT), do: "d"
end

defmodule Electric.Postgres.Proxy.Prisma.Query.ForeignKeyV5_2 do
  @moduledoc """
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
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  alias Electric.Postgres.Schema

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    [
      "con_id",
      "child_column",
      "parent_table",
      "parent_column",
      "con.confdeltype",
      "con.confupdtype",
      "referenced_schema_name",
      "constraint_name",
      "child",
      "parent",
      "table_name",
      "namespace",
      "condeferrable",
      "condeferred"
    ]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "con_id", oid: 2606, attnum: 1, type: 26, typlen: 4),
      field(name: "child_column", oid: 1249, attnum: 2, type: 19, typlen: 64),
      field(name: "parent_table", oid: 1249, attnum: 2, type: 19, typlen: 64),
      field(name: "parent_column", oid: 1249, attnum: 2, type: 19, typlen: 64),
      field(name: "confdeltype", oid: 2606, attnum: 14, type: 18, typlen: 1),
      field(name: "confupdtype", oid: 2606, attnum: 13, type: 18, typlen: 1),
      field(name: "referenced_schema_name", oid: 2615, attnum: 2, type: 19, typlen: 64),
      field(name: "constraint_name", oid: 2606, attnum: 2, type: 19, typlen: 64),
      field(name: "child", type: 21, typlen: 2),
      field(name: "parent", type: 21, typlen: 2),
      field(name: "table_name", oid: 1259, attnum: 2, type: 19, typlen: 64),
      field(name: "namespace", oid: 2615, attnum: 2, type: 19, typlen: 64),
      field(name: "condeferrable", oid: 2606, attnum: 5, type: 16, typlen: 1),
      field(name: "condeferred", oid: 2606, attnum: 6, type: 16, typlen: 1)
    ]
  end

  def data_rows([nspname_array], schema, _config) do
    nspname_array
    |> tables_in_schema(schema)
    |> Enum.flat_map(&table_fks(&1, schema))
    |> Enum.sort_by(fn [colidx, ci, _, _, _, _, _, _, cn, _, _, tn, ns, _, _] ->
      [ns, tn, cn, ci, colidx]
    end)
    |> Enum.map(fn [_ | rest] -> rest end)
  end

  defp table_fks(table, schema) do
    table.constraints
    |> Enum.filter(&is_fk/1)
    |> Enum.flat_map(fn %{constraint: {:foreign, fk}} ->
      fk.pk_cols
      |> Enum.zip(fk.fk_cols)
      |> Enum.with_index()
      |> Enum.map(fn {{parent_column, child_column}, i} ->
        {:ok, parent_table} = Schema.fetch_table(schema, fk.pk_table)

        parent_idx =
          Enum.find_index(parent_table.columns, &(&1.name == parent_column)) ||
            raise "column #{child_column} not found in table #{table.name}"

        child_idx =
          Enum.find_index(table.columns, &(&1.name == child_column)) ||
            raise "column #{child_column} not found in table #{table.name}"

        [
          # index for ordering only and will be stripped
          i,
          # make up an oid that we're unlikely to hit in real life
          # and make sure every fk oid is different
          i32(table.oid + 2_000_000 + :erlang.phash2(fk.name, 1_000_000)),
          child_column,
          fk.pk_table.name,
          parent_column,
          action(fk.on_delete),
          action(fk.on_update),
          fk.pk_table.schema,
          fk.name,
          # I think they have these values the wrong way around, in that the
          # col index of the referenced column is named as the "child"
          i16(parent_idx + 1),
          i16(child_idx + 1),
          table.name.name,
          table.name.schema,
          bool(fk.deferrable),
          bool(fk.initdeferred)
        ]
      end)
    end)
  end

  defp is_fk(%{constraint: {:foreign, _}}), do: true
  defp is_fk(_), do: false

  defp action(:NO_ACTION), do: "a"
  defp action(:RESTRICT), do: "r"
  defp action(:CASCADE), do: "c"
  defp action(:SET_NULL), do: "n"
  defp action(:SET_DEFAULT), do: "d"
end

defmodule Electric.Postgres.Proxy.Prisma.Query.IndexV4_8 do
  @moduledoc """
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
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    [
      "namespace",
      "index_name",
      "table_name",
      "column_name",
      "is_unique",
      "is_primary_key",
      "column_index",
      "opclass",
      "opcdefault",
      "index_algo",
      "column_order"
    ]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "namespace", oid: 2615, attnum: 2, type: 19, typlen: 64),
      field(name: "index_name", oid: 1259, attnum: 2, type: 19, typlen: 64),
      field(name: "table_name", oid: 1259, attnum: 2, type: 19, typlen: 64),
      field(name: "column_name", oid: 1249, attnum: 2, type: 19, typlen: 64),
      field(name: "is_unique", oid: 2610, attnum: 5, type: 16, typlen: 1),
      field(name: "is_primary_key", oid: 2610, attnum: 6, type: 16, typlen: 1),
      field(name: "column_index", type: 23, typlen: 4),
      field(name: "opclass", oid: 2616, attnum: 3, type: 19, typlen: 64),
      field(name: "opcdefault", oid: 2616, attnum: 8, type: 16, typlen: 1),
      field(name: "index_algo", oid: 2601, attnum: 2, type: 19, typlen: 64),
      field(name: "column_order", type: 25)
    ]
  end

  def data_rows([nspname_array], schema, _config) do
    # ["public", "items_pkey", "items", "id", <<1>>, <<1>>, <<0, 0, 0, 0>>, "text_ops", <<1>>, "btree", "ASC", <<0>>, <<0>>, <<0>>]
    nspname_array
    |> tables_in_schema(schema)
    |> Enum.flat_map(&table_indexes(&1, schema))
    |> Enum.sort_by(fn [ns, idn, tn, _, _, _, idx | _] -> [ns, tn, idn, idx] end)
  end

  defp table_indexes(table, schema) do
    Enum.flat_map(table.indexes, fn index ->
      index.columns
      |> Enum.with_index()
      |> Enum.map(fn {column, i} ->
        column_def = column_def(table, column.name)

        [
          table.name.schema,
          index.name,
          table.name.name,
          column.name,
          bool(index.unique),
          bool(false),
          i32(i),
          opclass(column_def),
          bool(true),
          "btree",
          to_string(column.ordering)
        ]
      end)
    end) ++ table_constraints(table, schema)
  end

  defp table_constraints(table, _schema) do
    Enum.flat_map(table.constraints, fn
      %{constraint: {type, constraint}} when type in [:primary, :unique] ->
        constraint.keys
        |> Enum.with_index()
        |> Enum.map(fn {column_name, i} ->
          column_def = column_def(table, column_name)

          [
            table.name.schema,
            constraint.name,
            table.name.name,
            column_name,
            bool(true),
            bool(type == :primary),
            i32(i),
            opclass(column_def),
            bool(true),
            "btree",
            "ASC"
          ]
        end)

      _ ->
        []
    end)
  end

  defp column_def(table, column_name) do
    Enum.find(table.columns, &(&1.name == column_name)) ||
      raise "column #{column_name} not found in table #{table.name}"
  end

  @text_types Electric.Postgres.text_types()

  defp opclass(%{type: %{name: typename}}) do
    case typename do
      t when t in @text_types -> "text_ops"
      t -> "#{t}_ops"
    end
  end
end

defmodule Electric.Postgres.Proxy.Prisma.Query.IndexV5_2 do
  @moduledoc """
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
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    [
      "namespace",
      "index_name",
      "table_name",
      "column_name",
      "is_unique",
      "is_primary_key",
      "column_index",
      "opclass",
      "opcdefault",
      "index_algo",
      "column_order",
      "nulls_first",
      "condeferrable",
      "condeferred"
    ]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "namespace", oid: 2615, attnum: 2, type: 19, typlen: 64),
      field(name: "index_name", oid: 1259, attnum: 2, type: 19, typlen: 64),
      field(name: "table_name", oid: 1259, attnum: 2, type: 19, typlen: 64),
      field(name: "column_name", oid: 1249, attnum: 2, type: 19, typlen: 64),
      field(name: "is_unique", oid: 2610, attnum: 5, type: 16, typlen: 1),
      field(name: "is_primary_key", oid: 2610, attnum: 6, type: 16, typlen: 1),
      field(name: "column_index", type: 23, typlen: 4),
      field(name: "opclass", oid: 2616, attnum: 3, type: 19, typlen: 64),
      field(name: "opcdefault", oid: 2616, attnum: 8, type: 16, typlen: 1),
      field(name: "index_algo", oid: 2601, attnum: 2, type: 19, typlen: 64),
      field(name: "column_order", type: 25),
      field(name: "nulls_first", type: 16, typlen: 1),
      field(name: "condeferrable", oid: 2606, attnum: 5, type: 16, typlen: 1),
      field(name: "condeferred", oid: 2606, attnum: 6, type: 16, typlen: 1)
    ]
  end

  def data_rows([nspname_array], schema, _config) do
    # ["public", "items_pkey", "items", "id", <<1>>, <<1>>, <<0, 0, 0, 0>>, "text_ops", <<1>>, "btree", "ASC", <<0>>, <<0>>, <<0>>]
    nspname_array
    |> tables_in_schema(schema)
    |> Enum.flat_map(&table_indexes(&1, schema))
    |> Enum.sort_by(fn [ns, idn, tn, _, _, _, idx | _] -> [ns, tn, idn, idx] end)
  end

  defp table_indexes(table, schema) do
    Enum.flat_map(table.indexes, fn index ->
      index.columns
      |> Enum.with_index()
      |> Enum.map(fn {column, i} ->
        column_def = column_def(table, column.name)

        [
          table.name.schema,
          index.name,
          table.name.name,
          column.name,
          bool(index.unique),
          bool(false),
          i32(i),
          opclass(column_def),
          bool(true),
          "btree",
          to_string(column.ordering),
          bool(column.nulls_ordering == :FIRST),
          bool(nil),
          bool(nil)
        ]
      end)
    end) ++ table_constraints(table, schema)
  end

  defp table_constraints(table, _schema) do
    Enum.flat_map(table.constraints, fn
      %{constraint: {type, constraint}} when type in [:primary, :unique] ->
        constraint.keys
        |> Enum.with_index()
        |> Enum.map(fn {column_name, i} ->
          column_def = column_def(table, column_name)

          [
            table.name.schema,
            constraint.name,
            table.name.name,
            column_name,
            bool(true),
            bool(type == :primary),
            i32(i),
            opclass(column_def),
            bool(true),
            "btree",
            "ASC",
            bool(false),
            bool(constraint.deferrable),
            bool(constraint.initdeferred)
          ]
        end)

      _ ->
        []
    end)
  end

  defp column_def(table, column_name) do
    Enum.find(table.columns, &(&1.name == column_name)) ||
      raise "column #{column_name} not found in table #{table.name}"
  end

  @text_types Electric.Postgres.text_types()

  defp opclass(%{type: %{name: typename}}) do
    case typename do
      t when t in @text_types -> "text_ops"
      t -> "#{t}_ops"
    end
  end
end

defmodule Electric.Postgres.Proxy.Prisma.Query.FunctionV5_2 do
  @moduledoc """
  SELECT p.proname AS name, n.nspname as namespace,
  CASE WHEN l.lanname = 'internal' THEN p.prosrc
  ELSE pg_get_functiondef(p.oid)
  END as definition
  FROM pg_proc p
  LEFT JOIN pg_namespace n ON p.pronamespace = n.oid
  LEFT JOIN pg_language l ON p.prolang = l.oid
  WHERE n.nspname = ANY ( $1 )
  """
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    ["name", "namespace", "definition"]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "name", oid: 1255, attnum: 2, type: 19, typlen: 64),
      field(name: "namespace", oid: 2615, attnum: 2, type: 19, typlen: 64),
      field(name: "definition", type: 25)
    ]
  end

  # we don't support functions currently
  def data_rows([_nspname], _schema, _config) do
    []
  end
end

defmodule Electric.Postgres.Proxy.Prisma.Query.ExtensionV5_2 do
  @moduledoc """
  SELECT
  ext.extname AS extension_name,
  ext.extversion AS extension_version,
  ext.extrelocatable AS extension_relocatable,
  pn.nspname AS extension_schema
  FROM pg_extension ext
  INNER JOIN pg_namespace pn ON ext.extnamespace = pn.oid
  ORDER BY ext.extname ASC
  """
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    ["extension_name", "extension_version", "extension_relocatable", "extension_schema"]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    []
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "extension_name", oid: 3079, attnum: 2, type: 19, typlen: 64),
      field(name: "extension_version", oid: 3079, attnum: 6, type: 25),
      field(name: "extension_relocatable", oid: 3079, attnum: 5, type: 16, typlen: 1),
      field(name: "extension_schema", oid: 2615, attnum: 2, type: 19, typlen: 64)
    ]
  end

  # we don't support extensions
  def data_rows(_binds, _schema, _config) do
    []
  end
end

defmodule Electric.Postgres.Proxy.Prisma.Query.SequenceV5_2 do
  @moduledoc """
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
  @behaviour Electric.Postgres.Proxy.Prisma.Query

  import Electric.Postgres.Proxy.Prisma.Query

  def column_names() do
    [
      "sequence_name",
      "namespace",
      "",
      "min_value",
      "max_value",
      "increment_by",
      "cycle",
      "cache_size"
    ]
  end

  def parameter_description(config)
      when is_major_version(config, 14) or is_major_version(config, 15) do
    [1003]
  end

  def row_description(config) when is_major_version(config, 14) or is_major_version(config, 15) do
    [
      field(name: "sequence_name", oid: 13590, attnum: 3, type: 19, typlen: 64),
      field(name: "namespace", oid: 13590, attnum: 2, type: 19, typlen: 64),
      field(name: "start_value", type: 20, typlen: 8),
      field(name: "min_value", type: 20, typlen: 8),
      field(name: "max_value", type: 20, typlen: 8),
      field(name: "increment_by", type: 20, typlen: 8),
      field(name: "cycle", type: 16, typlen: 1),
      field(name: "cache_size", type: 20, typlen: 8)
    ]
  end

  # we don't support sequences, so this must be empty
  def data_rows([_nspname], _schema, _config) do
    []
  end
end
