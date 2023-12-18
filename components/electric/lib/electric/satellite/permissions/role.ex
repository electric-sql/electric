defmodule Electric.Satellite.Permissions.Role do
  alias Electric.Satellite.SatPerms
  alias Electric.Satellite.Permissions

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
      id: role.id,
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
      %{role: %{role: {:predefined, :ANYONE}}} -> true
      _ -> false
    end)
  end

  def matching_grants(%Authenticated{}, grants) do
    Enum.filter(grants, fn
      %{role: %{role: {:predefined, :AUTHENTICATED}}} -> true
      _ -> false
    end)
  end

  # unscoped roles only match unscoped grants
  def matching_grants(%__MODULE__{scope: nil} = role, grants) do
    %{role: role_name} = role

    grants
    |> Stream.filter(&reject_predefined/1)
    |> Stream.filter(&is_nil(&1.scope))
    |> Enum.filter(&matching_role(&1, role_name))
  end

  # scoped roles match grants with the same scope
  def matching_grants(%__MODULE__{} = role, grants) do
    %{role: role_name, scope: {role_scope, _id}} = role

    grants
    |> Stream.filter(&reject_predefined/1)
    |> Stream.filter(&matching_scope(&1, role_scope))
    |> Enum.filter(&matching_role(&1, role_name))
  end

  defp reject_predefined(%{role: %{role: {:predefined, _}}}), do: false
  defp reject_predefined(_grant), do: true

  defp matching_role(%{role: %{role: {:application, role}}}, role), do: true
  defp matching_role(_grant, _role), do: false

  defp matching_scope(%{scope: %SatPerms.Table{schema: schema, name: name}}, {schema, name}),
    do: true

  defp matching_scope(_, _), do: false

  defp make_scope(nil), do: nil
  defp make_scope(%SatPerms.Scope{table: %{schema: s, name: n}, id: id}), do: {{s, n}, id}

  def has_scope?(%__MODULE__{scope: {_, _}}), do: true
  def has_scope?(_role), do: false
end
