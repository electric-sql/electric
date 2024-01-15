defmodule Electric.Satellite.Permissions.Grant do
  @moduledoc """
  A "compiled" version of a grant statement
  """

  alias Electric.Satellite.SatPerms
  alias Electric.Satellite.Permissions.Role

  defstruct [:table, :role, :privileges, :columns, :scope, :check, :source, path: []]

  @type relation() :: Electric.Postgres.relation()

  @type t() :: %__MODULE__{
          table: relation(),
          role: Role.t(),
          privileges: [Electric.Satellite.Permissions.privilege()],
          columns: :all | MapSet.t(),
          scope: relation(),
          check: String.t(),
          path: [String.t()],
          source: %SatPerms.Grant{}
        }

  @spec new(%SatPerms.Grant{}) :: t()
  def new(%SatPerms.Grant{} = grant) do
    %__MODULE__{
      table: make_relation(grant.table),
      role: make_role(grant.role),
      privileges: grant.privileges,
      columns: make_columns(grant.columns),
      scope: make_relation(grant.scope),
      check: make_check(grant.check),
      path: make_path(grant.path),
      source: grant
    }
  end

  defp make_relation(nil), do: nil
  defp make_relation(%SatPerms.Table{schema: s, name: n}), do: {s, n}

  defp make_role(%{role: {_, role}}), do: role

  # no columns specified so defaults to all
  defp make_columns(nil), do: :all
  defp make_columns(["*"]), do: :all
  defp make_columns(columns), do: MapSet.new(columns)

  defp make_path(empty) when empty in [nil, []], do: nil
  defp make_path(path), do: path

  defp make_check(check) do
    # TODO: compile to an actual function
    check
  end

  def columns_valid?(%__MODULE__{columns: :all}, _columns), do: true

  def columns_valid?(%__MODULE__{columns: allowed}, columns) when is_list(columns) do
    Enum.all?(columns, &MapSet.member?(allowed, &1))
  end

  def columns_valid?(%__MODULE__{columns: allowed}, %MapSet{} = columns) do
    MapSet.subset?(columns, allowed)
  end
end
