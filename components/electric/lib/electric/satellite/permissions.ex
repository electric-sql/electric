defmodule Electric.Satellite.Permissions do
  use Electric.Satellite.Protobuf

  alias Electric.Replication.Changes
  alias Electric.Satellite.Permissions.{Grant, Role, Scope}
  alias Electric.Satellite.Auth
  alias Electric.Satellite.SatPerms

  require Logger

  defstruct [:source, :roles, :auth]

  @type relation() :: Electric.Postgres.relation()
  @type privilege() :: :INSERT | :UPDATE | :DELETE | :SELECT
  @type grant_permission() :: {relation(), privilege()}
  @type assigned_roles() :: %{global?: boolean(), unscoped: [Role.t()], scoped: [Role.t()]}
  @type compiled_role() :: %{grant_permission() => assigned_roles()}

  @type t() :: %__MODULE__{
          source: %{grants: [%SatPerms.Grant{}], roles: [%SatPerms.Role{}]},
          roles: [compiled_role()],
          auth: Auth.t()
        }

  defguardp is_update(change) when is_struct(change, Changes.UpdatedRecord)

  @spec build([%SatPerms.Grant{}], [%SatPerms.Role{}], Auth.t()) :: t()
  def build(grants, roles, auth) do
    roles = build_roles(roles, auth)

    role_grants =
      roles
      |> Stream.map(&{&1, Role.matching_grants(&1, grants)})
      |> Stream.map(&compile_grants/1)
      |> Stream.reject(fn {_role, grants} -> Enum.empty?(grants) end)
      |> Stream.flat_map(&invert_role_lookup/1)
      |> Enum.group_by(
        fn {grant_perm, _role} -> grant_perm end,
        fn {_, grant_role} -> grant_role end
      )
      |> Map.new(&classify_roles/1)

    %__MODULE__{source: %{grants: grants, roles: roles}, roles: role_grants, auth: auth}
  end

  defp build_roles(roles, auth) do
    roles
    |> add_authenticated(auth)
    |> add_anyone()
  end

  # for every `{table, privilege}` tuple we have a set of roles that the current user has
  # if any of those roles are global, then it's equvilent to saying that the user can perform
  # `privilege` on `table` no matter what the scope. This function analyses the roles for a
  # given `{table, privilege}` and makes that test efficient.
  defp classify_roles({grant_perm, grant_roles}) do
    case Enum.split_with(grant_roles, fn {_grant, role} -> Role.has_scope?(role) end) do
      {scoped, [] = _unscoped} -> {grant_perm, %{global?: false, unscoped: [], scoped: scoped}}
      {scoped, unscoped} -> {grant_perm, %{global?: true, unscoped: unscoped, scoped: scoped}}
    end
  end

  # expand the grants into a list of `{{relation, privilege}, [role]}`
  # so that we can create a LUT of table and required privilege to role
  defp invert_role_lookup({role, grants}) do
    Stream.flat_map(grants, fn grant ->
      Enum.map(grant.privileges, &{{grant.table, &1}, {grant, role}})
    end)
  end

  defp compile_grants({role, grants}) do
    {Role.new(role), Enum.map(grants, &Grant.new/1)}
  end

  @spec allowed(%__MODULE__{}, Scope.t(), Changes.change()) :: :ok | {:error, String.t()}
  def allowed(%__MODULE__{} = perms, scope_resolv, change) do
    change
    |> expand_change(scope_resolv)
    |> verify_all_changes(perms, scope_resolv)
  end

  defp expand_change(change, scope_resolv) when is_update(change) do
    case Scope.modifies_fk?(scope_resolv, change) do
      # TODO: if update alters fk, translate to orig update + insert with updated cols
      {:ok, false} ->
        [change]

      {:ok, true} ->
        # expand an update that modifies a foreign key into the original update
        # plus a "pseudo"-insert into the scope defined by the updated foreign key
        insert = %Changes.NewRecord{relation: change.relation, record: change.record}
        [change, insert]
    end
  end

  defp expand_change(change, _scope_resolv) do
    [change]
  end

  defp verify_all_changes(changes, perms, scope_resolv) do
    Enum.reduce_while(changes, :ok, fn change, :ok ->
      case change_is_allowed(change, perms, scope_resolv) do
        :ok -> {:cont, :ok}
        {:error, _} = error -> {:halt, error}
      end
    end)
  end

  defp change_is_allowed(change, perms, scope_resolv) do
    action = required_permission(change)

    with {:ok, grant_roles} <- Map.fetch(perms.roles, action),
         {:ok, role, _grant} <- grant_for_permission(grant_roles, scope_resolv, change) do
      Logger.debug("role #{inspect(role)} grants permission for #{inspect(change)}")
      :ok
    else
      _ ->
        permission_error(action)
    end
  end

  defp grant_for_permission(%{global?: true, unscoped: grant_roles}, _scope_resolv, change) do
    with {grant, role} <- grant_giving_permission(grant_roles, change) do
      {:ok, role, grant}
    end
  end

  defp grant_for_permission(%{global?: false, scoped: grant_roles}, scope_resolv, change) do
    # find roles that are valid for the scope of the change
    valid_grant_roles = roles_for_change(grant_roles, scope_resolv, change)

    with {grant, role} <- grant_giving_permission(valid_grant_roles, change) do
      {:ok, role, grant}
    end

    # Enum.find(grant_roles, &roles_for_change())
    # for every role, find the grants that apply
    # Enum.find_value(roles, nil, fn {role, _permissions, grants} ->
    #   # now if any of the grants give permission, allow the change
    #   if grant = grant_giving_permission(grants, privilege, change) do
    #     {:ok, role, grant}
    #   end
    # end)
  end

  defp grant_giving_permission(grant_roles, change) do
    # %{relation: relation} = change
    # select only grants that apply to the table in the change
    grant_roles
    |> Enum.find(fn {grant, _role} ->
      # now ensure that change is compatible with grant conditions
      change_matches_columns?(grant, change) && change_passes_check?(grant, change)
    end)
  end

  defp change_matches_columns?(grant, %Changes.NewRecord{} = insert) do
    Grant.columns_valid?(grant, Map.keys(insert.record))
  end

  defp change_matches_columns?(grant, %Changes.UpdatedRecord{} = update) do
    Grant.columns_valid?(grant, update.changed_columns)
  end

  defp change_matches_columns?(_grant, _deleted_record) do
    true
  end

  defp change_passes_check?(%{check: nil}, _change) do
    true
  end

  defp change_passes_check?(_grant, _change) do
    # TODO: test change against check function
    true
  end

  # find roles that apply for the given change. use the precompiled
  # permissions to quickly filter any roles that don't have the required
  # privilege.
  #
  # this only runs against scoped-only roles because if we found a global role
  # we won't even get here
  defp roles_for_change(grant_roles, scope_resolv, change) do
    Enum.filter(grant_roles, fn
      {_grant, %{scope: {scope_table, scope_id}}} ->
        # filter out roles whose scope doesn't match
        #   - lookup their root id from the change
        #   - then reject roles that don't match the {table, pk_id}
        # an {:error, _} response here means the change doesn't belong in the scope -- transient
        # runtime errors raise
        case Scope.scope_id!(scope_resolv, scope_table, change) do
          {:ok, id} -> scope_id == id
          {:error, _reason} -> false
        end
    end)
  end

  defp add_anyone(roles) do
    [%Role.Anyone{} | roles]
  end

  defp add_authenticated(roles, %Auth{user_id: nil}) do
    roles
  end

  defp add_authenticated(roles, %Auth{user_id: user_id}) do
    [%Role.Authenticated{user_id: user_id} | roles]
  end

  defp required_permission(%{relation: relation} = change) do
    case change do
      %Changes.NewRecord{} -> {relation, :INSERT}
      %Changes.UpdatedRecord{} -> {relation, :UPDATE}
      %Changes.DeletedRecord{} -> {relation, :DELETE}
    end
  end

  defp permission_error({relation, privilege}) do
    action =
      case privilege do
        :INSERT -> "INSERT INTO "
        :DELETE -> "DELETE FROM "
        :UPDATE -> "UPDATE "
        :SELECT -> "SELECT FROM "
      end

    {:error,
     "user does not have permission to " <>
       action <> Electric.Utils.inspect_relation(relation)}
  end
end
