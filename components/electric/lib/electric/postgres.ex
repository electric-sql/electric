defmodule Electric.Postgres do
  alias PgQuery

  @type name() :: String.t()
  @type xid() :: non_neg_integer()
  @type oid() :: non_neg_integer()
  @type relation() :: {name(), name()}
  @type pk() :: binary()

  @spec parse!(String.t()) :: [struct()] | no_return()
  def parse!(stmts) when is_list(stmts) do
    Enum.flat_map(stmts, &parse!/1)
  end

  def parse!(sql) do
    sql
    |> PgQuery.parse!()
    |> map_stmts()
    |> normalise_stmts()
  end

  # TODO: this is wrong. see [VAX-1828]
  # because of the way we handle alter table statements, the locations generated here will fail
  # when given an alter table statment with multiple clauses.
  def parse_with_locations!(sql) when is_binary(sql) do
    sql
    |> ensure_semicolon()
    |> PgQuery.parse!()
    |> map_stmts_with_location()
    |> normalise_stmts()
  end

  # without a semi-colon, location and length are both 0 for single statement sql
  defp ensure_semicolon(sql) when is_binary(sql) do
    stmt = String.trim_trailing(sql)
    if String.ends_with?(stmt, ";"), do: stmt, else: stmt <> ";"
  end

  defp map_stmts(%PgQuery.ParseResult{stmts: stmts}) do
    Enum.map(stmts, fn %PgQuery.RawStmt{stmt: %PgQuery.Node{node: {_type, struct}}} ->
      struct
    end)
  end

  defp map_stmts_with_location(%PgQuery.ParseResult{stmts: stmts}) do
    Enum.map(stmts, fn %PgQuery.RawStmt{} = raw ->
      %{stmt: %PgQuery.Node{node: {_type, struct}}, stmt_location: location, stmt_len: len} = raw
      {struct, location, len}
    end)
  end

  defp normalise_stmts(stmts) do
    Enum.flat_map(stmts, &normalise_stmt/1)
  end

  # expand a multi-clause alter table statement into multiple
  # single clause alter table statements
  defp normalise_stmt(%PgQuery.AlterTableStmt{} = stmt) do
    Enum.map(stmt.cmds, &%{stmt | cmds: [&1]})
  end

  # TODO: this is wrong. see [VAX-1828]
  defp normalise_stmt({%PgQuery.AlterTableStmt{} = stmt, location, len}) do
    Enum.map(stmt.cmds, &{%{stmt | cmds: [&1]}, location, len})
  end

  defp normalise_stmt(stmt) do
    [stmt]
  end

  # these are pg column types
  @int_types ["smallint", "int2", "integer", "int", "int4", "bigint", "int8"]
  @serial_types ["smallserial", "serial2", "serial", "serial4", "bigserial", "serial8"]
  @arbitrary_precision_types [
    "decimal",
    "numeric"
  ]
  @float_types [
    "real",
    "float",
    "float4",
    "double precision",
    "float8"
  ]
  @decimal_types @arbitrary_precision_types ++ @float_types ++ ["money"]
  @varchar_types ["character varying", "varchar"]
  @character_types ["character", "char", "bpchar"]
  @text_types @varchar_types ++ @character_types ++ ["text"]
  @binary_types ["bytea"]
  @date_types ["date"]
  @time_types ["timetz", "time", "time without time zone", "time with time zone"]
  @timestamp_types [
    "timestamptz",
    "timestamp",
    "timestamp without time zone",
    "timestamp with time zone"
  ]
  @bool_types ["boolean", "bool"]
  @json_types ["json", "jsonb"]
  @uuid_types ["uuid"]
  @interval_types ["interval"]

  @all_types @int_types ++
               @float_types ++
               @text_types ++
               @binary_types ++
               @date_types ++
               @time_types ++
               @timestamp_types ++
               @bool_types ++
               @json_types ++
               @uuid_types ++
               @interval_types

  @supported_types @int_types ++
                     @float_types ++
                     @bool_types ++
                     @binary_types ++
                     @date_types ++
                     (@json_types -- ["json"]) ++
                     (@time_types -- ["timetz", "time with time zone"]) ++
                     @timestamp_types ++
                     @uuid_types ++
                     (@text_types -- @character_types)

  @supported_types_read_only @supported_types ++ @serial_types

  @supported_pk_types @text_types ++ @binary_types ++ @uuid_types

  # TODO: support enum types in the ast parsing -- they will just come through as text
  # I expect. an enum column comes with an associated "CREATE TYPE $type AS ENUM ('value1', 'value2')"
  # which we can just ignore probably

  def integer_types, do: @int_types
  def arbitrary_precision_types, do: @arbitrary_precision_types
  def float_types, do: @float_types
  def decimal_types, do: @decimal_types
  def varchar_types, do: @varchar_types
  def text_types, do: @text_types
  def binary_types, do: @binary_types
  def datetime_types, do: @date_types ++ @time_types ++ @timestamp_types
  def timestamp_types, do: @timestamp_types
  def json_types, do: @json_types
  def bool_types, do: @bool_types
  def uuid_types, do: @uuid_types
  def all_types, do: @all_types

  # this includes the "base" types and their aliases, so, e.g. `int8` and `bigint`
  def supported_types, do: @supported_types
  def supported_types_read_only, do: @supported_types_read_only
  def supported_types_only_in_functions, do: @interval_types
  def supported_pk_types, do: @supported_pk_types

  @display_settings [
    "SET bytea_output = 'hex'",
    "SET DateStyle = 'ISO, DMY'",
    "SET TimeZone = 'UTC'",
    "SET extra_float_digits = 1"
  ]

  @doc """
  Configuration settings that affect formatting of values of certain types.

  These settings should be set for the current session before executing any queries or
  statements to safe-guard against non-standard configuration being used in the Postgres
  database cluster or even the specific database Electric is configured to connect to.

  The settings Electric is sensitive to are:

    * `bytea_output`       - determines how Postgres encodes bytea values. It can use either Hex- or
                             Escape-based encoding.

    * `DateStyle`          - determines how Postgres interprets date values.

    * `TimeZone`           - affects the time zone offset Postgres uses for timestamptz and timetz values.

    * `extra_float_digits` - determines whether floating-point values are rounded or are encoded precisely.
  """
  @spec display_settings :: [String.t()]
  def display_settings, do: @display_settings
end
