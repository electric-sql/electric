defmodule Electric.Satellite.Permissions.Grant do
  @moduledoc """
  A "compiled" version of a grant statement
  """

  alias Electric.Satellite.Permissions.Eval
  alias Electric.Satellite.SatPerms

  defstruct [:table, :role, :privilege, :columns, :scope, :check, :source, path: []]

  @type relation() :: Electric.Postgres.relation()

  @type t() :: %__MODULE__{
          table: relation(),
          role: String.t() | :AUTHENTICATED | :ANYONE,
          privilege: Electric.Satellite.Permissions.privilege(),
          columns: :all | MapSet.t(),
          scope: relation(),
          check: nil | Eval.ExpressionContext.t(),
          path: [String.t()],
          source: %SatPerms.Grant{}
        }

  @spec new(%SatPerms.Grant{}, Eval.t()) :: t()
  def new(%SatPerms.Grant{} = grant, evaluator) do
    table = make_relation(grant.table)

    %__MODULE__{
      table: table,
      role: make_role(grant.role),
      privilege: grant.privilege,
      columns: make_columns(grant.columns),
      scope: make_relation(grant.scope),
      check: make_check(grant, table, evaluator),
      path: make_path(grant.path),
      source: grant
    }
  end

  defp make_relation(nil), do: nil
  defp make_relation(%SatPerms.Table{schema: s, name: n}), do: {s, n}

  defp make_role(%{role: {_, role}}), do: role

  # no columns specified so defaults to all
  defp make_columns(nil), do: :all
  defp make_columns(%SatPerms.ColumnList{names: columns}), do: MapSet.new(columns)

  defp make_path(empty) when empty in [nil, []], do: nil
  defp make_path(path), do: path

  defp make_check(%{check: nil}, _table, _evaluator) do
    nil
  end

  defp make_check(%{check: query}, table, evaluator) when is_binary(query) do
    {:ok, expr} = Eval.expression_context(evaluator, query, table)
    expr
  end

  def columns_valid?(%__MODULE__{columns: :all}, _columns), do: true

  def columns_valid?(%__MODULE__{columns: allowed}, columns) when is_list(columns) do
    Enum.all?(columns, &MapSet.member?(allowed, &1))
  end

  def columns_valid?(%__MODULE__{columns: allowed}, %MapSet{} = columns) do
    MapSet.subset?(columns, allowed)
  end

  def for_table(grants, {_, _} = table) do
    Enum.filter(grants, &(&1.table == table))
  end

  def for_privilege(grants, priv) do
    Enum.filter(grants, &(&1.privilege == priv))
  end

  def for_scope(grants, {_, _} = scope) do
    Enum.filter(grants, &(&1.scope == scope))
  end
end
