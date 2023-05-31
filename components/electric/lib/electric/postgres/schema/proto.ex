defmodule Electric.Postgres.Schema.Proto do
  def range_var([relname]) do
    %__MODULE__.RangeVar{name: relname}
  end

  def range_var([schemaname, relname]) do
    %__MODULE__.RangeVar{name: relname, schema: schemaname}
  end

  def rename(%__MODULE__.RangeVar{} = var, new_name) do
    %{var | name: new_name}
  end

  defguard is_unique_constraint(m)
           when is_struct(m, __MODULE__.Constraint) and
                  elem(m.constraint, 0) in [:unique, :primary]
end

defimpl String.Chars, for: Electric.Postgres.Schema.Proto.RangeVar do
  def to_string(%{schema: schema, name: name}) do
    [schema, name]
    |> Stream.reject(&is_nil/1)
    |> Stream.map(&~s("#{&1}"))
    |> Enum.join(".")
  end
end

defimpl String.Chars, for: PgQuery.RangeVar do
  def to_string(%{schemaname: schema, relname: name}) do
    [schema, name]
    |> Stream.reject(fn n -> n in [nil, ""] end)
    |> Stream.map(&~s("#{&1}"))
    |> Enum.join(".")
  end
end

alias Electric.Postgres.{Schema, Schema.Proto, Schema.Catalog}

defmodule Catalog.Constraint do
  def rename_col(constraint, keys, oldname, newname) do
    Enum.reduce(keys, constraint, fn k, constraint ->
      Map.update!(constraint, k, fn
        nil ->
          nil

        keys when is_list(keys) ->
          Enum.map(keys, fn k ->
            if k == oldname, do: newname, else: k
          end)
      end)
    end)
  end
end

defimpl Catalog, for: Proto.Expression do
  def rename_column(%{expr: expr} = e, oldname, newname) do
    %{e | expr: Catalog.rename_column(expr, oldname, newname)}
  end

  def rename_column(%{expr: expr} = e, table_name, oldname, newname) do
    %{e | expr: Catalog.rename_column(expr, table_name, oldname, newname)}
  end

  def rename_table(%{expr: expr} = e, oldname, newname) do
    %{e | expr: Catalog.rename_table(expr, oldname, newname)}
  end

  def depends_on_column?(%{expr: {_, expr}}, name) do
    Catalog.depends_on_column?(expr, name)
  end

  def depends_on_column?(%{expr: {_, expr}}, table_name, column_name) do
    Catalog.depends_on_column?(expr, table_name, column_name)
  end

  def depends_on_table?(%{expr: {_, expr}}, table_name) do
    Catalog.depends_on_table?(expr, table_name)
  end

  def depends_on_constraint?(%{expr: {_, expr}}, table_name, columns) do
    Catalog.depends_on_constraint?(expr, table_name, columns)
  end

  def keys(%{expr: {_, expr}}) do
    Catalog.keys(expr)
  end
end

defimpl Catalog, for: Proto.Expression.Function do
  def rename_column(f, oldname, newname) do
    %{f | args: Enum.map(f.args, &Catalog.rename_column(&1, oldname, newname))}
  end

  # would need to verify this but for the moment I think we can just assume
  # that all function invocations only reference columns of the current table
  def rename_column(f, _table_name, _oldname, _newname), do: f
  def rename_table(f, _oldname, _newname), do: f

  def depends_on_column?(f, name) do
    Enum.any?(f.args, &Catalog.depends_on_column?(&1, name))
  end

  def depends_on_column?(_, _, _), do: false
  def depends_on_table?(_, _), do: false
  def depends_on_constraint?(_, _, _), do: false
  # keys is only relevant to constraints
  def keys(_), do: []
end

defimpl Catalog, for: Proto.Expression.Cast do
  def rename_column(c, oldname, newname) do
    %{c | arg: Catalog.rename_column(c.arg, oldname, newname)}
  end

  # would need to verify this but for the moment I think we can just assume
  # that all function invocations only reference columns of the current table
  def rename_column(c, _table_name, _oldname, _newname), do: c
  def rename_table(c, _oldname, _newname), do: c

  def depends_on_column?(c, name) do
    Catalog.depends_on_column?(c.arg, name)
  end

  def depends_on_column?(_, _, _), do: false
  def depends_on_table?(_, _), do: false
  def depends_on_constraint?(_, _, _), do: false
  # keys is only relevant to constraints
  def keys(_), do: []
end

defimpl Catalog, for: Proto.Expression.AExpr do
  def rename_column(e, oldname, newname) do
    %{
      e
      | left: Catalog.rename_column(e.left, oldname, newname),
        right: Catalog.rename_column(e.right, oldname, newname)
    }
  end

  # would need to verify this but for the moment I think we can just assume
  # that all function invocations only reference columns of the current table
  def rename_column(e, _table_name, _oldname, _newname), do: e
  def rename_table(e, _oldname, _newname), do: e

  def depends_on_column?(e, name) do
    Catalog.depends_on_column?(e.left, name) ||
      Catalog.depends_on_column?(e.right, name)
  end

  def depends_on_column?(_, _, _), do: false
  def depends_on_table?(_, _), do: false
  def depends_on_constraint?(_, _, _), do: false
  # keys is only relevant to constraints
  def keys(_), do: []
end

defimpl Catalog, for: Proto.Expression.ColumnRef do
  def rename_column(r, oldname, newname) do
    if r.name == oldname do
      %{r | name: newname}
    else
      r
    end
  end

  def rename_column(r, _table_name, _oldname, _newname), do: r
  def rename_table(r, _oldname, _newname), do: r

  def depends_on_column?(r, name) do
    Schema.equal?(r.name, name)
  end

  def depends_on_column?(_, _, _), do: false
  def depends_on_table?(_, _), do: false
  def depends_on_constraint?(_, _, _), do: false
  # keys is only relevant to constraints
  def keys(_), do: []
end

defimpl Catalog, for: Proto.Expression.BoolExpr do
  def rename_column(b, oldname, newname) do
    %{b | args: Enum.map(b.args, &Catalog.rename_column(&1, oldname, newname))}
  end

  # would need to verify this but for the moment I think we can just assume
  # that all function invocations only reference columns of the current table
  def rename_column(b, _table_name, _oldname, _newname), do: b
  def rename_table(b, _oldname, _newname), do: b

  def depends_on_column?(b, name) do
    Enum.any?(b.args, &Catalog.depends_on_column?(&1, name))
  end

  def depends_on_column?(_, _, _), do: false
  def depends_on_table?(_, _), do: false
  def depends_on_constraint?(_, _, _), do: false
  # keys is only relevant to constraints
  def keys(_), do: []
end

defimpl Catalog, for: Proto.Constraint do
  def rename_column(%{constraint: con} = c, oldname, newname) do
    %{c | constraint: Catalog.rename_column(con, oldname, newname)}
  end

  def rename_column(%{constraint: con} = c, table_name, oldname, newname) do
    %{c | constraint: Catalog.rename_column(con, table_name, oldname, newname)}
  end

  def rename_table(%{constraint: con} = c, oldname, newname) do
    %{c | constraint: Catalog.rename_table(con, oldname, newname)}
  end

  def depends_on_column?(%{constraint: {_, constraint}}, name) do
    Catalog.depends_on_column?(constraint, name)
  end

  def depends_on_column?(%{constraint: {_, constraint}}, table_name, column_name) do
    Catalog.depends_on_column?(constraint, table_name, column_name)
  end

  def depends_on_table?(%{constraint: {_, constraint}}, table_name) do
    Catalog.depends_on_table?(constraint, table_name)
  end

  def depends_on_constraint?(%{constraint: {_, constraint}}, table_name, columns) do
    Catalog.depends_on_constraint?(constraint, table_name, columns)
  end

  def keys(%{constraint: {_, constraint}}) do
    Catalog.keys(constraint)
  end
end

defimpl Catalog, for: Proto.Constraint.Check do
  def rename_column(c, oldname, newname) do
    %{c | expr: Catalog.rename_column(c.expr, oldname, newname)}
  end

  # would need to verify this but for the moment I think we can just assume
  # that all function invocations only reference columns of the current table
  def rename_column(c, _table_name, _oldname, _newname), do: c
  def rename_table(c, _oldname, _newname), do: c

  def depends_on_column?(c, name) do
    Catalog.depends_on_column?(c.expr, name)
  end

  def depends_on_column?(_, _, _), do: false
  def depends_on_table?(_, _), do: false
  def depends_on_constraint?(_, _, _), do: false
  # keys is only relevant to constraints
  def keys(_), do: []
end

defimpl Catalog, for: Proto.Constraint.PrimaryKey do
  def rename_column(pk, oldname, newname) do
    Catalog.Constraint.rename_col(pk, [:keys, :including], oldname, newname)
  end

  # would need to verify this but for the moment I think we can just assume
  # that all function invocations only reference columns of the current table
  def rename_column(pk, _table_name, _oldname, _newname), do: pk
  def rename_table(pk, _oldname, _newname), do: pk

  def depends_on_column?(pk, name) do
    name in pk.keys || (pk.including && name in pk.including)
  end

  def depends_on_column?(_, _, _), do: false
  def depends_on_table?(_, _), do: false
  def depends_on_constraint?(_, _, _), do: false
  # keys is only relevant to constraints
  def keys(pk), do: pk.keys
end

defimpl Catalog, for: Proto.Constraint.Unique do
  def rename_column(u, oldname, newname) do
    Catalog.Constraint.rename_col(u, [:keys, :including], oldname, newname)
  end

  # would need to verify this but for the moment I think we can just assume
  # that all function invocations only reference columns of the current table
  def rename_column(u, _table_name, _oldname, _newname), do: u
  def rename_table(u, _oldname, _newname), do: u

  def depends_on_column?(u, name) do
    name in u.keys || (u.including && name in u.including)
  end

  def depends_on_column?(_, _, _), do: false
  def depends_on_table?(_, _), do: false
  def depends_on_constraint?(_, _, _), do: false
  # keys is only relevant to constraints
  def keys(u), do: u.keys
end

defimpl Catalog, for: Proto.Constraint.ForeignKey do
  def rename_column(fk, oldname, newname) do
    Catalog.Constraint.rename_col(fk, [:fk_cols], oldname, newname)
  end

  # would need to verify this but for the moment I think we can just assume
  # that all function invocations only reference columns of the current table
  def rename_column(fk, table_name, oldname, newname) do
    if Schema.equal?(table_name, fk.pk_table) do
      Catalog.Constraint.rename_col(fk, [:pk_cols], oldname, newname)
    else
      fk
    end
  end

  def rename_table(fk, oldname, newname) do
    if Schema.equal?(oldname, fk.pk_table) do
      %{fk | pk_table: %{fk.pk_table | name: newname}}
    else
      fk
    end
  end

  def depends_on_column?(fk, name) do
    name in fk.fk_cols
  end

  def depends_on_column?(fk, table_name, column_name) do
    Schema.equal?(fk.pk_table, table_name) && column_name in fk.pk_cols
  end

  def depends_on_table?(fk, table_name) do
    Schema.equal?(fk.pk_table, table_name)
  end

  def depends_on_constraint?(fk, table_name, columns) do
    Schema.equal?(fk.pk_table, table_name) &&
      Enum.sort(columns) == Enum.sort(fk.pk_cols)
  end

  # keys is only relevant to constraints
  def keys(fk), do: fk.fk_cols
end

defimpl Catalog, for: Proto.Constraint.Generated do
  def rename_column(g, oldname, newname) do
    %{g | expr: Catalog.rename_column(g.expr, oldname, newname)}
  end

  # would need to verify this but for the moment I think we can just assume
  # that all function invocations only reference columns of the current table
  def rename_column(g, _table_name, _oldname, _newname), do: g
  def rename_table(g, _oldname, _newname), do: g

  def depends_on_column?(g, name) do
    Catalog.depends_on_column?(g.expr, name)
  end

  def depends_on_column?(_, _, _), do: false
  def depends_on_table?(_, _), do: false
  def depends_on_constraint?(_, _, _), do: false
  # keys is only relevant to constraints
  def keys(_), do: []
end

defimpl Catalog, for: Proto.Index do
  alias Proto.Index.Column

  def rename_column(idx, oldname, newname) do
    idx
    |> rename_col([:columns, :including], oldname, newname)
  end

  defp rename_col(idx, keys, oldname, newname) do
    Enum.reduce(keys, idx, fn k, index ->
      Map.update!(index, k, fn
        nil ->
          nil

        [] ->
          []

        [%Column{} | _] = cols ->
          Enum.map(cols, fn col ->
            if col.name == oldname do
              %{col | name: newname}
            else
              col
            end
            |> rename_expr(oldname, newname)
          end)

        [n | _] = cols when is_binary(n) ->
          Enum.map(cols, fn col ->
            if col == oldname, do: newname, else: col
          end)
      end)
    end)
  end

  defp rename_expr(%{expr: nil} = col, _, _) do
    col
  end

  defp rename_expr(%{expr: expr} = col, oldname, newname) do
    %{col | expr: Catalog.rename_column(expr, oldname, newname)}
  end

  # would need to verify this but for the moment I think we can just assume
  # that all function invocations only reference columns of the current table
  def rename_column(idx, _table_name, _oldname, _newname), do: idx
  def rename_table(idx, _oldname, _newname), do: idx

  def depends_on_column?(idx, name) do
    Enum.any?(idx.columns, &column_match(&1, name)) ||
      Enum.any?(idx.including, &column_match(&1, name))
  end

  defp column_match(%Column{expr: nil, name: cname}, mname) do
    cname == mname
  end

  defp column_match(%Column{expr: expr}, mname) do
    Catalog.depends_on_column?(expr, mname)
  end

  defp column_match(name, mname) when is_binary(name) do
    name == mname
  end

  def depends_on_column?(_, _, _), do: false
  def depends_on_table?(_, _), do: false
  def depends_on_constraint?(_, _, _), do: false
  # keys is only relevant to constraints
  def keys(idx), do: Enum.map(idx.columns, & &1.name)
end
