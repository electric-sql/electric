defmodule Electric.Postgres do
  alias PgQuery

  @type name() :: String.t()
  @type oid() :: non_neg_integer()

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

  defp map_stmts(%PgQuery.ParseResult{stmts: stmts}) do
    Enum.map(stmts, fn %PgQuery.RawStmt{stmt: %PgQuery.Node{node: {_type, struct}}} ->
      struct
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

  defp normalise_stmt(stmt) do
    [stmt]
  end

  # these are pg column types
  @int_types ["smallint", "int2", "integer", "int", "int4", "bigint", "int8"]
  @arbitrary_precision_types [
    "decimal",
    "numeric"
  ]
  @float_types @arbitrary_precision_types ++
                 [
                   "real",
                   "float",
                   "float4",
                   "double precision",
                   "float8",
                   "money"
                 ]
  @text_types ["character varying", "varchar", "character", "char", "text", "bpchar"]
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

  # TODO: support enum types in the ast parsing -- they will just come through as text
  # I expect. an enum column comes with an associated "CREATE TYPE $type AS ENUM ('value1', 'value2')"
  # which we can just ignore probably

  def integer_types, do: @int_types
  def arbitrary_precision_types, do: @arbitrary_precision_types
  def float_types, do: @float_types
  def text_types, do: @text_types
  def binary_types, do: @binary_types
  def datetime_types, do: @date_types ++ @time_types ++ @timestamp_types
  def timestamp_types, do: @timestamp_types
  def json_types, do: @json_types
  def bool_types, do: @bool_types
  def uuid_types, do: @uuid_types

  def supported_types do
    ~w[
      bool
      bytea
      date
      float4 float8
      int2 int4 int8
      jsonb
      text
      time
      timestamp timestamptz
      uuid
      varchar
    ]a
  end

  def supported_types_only_in_functions, do: ~w|interval|a

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
