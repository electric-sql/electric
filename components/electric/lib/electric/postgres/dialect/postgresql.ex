defmodule Electric.Postgres.Dialect.Postgresql do
  alias PgQuery, as: Pg

  alias Electric.Postgres
  alias Electric.Postgres.{Dialect, Schema, Schema.Proto}

  alias Electric.Postgres.Schema.Proto.{
    Constraint,
    Expression
  }

  require Logger

  import Electric.Postgres.Dialect.Builder

  @int_types Postgres.integer_types()
  @float_types Postgres.float_types()

  @behaviour Electric.Postgres.Dialect

  @type sql() :: Dialect.sql()

  @impl true
  def to_sql(stmt, opts \\ [])

  def to_sql(%Constraint{constraint: {_, %Constraint.Check{} = chk}}, opts) do
    stmt([
      if(Keyword.get(opts, :named_constraint, true),
        do: stmt(["CONSTRAINT", quote_name(chk.name)])
      ),
      "CHECK",
      expression(chk.expr) |> paren()
    ])
  end

  @spec expression(%Proto.Expression{} | nil) :: sql() | nil
  def expression(nil) do
    nil
  end

  def expression(%Expression{expr: {_, expr}}) do
    expression(expr)
  end

  def expression(%Expression.AExpr{} = expr) do
    stmt([
      expression(expr.left),
      expr.name,
      expression(expr.right)
    ])
    |> paren()
  end

  def expression(%Expression.BoolExpr{args: [left, right]} = expr) do
    stmt([
      expression(left),
      bool_op(expr.op),
      expression(right)
    ])
    |> paren()
  end

  def expression(%Expression.ColumnRef{name: name}) do
    quote_name(name)
  end

  def expression(%Expression.Const{value: value}) do
    expression(value)
  end

  def expression(%Expression.Function{} = f) do
    stmt([f.name, "(", stmt(Enum.map(f.args, &expression/1), ", "), ")"], "")
  end

  def expression(%Expression.ValueFunction{name: f}) do
    # https://www.postgresql.org/docs/15/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT
    f
  end

  def expression(%Expression.Cast{} = cast) do
    paren("CAST" <> paren(stmt([expression(cast.arg), "AS", map_type(cast.type)])))
  end

  def expression(%Expression.NullTest{} = null) do
    stmt([
      expression(null.arg),
      if(null.type == :IS, do: "IS"),
      if(null.type == :IS_NOT, do: "IS NOT"),
      "NULL"
    ])
  end

  def expression(%Expression.Value{type: type} = v)
      when type in @int_types or type in @float_types do
    v.value
  end

  def expression(%Expression.Value{type: :BOOLEAN} = v) do
    v.value
  end

  def expression(%Expression.Value{type: :STRING, value: v}) do
    "'" <> v <> "'"
  end

  def expression(%Expression.Value{type: type, value: v}) when type in [:INTEGER, :FLOAT] do
    v
  end

  @spec bool_op(atom()) :: sql()
  defp bool_op(:AND), do: "AND"
  defp bool_op(:OR), do: "OR"
  defp bool_op(:NOT), do: "NOT"

  def map_type(%Pg.TypeName{} = type) do
    type
    |> Schema.AST.map()
    |> map_type()
  end

  def map_type(%Proto.Column.Type{name: n, array: bounds, size: size}) do
    bounds =
      Enum.map(bounds, fn
        nil -> ""
        -1 -> "[]"
        n -> "[#{n}]"
      end)
      |> Enum.join("")

    "#{n}#{bounds}" <> sized(size)
  end

  defp sized([]), do: ""

  defp sized(s),
    do: IO.iodata_to_binary(["(", s |> Enum.map(&to_string/1) |> Enum.intersperse(", "), ")"])

  @impl true
  def type_name(%Proto.Column.Type{} = type, _opts \\ []) do
    map_type(type)
  end

  @impl true
  def table_name(name, opts \\ []) do
    if Keyword.get(opts, :quote, false) do
      quote_name(name)
    else
      unquoted_name(name)
    end
  end
end
