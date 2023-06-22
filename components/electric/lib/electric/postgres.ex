defmodule Electric.Postgres do
  alias PgQuery
  alias __MODULE__

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
  @float_types [
    "decimal",
    "numeric",
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
  def float_types, do: @float_types
  def text_types, do: @text_types
  def binary_types, do: @binary_types
  def datetime_types, do: @date_types ++ @time_types ++ @timestamp_types
  def timestamp_types, do: @timestamp_types
  def json_types, do: @json_types
  def bool_types, do: @bool_types
  def uuid_types, do: @uuid_types

  @type name() :: String.t()
  @type oid() :: non_neg_integer()

  defmodule Column do
    defstruct [
      :name,
      :type,
      type_modifier: -1,
      part_of_identity?: false
    ]

    @type t() :: %__MODULE__{
            name: Postgres.name(),
            type: binary(),
            type_modifier: integer(),
            part_of_identity?: boolean() | nil
          }
  end

  defmodule Table do
    defstruct [
      :schema,
      :name,
      :oid,
      primary_keys: [],
      replica_identity: :index,
      columns: []
    ]

    @type t() :: %__MODULE__{
            schema: Postgres.name(),
            name: Postgres.name(),
            oid: Postgres.oid(),
            primary_keys: [Postgres.name()],
            replica_identity: :all_columns | :default | :nothing | :index,
            columns: [Postgres.Column.t()]
          }
  end
end
