defmodule Electric.Postgres.Schema.AST do
  alias PgQuery, as: Pg
  alias Electric.Postgres.{Schema, Schema.AST, Schema.Proto}

  @default_schema "public"

  def create(%Pg.CreateStmt{} = action) do
    map(action)
  end

  defp create_table(%{node: {:column_def, _}} = node, table) do
    add_column(node, table)
  end

  # table constraint definition
  defp create_table(%{node: {:constraint, con}}, table) do
    case con do
      %{contype: :CONSTR_PRIMARY} = pk ->
        %{constraint: {:primary, pk}} = constraint = constraint(pk, table)

        Enum.reduce(pk.keys, table, fn col_name, table ->
          Schema.Update.update_column(
            table,
            col_name,
            &Schema.Update.ensure_not_null_constraint/1
          )
        end)
        |> cappend(constraint)

      con ->
        cappend(table, constraint(con, table))
    end
  end

  def constraint(condef, table, keys \\ [])

  def constraint(%Pg.Node{node: {:constraint, constraint}}, table, keys) do
    constraint(constraint, table, keys)
  end

  def constraint(%{contype: :CONSTR_CHECK} = chk, table, _keys) do
    # TODO: use the catalog protocol to get the keys from the chk expression
    # _keys = constraint_keys(pk.keys, keys)
    %Proto.Constraint{
      constraint:
        {:check,
         %Proto.Constraint.Check{
           name: Schema.constraint_name(chk.conname, table.name.name, [], "check"),
           deferrable: chk.deferrable,
           initdeferred: chk.initdeferred,
           expr: AST.map(chk.raw_expr)
         }}
    }
  end

  def constraint(%{contype: :CONSTR_PRIMARY} = pk, table, keys) do
    keys = constraint_keys(pk.keys, keys)
    name = Schema.constraint_name(blank(pk.conname) || pk.indexname, table.name.name, [], "pkey")

    %Proto.Constraint{
      constraint:
        {:primary,
         %Proto.Constraint.PrimaryKey{
           name: name,
           keys: keys,
           including: Enum.map(pk.including, &map/1),
           deferrable: pk.deferrable,
           initdeferred: pk.initdeferred
         }}
    }
  end

  def constraint(%{contype: :CONSTR_UNIQUE} = uniq, table, keys) do
    keys = constraint_keys(uniq.keys, keys)
    including = Enum.map(uniq.including, &map/1)
    name = Schema.constraint_name(uniq.conname, table.name.name, keys ++ including, "key")

    %Proto.Constraint{
      constraint:
        {:unique,
         %Proto.Constraint.Unique{
           name: name,
           keys: keys,
           including: including,
           deferrable: uniq.deferrable,
           initdeferred: uniq.initdeferred
         }}
    }
  end

  def constraint(%{contype: :CONSTR_FOREIGN} = fk, table, keys) do
    keys = constraint_keys(fk.fk_attrs, keys)

    name = Schema.constraint_name(fk.conname, table.name.name, keys, "fkey")

    %Proto.Constraint{
      constraint:
        {:foreign,
         %Proto.Constraint.ForeignKey{
           name: name,
           fk_cols: keys,
           pk_table: map(fk.pktable),
           pk_cols: map(fk.pk_attrs),
           deferrable: fk.deferrable,
           initdeferred: fk.initdeferred,
           match_type: map_fk_match(fk.fk_matchtype),
           on_update: map_fk_action(fk.fk_upd_action),
           on_delete: map_fk_action(fk.fk_del_action)
         }}
    }
  end

  def constraint(%{contype: :CONSTR_GENERATED} = gen, _table, _keys) do
    %Proto.Constraint{
      constraint:
        {:generated,
         %Proto.Constraint.Generated{
           name: gen.conname,
           when:
             case gen.generated_when do
               "a" -> :ALWAYS
             end,
           expr: map(gen.raw_expr)
         }}
    }
  end

  def constraint(%{contype: :CONSTR_NOTNULL} = nn, _table, _keys) do
    %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{name: blank(nn.conname)}}}
  end

  def constraint(%{contype: :CONSTR_NULL}, _table, _keys) do
    nil
  end

  def constraint(%{contype: :CONSTR_DEFAULT} = default, _table, _keys) do
    %Proto.Constraint{
      constraint: {:default, %Proto.Constraint.Default{expr: map(default.raw_expr)}}
    }
  end

  defp constraint_keys(conkeys, colkeys) do
    case {conkeys, colkeys} do
      {[], [_ | _]} -> colkeys
      {[_ | _], _} -> map(conkeys)
      {[], []} -> []
    end
  end

  defp cappend(obj, nil) do
    obj
  end

  defp cappend(obj, constraint) do
    %{obj | constraints: Schema.order(obj.constraints ++ [constraint])}
  end

  def add_column(%{node: {:column_def, %Pg.ColumnDef{} = coldef}}, table, opts \\ []) do
    if opts[:if_not_exists] && Enum.any?(table.columns, &Schema.equal?(&1.name, coldef.colname)) do
      table
    else
      do_add_column(coldef, table)
    end
  end

  defp do_add_column(coldef, table) do
    column = %Proto.Column{
      name: coldef.colname,
      type: map(coldef.type_name),
      constraints: []
    }

    {table, column} = Enum.reduce(coldef.constraints, {table, column}, &map_column_constraints/2)

    %{table | columns: table.columns ++ [column]}
  end

  defp map_column_constraints(%{node: {:constraint, con}}, {table, column}) do
    constraint = constraint(con, table, [column.name])

    case con.contype do
      :CONSTR_NULL ->
        {table, column}

      col_con when col_con in [:CONSTR_NOTNULL] ->
        {table, Schema.Update.ensure_not_null_constraint(column, constraint)}

      col_con when col_con in [:CONSTR_DEFAULT, :CONSTR_NOTNULL, :CONSTR_GENERATED] ->
        {table, cappend(column, constraint)}

      tab_con when tab_con in [:CONSTR_CHECK, :CONSTR_FOREIGN, :CONSTR_UNIQUE] ->
        {cappend(table, constraint), column}

      :CONSTR_PRIMARY ->
        {cappend(table, constraint), Schema.Update.ensure_not_null_constraint(column)}
    end
  end

  defp optional_string("") do
    nil
  end

  defp optional_string(s) when is_binary(s) do
    s
  end

  defp optional(nil) do
    nil
  end

  def map([]), do: []

  def map([_ | _] = nodes) do
    Enum.map(nodes, &map/1)
  end

  def map(nil), do: nil

  def map(%Pg.CreateStmt{} = action) do
    name = map(action.relation)

    Enum.reduce(
      action.table_elts,
      %Proto.Table{name: name, columns: [], constraints: []},
      &create_table/2
    )
  end

  def map(%Pg.IndexStmt{} = stmt) do
    index_columns = map(stmt.index_params)
    index_including = map(stmt.index_including_params)

    %Proto.Index{
      name: stmt.idxname,
      table: map(stmt.relation),
      unique: stmt.unique,
      columns: index_columns,
      including: Enum.map(index_including, & &1.name),
      where: AST.map(stmt.where_clause),
      using: stmt.access_method
    }
  end

  def map(%Pg.RangeVar{} = rangevar) do
    %Proto.RangeVar{
      name: rangevar.relname,
      schema: optional_string(rangevar.schemaname) || @default_schema,
      alias: optional(rangevar.alias)
    }
  end

  def map(%Pg.Node{node: {:a_expr, aexpr}}) do
    # assert that the expression has a single name
    [name] = aexpr.name

    %Proto.Expression{
      expr:
        {:aexpr,
         %Proto.Expression.AExpr{
           name: map(name),
           left: map(aexpr.lexpr),
           right: map(aexpr.rexpr)
         }}
    }
  end

  def map(%Pg.Node{node: {:bool_expr, bool_expr}}) do
    %Proto.Expression{
      expr:
        {:bool_expr,
         %Proto.Expression.BoolExpr{
           op:
             case bool_expr.boolop do
               :AND_EXPR -> :AND
               :OR_EXPR -> :OR
               :NOT_EXPR -> :NOT
             end,
           args: map(bool_expr.args)
         }}
    }
  end

  def map(%Pg.Node{node: {:a_const, aconst}}) do
    %Proto.Expression{expr: {:const, %Proto.Expression.Const{value: map(aconst.val)}}}
  end

  def map(%Pg.Node{node: {:type_cast, cast}}) do
    %Proto.Expression{
      expr: {:cast, %Proto.Expression.Cast{type: map(cast.type_name), arg: map(cast.arg)}}
    }
  end

  def map({:sval, %Pg.String{sval: sval}}) do
    %Proto.Expression.Value{type: :STRING, value: sval}
  end

  def map({:ival, %Pg.Integer{ival: val}}) do
    %Proto.Expression.Value{type: :INTEGER, value: to_string(val)}
  end

  def map({:fval, %Pg.Float{fval: val}}) do
    %Proto.Expression.Value{type: :FLOAT, value: to_string(val)}
  end

  def map({:boolval, %Pg.Boolean{boolval: b}}) do
    %Proto.Expression.Value{type: :BOOLEAN, value: to_string(b)}
  end

  def map(%{node: {:column_ref, %Pg.ColumnRef{} = colref}}) do
    case colref do
      %{fields: [node]} ->
        %Proto.Expression{expr: {:col_ref, %Proto.Expression.ColumnRef{name: map(node)}}}
    end
  end

  def map(%{node: {:sqlvalue_function, %Pg.SQLValueFunction{op: op} = _vfun}}) do
    # pgquery/c_src/libpg_query/src/pg_query_deparse.c:3190
    # TODO: tests for handling args to these value functions
    fun =
      case op do
        :SVFOP_CURRENT_DATE ->
          %Proto.Expression.ValueFunction{name: "CURRENT_DATE"}

        :SVFOP_CURRENT_TIME ->
          %Proto.Expression.ValueFunction{name: "CURRENT_TIME"}

        :SVFOP_CURRENT_TIME_N ->
          %Proto.Expression.ValueFunction{name: "CURRENT_TIME"}

        :SVFOP_CURRENT_TIMESTAMP ->
          %Proto.Expression.ValueFunction{name: "CURRENT_TIMESTAMP"}

        :SVFOP_CURRENT_TIMESTAMP_N ->
          %Proto.Expression.ValueFunction{name: "CURRENT_TIMESTAMP"}

        :SVFOP_LOCALTIME ->
          %Proto.Expression.ValueFunction{name: "LOCALTIME"}

        :SVFOP_LOCALTIME_N ->
          %Proto.Expression.ValueFunction{name: "LOCALTIME"}

        :SVFOP_LOCALTIMESTAMP ->
          %Proto.Expression.ValueFunction{name: "LOCALTIMESTAMP"}

        :SVFOP_LOCALTIMESTAMP_N ->
          %Proto.Expression.ValueFunction{name: "LOCALTIMESTAMP"}

        # :SVFOP_CURRENT_ROLE
        # :SVFOP_CURRENT_USER
        # :SVFOP_USER
        # :SVFOP_SESSION_USER
        # :SVFOP_CURRENT_CATALOG
        # :SVFOP_CURRENT_SCHEMA
        other ->
          raise "unsupported value function #{other}"
      end

    %Proto.Expression{expr: {:vfunction, fun}}
  end

  def map(%{node: {:string, %Pg.String{sval: sval}}}) do
    sval
  end

  def map(%{node: {:list, %{items: items}}}) do
    Enum.map(items, &map/1)
  end

  def map(%{node: {:index_elem, elem}}) do
    ordering =
      case elem.ordering do
        :SORTBY_DEFAULT -> :ASC
        :SORTBY_ASC -> :ASC
        :SORTBY_DESC -> :DESC
      end

    nulls_ordering =
      case elem.nulls_ordering do
        :SORTBY_NULLS_DEFAULT ->
          case ordering do
            :DESC -> :FIRST
            _ -> :LAST
          end

        :SORTBY_NULLS_FIRST ->
          :FIRST

        :SORTBY_NULLS_LAST ->
          :LAST
      end

    %Proto.Index.Column{
      name: blank(elem.name),
      collation:
        case elem.collation do
          [collation | _] -> map(collation)
          [] -> nil
        end,
      expr: map(elem.expr),
      ordering: ordering,
      nulls_ordering: nulls_ordering
    }
  end

  def map(%{node: {:func_call, func_call}}) do
    name = map(func_call.funcname) |> remove_pg_catalog()

    func = %Proto.Expression.Function{
      name: name,
      args: map(func_call.args)
    }

    %Proto.Expression{expr: {:function, func}}
  end

  def map(%{node: {:null_test, %Pg.NullTest{} = nulltest}}) do
    %Proto.Expression{
      expr:
        {:null_test,
         %Proto.Expression.NullTest{
           arg: map(nulltest.arg),
           type:
             case nulltest.nulltesttype do
               :IS_NULL -> :IS
               :IS_NOT_NULL -> :IS_NOT
             end,
           isrow: nulltest.argisrow
         }}
    }
  end

  def map(%Pg.TypeName{} = type) do
    %Proto.Column.Type{
      name: map_col_type_name(type.names),
      size: map_col_size(type.typmods),
      array: map_col_array(type.array_bounds)
    }
  end

  defp remove_pg_catalog(["pg_catalog", e]) do
    e
  end

  defp remove_pg_catalog([e]) do
    e
  end

  defp map_fk_action(a) do
    case a do
      "a" -> :NO_ACTION
      "r" -> :RESTRICT
      "c" -> :CASCADE
      "n" -> :SET_NULL
      "d" -> :SET_DEFAULT
    end
  end

  defp map_fk_match(m) do
    case m do
      "f" -> :FULL
      "p" -> :PARTIAL
      "s" -> :SIMPLE
    end
  end

  defp map_col_type_name([%{node: {:string, %{sval: "pg_catalog"}}}, node]) do
    map_col_type_name([node])
  end

  defp map_col_type_name([%{node: {:string, %{sval: name}}}]) do
    name
  end

  defp map_col_size([]) do
    []
  end

  defp map_col_size([%Pg.Node{node: {:a_const, %{val: val}}} | rest]) do
    [map_value(val) | map_col_size(rest)]
  end

  defp map_col_array([]) do
    []
  end

  defp map_col_array([%{node: {:integer, %{ival: bound}}} | rest]) do
    [bound | map_col_array(rest)]
  end

  defp map_value({:ival, %PgQuery.Integer{ival: ival}}) do
    ival
  end

  defp blank(nil), do: nil
  defp blank(""), do: nil
  defp blank(s) when is_binary(s), do: s
end
