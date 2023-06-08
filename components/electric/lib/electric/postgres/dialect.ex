defmodule Electric.Postgres.Dialect do
  alias PgQuery, as: Pg
  alias Electric.Postgres.Schema.Proto

  @type pg_query() :: struct()
  @type column_type() :: %Proto.Column.Type{}
  @type range_var() :: %Pg.RangeVar{} | %Proto.RangeVar{}
  @type sql() :: binary()
  @type t() :: module()
  @type name() :: range_var()
  @type base_type() :: binary()

  @callback table_name(name()) :: binary() | no_return()
  @callback to_sql(pg_query(), Keyword.t()) :: sql() | no_return()
  @callback type_name(column_type()) :: sql() | no_return()

  @spec to_sql(pg_query() | String.t(), t(), Keyword.t()) :: sql() | no_return()
  def to_sql(model, dialect, opts \\ [])

  def to_sql(stmt, dialect, opts) when is_binary(stmt) do
    stmt
    |> Electric.Postgres.parse!()
    |> to_sql(dialect, opts)
  end

  def to_sql(model, dialect, opts) do
    dialect.to_sql(model, opts)
  end

  @spec table_name(name(), t(), Keyword.t()) :: sql | no_return
  def table_name(name, dialect, opts \\ []) do
    dialect.table_name(name, opts)
  end

  @spec type_name(column_type(), t(), Keyword.t()) :: sql | no_return
  def type_name(type, dialect, opts \\ []) do
    dialect.type_name(type, opts)
  end
end
