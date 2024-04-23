defmodule Electric.Satellite.Permissions.Role do
  alias Electric.Satellite.SatPerms
  alias Electric.Satellite.Permissions
  alias Electric.Satellite.Permissions.Grant

  defmodule Anyone do
    defstruct []

    @type t() :: %__MODULE__{}
  end

  defmodule Authenticated do
    defstruct [:user_id]

    @type t() :: %__MODULE__{user_id: binary()}
  end

  defstruct [:id, :role, :user_id, :assign_id, :scope, :source]

  @type relation() :: Electric.Postgres.relation()
  @type predefined() :: Authenticated.t() | Anyone.t()
  @type scope() :: Permissions.scope()
  @type t() ::
          predefined()
          | %__MODULE__{
              id: binary(),
              role: String.t(),
              user_id: binary(),
              assign_id: binary(),
              scope: scope(),
              source: %SatPerms.Role{}
            }

  @spec new(%SatPerms.Role{} | predefined()) :: t()
  def new(%SatPerms.Role{} = role) do
    %__MODULE__{
      id: role.row_id,
      role: role.role,
      user_id: role.user_id,
      assign_id: role.assign_id,
      scope: make_scope(role.scope),
      source: role
    }
  end

  def new(%Anyone{} = role) do
    role
  end

  def new(%Authenticated{} = role) do
    role
  end

  def matching_grants(%Anyone{}, grants) do
    Enum.filter(grants, fn
      %Grant{role: :ANYONE} -> true
      %Grant{role: _} -> false
    end)
  end

  def matching_grants(%Authenticated{}, grants) do
    Enum.filter(grants, fn
      %Grant{role: :AUTHENTICATED} -> true
      %Grant{role: _} -> false
    end)
  end

  # unscoped roles only match unscoped grants
  def matching_grants(%__MODULE__{scope: nil} = role, grants) do
    %{role: role_name} = role

    grants
    |> Stream.reject(&predefined/1)
    |> Stream.filter(&is_nil(&1.scope))
    |> Enum.filter(&matching_role(&1, role_name))
  end

  # scoped roles match grants with the same scope
  def matching_grants(%__MODULE__{} = role, grants) do
    %{role: role_name, scope: {role_scope, _id}} = role

    grants
    |> Stream.reject(&predefined/1)
    |> Stream.filter(&matching_scope(&1, role_scope))
    |> Enum.filter(&matching_role(&1, role_name))
  end

  defp predefined(%Grant{role: role}), do: role in [:ANYONE, :AUTHENTICATED]

  defp matching_role(%Grant{role: role}, role), do: true
  defp matching_role(%Grant{}, _role), do: false

  defp matching_scope(%Grant{scope: {schema, name}}, {schema, name}), do: true
  defp matching_scope(%Grant{}, _), do: false

  defp make_scope(nil), do: nil
  defp make_scope(%SatPerms.Scope{table: %{schema: s, name: n}, id: id}), do: {{s, n}, id}

  def has_scope?(%__MODULE__{scope: {_, _}}), do: true
  def has_scope?(_role), do: false
end
