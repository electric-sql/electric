defmodule Electric.Postgres.Dialect.SQLite do
  @moduledoc """
  Functions
  """

  defmodule Error do
    defexception [:message]
  end

  alias PgQuery, as: Pg

  alias Electric.Postgres
  alias Electric.Postgres.{Dialect, Schema, Schema.Proto}

  alias Electric.Postgres.Schema.Proto.{
    Constraint,
    Expression
  }

  require Logger

  @behaviour Electric.Postgres.Dialect
  @indent "  "

  @types %{
    json: "TEXT_JSON",
    integer: "INTEGER",
    float: "REAL",
    text: "TEXT",
    blob: "BLOB"
  }

  @int_types Postgres.integer_types()
  @float_types Postgres.float_types()
  @text_types Postgres.text_types()
  @binary_types Postgres.binary_types()
  @datetime_types Postgres.datetime_types()
  @json_types Postgres.json_types()
  @bool_types Postgres.bool_types()
  @uuid_types Postgres.uuid_types()

  @impl true
  def to_sql(stmt, opts \\ [])

  def to_sql(%Pg.CreateStmt{} = stmt, opts) do
    %{if_not_exists: ine} = stmt
    pretty = Keyword.get(opts, :pretty, true)
    join = if pretty, do: ",\n", else: ","

    table = Schema.AST.map(stmt)

    defn =
      Enum.map(table.columns, &map_column(&1, :create_table)) ++
        Enum.map(table.constraints, &map_constraint(&1, :create_table))

    # in theory we want to declare all tables as 'STRICT', see:
    # https://www.sqlite.org/stricttables.html
    # basically it prevents e.g. insertion of a string into an integer column
    # but in reality this prevents us from adding useful type
    # annotations to the column types. i.e. we can't say `TEXT_JSON`, it
    # has to be `TEXT`...
    # TBD if this is actually something we can enable later but I think
    # we can allow the DAL to enforce types
    stmt(
      [
        stmt([
          "CREATE TABLE",
          if(ine, do: "IF NOT EXISTS"),
          quote_name(stmt.relation),
          "("
        ]),
        stmt(defn, join, pretty),
        ") WITHOUT ROWID;",
        ""
      ],
      if(pretty, do: "\n", else: "")
    )
  end

  def to_sql(%Pg.AlterTableStmt{} = stmt, opts) do
    %{missing_ok: missing_ok} = stmt
    table = %Proto.Table{name: Schema.AST.map(stmt.relation)}
    cmds = Enum.map(stmt.cmds, &alter_table_cmd(&1, table, opts))

    stmt([
      "ALTER TABLE",
      if(missing_ok, do: "IF EXISTS"),
      quote_name(stmt.relation),
      Enum.join(cmds, ",\n  ")
      # map_column(command.column, :add_column)
    ]) <> ";\n"
  end

  def to_sql(%Pg.IndexStmt{} = stmt, _opts) do
    %{if_not_exists: ine} = stmt
    index = Schema.AST.map(stmt)

    cols = Enum.map(index.columns, &index_column/1)
    where = expression(index.where)

    stmt([
      "CREATE",
      if(index.unique, do: "UNIQUE"),
      "INDEX",
      if(ine, do: "IF NOT EXISTS"),
      quote_name(index.name),
      "ON",
      quote_name(index.table),
      paren(stmt(cols, ", ")),
      if(where, do: "WHERE"),
      where
    ]) <> ";\n"
  end

  defp alter_table_cmd(%Pg.Node{node: {_, cmd}}, table, opts) do
    alter_table_cmd(cmd, table, opts)
  end

  defp alter_table_cmd(%Pg.AlterTableCmd{subtype: :AT_AddColumn} = cmd, table, opts) do
    %{def: %Pg.Node{node: {:column_def, %Pg.ColumnDef{} = coldef}}} = cmd

    constraints =
      Enum.map(coldef.constraints, &Schema.AST.constraint(&1, table, [coldef.colname], opts))

    stmt(
      [
        "ADD COLUMN",
        quote_name(coldef.colname),
        map_type(coldef.type_name),
        stmt(Enum.map(constraints, &map_constraint(&1, :add_column)))
      ],
      " "
    )
  end

  @type sql() :: Dialect.sql()
  @typep stmt() :: [binary() | sql() | nil]

  @spec stmt(stmt()) :: sql()
  defp stmt(list) do
    stmt(list, false)
  end

  @spec stmt(stmt(), binary) :: sql()
  defp stmt(list, join) when is_binary(join) do
    stmt(list, join, false)
  end

  @spec stmt(stmt(), boolean) :: sql()
  defp stmt(list, indent) when is_boolean(indent) do
    stmt(list, " ", indent)
  end

  @spec stmt(stmt(), binary(), boolean()) :: sql()
  defp stmt([], _join, _indent) do
    nil
  end

  defp stmt(list, join, indent) do
    list
    |> Enum.reject(&is_nil/1)
    |> indent(indent)
    |> Enum.join(join)
  end

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

  @spec quote_name(term()) :: sql()
  defp quote_name(%Proto.RangeVar{name: name}) do
    quote_name(name)
  end

  defp quote_name(%Pg.RangeVar{relname: name}) do
    quote_name(name)
  end

  defp quote_name(name) when is_binary(name) do
    ~s("#{name}")
  end

  @spec unquoted_name(Dialect.name()) :: sql()
  defp unquoted_name(%Proto.RangeVar{name: name}) do
    unquoted_name(name)
  end

  defp unquoted_name(%Pg.RangeVar{relname: name}) do
    unquoted_name(name)
  end

  defp unquoted_name(name) when is_binary(name) do
    name
  end

  defp map_column(%Proto.Column{} = col, mode) do
    stmt([
      quote_name(col.name),
      map_type(col.type),
      stmt(Enum.map(col.constraints, &map_constraint(&1, mode)))
    ])
  end

  defp map_constraint(%Constraint{constraint: {_, %Constraint.NotNull{}}}, _mode) do
    "NOT NULL"
  end

  defp map_constraint(%Constraint{constraint: {_, %Constraint.PrimaryKey{} = _pk}}, :add_column) do
    raise Error, message: "You cannot add a PRIMARY KEY column"
  end

  defp map_constraint(%Constraint{constraint: {_, %Constraint.PrimaryKey{} = pk}}, mode) do
    stmt([
      "CONSTRAINT",
      quote_name(pk.name),
      "PRIMARY KEY",
      if(mode == :create_table, do: column_list(pk.keys))
    ])
  end

  defp map_constraint(%Constraint{constraint: {_, %Constraint.ForeignKey{} = fk}}, mode) do
    stmt([
      "CONSTRAINT",
      quote_name(fk.name),
      if(mode == :create_table, do: "FOREIGN KEY"),
      if(mode == :create_table, do: column_list(fk.fk_cols)),
      "REFERENCES",
      quote_name(fk.pk_table),
      column_list(fk.pk_cols),
      on_behaviour("DELETE", fk.on_delete),
      on_behaviour("UPDATE", fk.on_update)
    ])
  end

  defp map_constraint(%Constraint{constraint: {_, %Constraint.Unique{}}}, :add_column) do
    raise Error, message: "You cannot add a column with a UNIQUE constraint"
  end

  defp map_constraint(%Constraint{constraint: {_, %Constraint.Unique{} = uniq}}, mode) do
    stmt([
      "CONSTRAINT",
      quote_name(uniq.name),
      "UNIQUE",
      if(mode == :create_table, do: column_list(uniq.keys))
    ])
  end

  defp map_constraint(%Constraint{constraint: {_, %Constraint.Check{} = chk}}, _mode) do
    stmt([
      "CONSTRAINT",
      quote_name(chk.name),
      "CHECK",
      expression(chk.expr) |> paren()
    ])
  end

  defp map_constraint(%Constraint{constraint: {_, %Constraint.Default{} = default}}, _mode) do
    stmt([
      "DEFAULT",
      expression(default.expr)
    ])
  end

  defp map_constraint(
         %Constraint{constraint: {_, %Constraint.Generated{when: :ALWAYS} = gen}},
         _mode
       ) do
    stmt([
      "GENERATED ALWAYS AS",
      expression(gen.expr),
      "STORED"
    ])
  end

  @spec on_behaviour(binary(), atom()) :: sql() | nil
  defp on_behaviour(trigger, behaviour) do
    action =
      case behaviour do
        :NO_ACTION -> nil
        :RESTRICT -> "RESTRICT"
        :CASCADE -> "CASCADE"
        :SET_NULL -> "SET NULL"
        :SET_DEFAULT -> "SET DEFAULT"
      end

    if action do
      stmt(["ON", trigger, action])
    end
  end

  @spec column_list(list()) :: sql()
  defp column_list(columns) do
    stmt(Enum.map(columns, &quote_name/1), ", ") |> paren()
  end

  @spec paren(sql() | nil) :: sql() | nil
  defp paren(nil), do: nil

  defp paren(stmt) when is_binary(stmt) do
    "(" <> stmt <> ")"
  end

  @spec indent([sql()] | sql() | nil, boolean) :: sql() | nil
  defp indent(nil, _) do
    nil
  end

  defp indent(lines, true) when is_list(lines) do
    Enum.map(lines, &indent(&1, true))
  end

  defp indent(sql, true) do
    @indent <> sql
  end

  defp indent(sql, false) do
    sql
  end

  # map all array types to json -- which requires mapping of the logical replication
  # representation to json
  @spec map_type(Dialect.column_type()) :: binary()

  def map_type(%Pg.TypeName{} = type) do
    type
    |> Schema.AST.map()
    |> map_type()
  end

  def map_type(%Proto.Column.Type{array: [_ | _]}) do
    @types[:json]
  end

  def map_type(%Proto.Column.Type{name: n, array: [], size: size}) do
    do_map_type(n, size)
  end

  @spec do_map_type(binary(), boolean()) :: binary()
  def do_map_type(serial, []) when serial in ["serial", "serial4", "serial8"] do
    # FIXME: we don't support serial columns, this is a temporary workaround
    Logger.warn(
      "Table has unsupported column of type `#{serial}` -- mapping to INTEGER but unhappily :("
    )

    @types[:integer]
  end

  def do_map_type(t, size) when t in @int_types do
    @types[:integer] <> sized(size)
  end

  def do_map_type(t, size) when t in @float_types do
    @types[:float] <> sized(size)
  end

  def do_map_type(t, size) when t in @text_types do
    @types[:text] <> sized(size)
  end

  def do_map_type(t, size) when t in @binary_types do
    @types[:blob] <> sized(size)
  end

  def do_map_type(t, size) when t in @datetime_types do
    @types[:text] <> sized(size)
  end

  def do_map_type(t, size) when t in @json_types do
    @types[:json] <> sized(size)
  end

  def do_map_type(t, size) when t in @bool_types do
    @types[:integer] <> sized(size)
  end

  # UUID
  # binary or string? no right answer unless db filesize is your only metric,
  # in which case binary wins hands down
  # https://stackoverflow.com/questions/11337324/how-to-efficient-insert-and-fetch-uuid-in-core-data/11337522#11337522
  # TODO: allow for some override map pg_type => choice of sqlite type
  def do_map_type(t, size) when t in @uuid_types do
    @types[:blob] <> sized(size)
  end

  defp sized([]), do: ""

  defp sized(s),
    do: IO.iodata_to_binary(["(", s |> Enum.map(&to_string/1) |> Enum.intersperse(", "), ")"])

  @spec expression(%Proto.Expression{} | nil) :: sql() | nil
  defp expression(nil) do
    nil
  end

  defp expression(%Expression{expr: {_, expr}}) do
    expression(expr)
  end

  defp expression(%Expression.AExpr{} = expr) do
    stmt([
      expression(expr.left),
      expr.name,
      expression(expr.right)
    ])
    |> paren()
  end

  defp expression(%Expression.BoolExpr{args: [left, right]} = expr) do
    stmt([
      expression(left),
      bool_op(expr.op),
      expression(right)
    ])
    |> paren()
  end

  defp expression(%Expression.ColumnRef{name: name}) do
    quote_name(name)
  end

  defp expression(%Expression.Const{value: value}) do
    expression(value)
  end

  # sqlite doesn't have the string concat function, replace with a bunch of ||
  # using coalesce to remove nulls
  defp expression(%Expression.Function{name: "concat"} = f) do
    f.args
    |> Enum.map(&stmt(["coalesce(", expression(&1), ", '')"], ""))
    |> Enum.join(" || ")
    |> paren()
  end

  defp expression(%Expression.Function{} = f) do
    # TODO: check that we support the function and map pg functions to equivalent sqlite ones
    stmt([f.name, paren(stmt(Enum.map(f.args, &expression/1), ", "))], "")
  end

  defp expression(%Expression.ValueFunction{name: f}) do
    # https://www.sqlite.org/lang_createtable.html#the_default_clause
    # https://www.postgresql.org/docs/15/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT
    case f do
      t when t in ["CURRENT_TIMESTAMP", "LOCALTIMESTAMP"] -> "current_timestamp"
      t when t in ["CURRENT_DATE"] -> "current_date"
      t when t in ["CURRENT_TIME", "LOCALTIME"] -> "current_time"
    end
  end

  defp expression(%Expression.Cast{} = cast) do
    paren("CAST" <> paren(stmt([expression(cast.arg), "AS", map_type(cast.type)])))
  end

  defp expression(%Expression.NullTest{} = null) do
    stmt([
      expression(null.arg),
      if(null.type == :IS, do: "IS"),
      if(null.type == :IS_NOT, do: "IS NOT"),
      "NULL"
    ])
  end

  defp expression(%Expression.Value{type: type} = v)
       when type in @int_types or type in @float_types do
    v.value
  end

  defp expression(%Expression.Value{type: :BOOLEAN} = v) do
    if v.value == "true", do: "1", else: "0"
  end

  defp expression(%Expression.Value{type: :STRING, value: "\\x" <> hex}) do
    "x'" <> hex <> "'"
  end

  # defp expression(%Expression.Value{type: :STRING, value: nil}) do
  #   "''"
  # end

  defp expression(%Expression.Value{type: :STRING, value: v}) do
    "'" <> v <> "'"
  end

  defp expression(%Expression.Value{type: type, value: v}) when type in [:INTEGER, :FLOAT] do
    v
  end

  @spec bool_op(atom()) :: sql()
  defp bool_op(:AND), do: "AND"
  defp bool_op(:OR), do: "OR"
  defp bool_op(:NOT), do: "NOT"

  defp index_column(%Proto.Index.Column{name: nil} = col) do
    stmt([
      expression(col.expr),
      to_string(col.ordering)
    ])
  end

  defp index_column(%Proto.Index.Column{} = col) do
    stmt([
      quote_name(col.name),
      to_string(col.ordering)
    ])
  end
end
