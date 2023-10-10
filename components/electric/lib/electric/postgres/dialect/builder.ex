defmodule Electric.Postgres.Dialect.Builder do
  alias Electric.Postgres.Schema.Proto
  alias PgQuery, as: Pg
  alias Electric.Postgres.Dialect

  @type stmt() :: [binary() | sql() | nil]
  @type sql() :: Dialect.sql()

  @indent "  "

  @spec stmt(stmt()) :: sql()
  def stmt(list) do
    stmt(list, false)
  end

  @spec stmt(stmt(), binary) :: sql()
  def stmt(list, join) when is_binary(join) do
    stmt(list, join, false)
  end

  @spec stmt(stmt(), boolean) :: sql()
  def stmt(list, indent) when is_boolean(indent) do
    stmt(list, " ", indent)
  end

  @spec stmt(stmt(), binary(), boolean()) :: sql()
  def stmt([], _join, _indent) do
    nil
  end

  def stmt(list, join, indent) do
    list
    |> Enum.reject(&is_nil/1)
    |> indent(indent)
    |> Enum.join(join)
  end

  @spec indent([sql()] | sql() | nil, boolean) :: sql() | nil
  def indent(nil, _) do
    nil
  end

  def indent(lines, true) when is_list(lines) do
    Enum.map(lines, &indent(&1, true))
  end

  def indent(sql, true) do
    @indent <> sql
  end

  def indent(sql, false) do
    sql
  end

  @spec paren(sql() | nil) :: sql() | nil
  def paren(nil), do: nil

  def paren(stmt) when is_binary(stmt) do
    "(" <> stmt <> ")"
  end

  @spec column_list(list()) :: sql()
  def column_list(columns) do
    stmt(Enum.map(columns, &quote_name/1), ", ") |> paren()
  end

  @spec quote_name(term()) :: sql()
  def quote_name(%Proto.RangeVar{name: name}) do
    quote_name(name)
  end

  def quote_name(%PgQuery.RangeVar{relname: name}) do
    quote_name(name)
  end

  def quote_name(name) when is_binary(name) do
    ~s("#{name}")
  end

  @spec unquoted_name(Dialect.name()) :: sql()
  def unquoted_name(%Proto.RangeVar{name: name}) do
    unquoted_name(name)
  end

  def unquoted_name(%Pg.RangeVar{relname: name}) do
    unquoted_name(name)
  end

  def unquoted_name(name) when is_binary(name) do
    name
  end
end
