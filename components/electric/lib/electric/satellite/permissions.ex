defmodule Electric.Satellite.Permissions do
  use Electric.Satellite.Protobuf

  alias Electric.Replication.Changes
  alias Electric.Satellite.Permissions.{Grant, Role, Scope, Transient}
  alias Electric.Satellite.Auth
  alias Electric.Satellite.SatPerms

  require Logger

  defstruct [:source, :roles, :auth, :scopes, :scope_resolver, transient_lut: Transient]

  @type lsn() :: Electric.Postgres.Lsn.t()
  @type relation() :: Electric.Postgres.relation()
  @type privilege() :: :INSERT | :UPDATE | :DELETE | :SELECT
  @type grant_permission() :: {relation(), privilege()}
  @type assigned_roles() :: %{global?: boolean(), unscoped: [Role.t()], scoped: [Role.t()]}
  @type compiled_role() :: %{grant_permission() => assigned_roles()}
  @type attr() :: {:auth, Auth.t()} | {:scope_resolver, Scope.t()} | {:transient_lut, atom()}
  @type attrs() :: [attr()]

  @type empty() :: %__MODULE__{
          source: nil,
          roles: nil,
          auth: Auth.t(),
          transient_lut: Transient.lut(),
          scope_resolver: Scope.t()
        }
  @type t() :: %__MODULE__{
          source: %{grants: [%SatPerms.Grant{}], roles: [%SatPerms.Role{}]} | nil,
          roles: compiled_role(),
          auth: Auth.t(),
          transient_lut: Transient.lut(),
          scope_resolver: Scope.t()
        }

  defguardp is_update(change) when is_struct(change, Changes.UpdatedRecord)

  @doc """
  Configure a new empty permissions configuration with the given auth token, scope resvolver and
  (optionally) a transient permissions lookup table name.

  Use `update/3` to add actual role and grant information.
  """
  @spec new(Auth.t(), Scope.t(), Transient.lut()) :: empty()
  def new(%Auth{} = auth, {_, _} = scope_resolver, transient_lut_name \\ Transient) do
    %__MODULE__{
      auth: auth,
      scope_resolver: scope_resolver,
      transient_lut: Transient.table_ref!(transient_lut_name)
    }
  end

  @doc """
  Build a permissions struct that can be used to filter changes from the replication stream.

  Arguments:

  - `grants` should be a list of `%SatPerms.Grant{}` protobuf structs
  - `roles` should be a list of `%SatPerms.Role{}` protobuf structs
  - `attrs` is a list of options:
    - `auth` is the `#{Auth}` struct received from the connection auth
    - `scope_resolver` is an implementation of the `Permissions.Scope` behaviour in the
      form `{module, term}`
    - `transient_lut` (default: `#{Transient}`) is the name of the ETS table holding active
      transient permissions

  The `Permissions.roles` allows is a map of grant_permission() => assigned_roles() which allows
  quick lookup of a set of roles granting a change.

  We then can validate that a change falls within the scope of scoped roles
  """
  @spec update(t(), [%SatPerms.Grant{}], [%SatPerms.Role{}]) :: t()
  def update(%__MODULE__{} = perms, grants, roles) do
    compiled_roles = build_roles(roles, perms.auth)

    role_grants =
      compiled_roles
      |> Stream.map(&{&1, Role.matching_grants(&1, grants)})
      |> Stream.map(&compile_grants/1)
      |> Stream.reject(fn {_role, grants} -> Enum.empty?(grants) end)
      |> Stream.flat_map(&invert_role_lookup/1)
      |> Enum.group_by(
        fn {grant_perm, _role} -> grant_perm end,
        fn {_, grant_role} -> grant_role end
      )
      |> Map.new(&classify_roles/1)

    %{
      perms
      | source: %{grants: grants, roles: roles},
        roles: role_grants,
        scopes: compile_scopes(compiled_roles)
    }
  end

  defp build_roles(roles, auth) do
    roles
    |> Enum.map(&Role.new/1)
    |> add_authenticated(auth)
    |> add_anyone()
  end

  # For every `{table, privilege}` tuple we have a set of roles that the current user has.
  # If any of those roles are global, then it's equvilent to saying that the user can perform
  # `privilege` on `table` no matter what the scope. This function analyses the roles for a
  # given `{table, privilege}` and makes that test efficient by allowing for prioritising the
  # unscoped grant test.
  defp classify_roles({grant_perm, grant_roles}) do
    {scoped, unscoped} =
      Enum.split_with(grant_roles, fn {_grant, role} -> Role.has_scope?(role) end)

    {grant_perm, %{scoped: scoped, unscoped: unscoped}}
  end

  # expand the grants into a list of `{{relation, privilege}, [role]}`
  # so that we can create a LUT of table and required privilege to role
  defp invert_role_lookup({role, grants}) do
    Stream.flat_map(grants, fn grant ->
      Enum.map(grant.privileges, &{{grant.table, &1}, {grant, role}})
    end)
  end

  defp compile_grants({role, grants}) do
    {role, Enum.map(grants, &Grant.new/1)}
  end

  defp compile_scopes(roles) do
    roles
    |> Stream.filter(&Role.has_scope?/1)
    |> Stream.map(&elem(&1.scope, 0))
    |> Enum.uniq()
  end

  @doc """
  Verify that all the changes in a transaction are allowed given the user's permissions.
  """
  @spec write_allowed(t(), Changes.Transaction.t()) :: :ok | {:error, String.t()}
  def write_allowed(%__MODULE__{} = perms, %Changes.Transaction{} = tx) do
    tx.changes
    |> Enum.flat_map(&expand_change(&1, perms))
    |> verify_all_changes(perms, tx.lsn)
  end

  @spec filter_read(t(), Changes.Transaction.t()) :: Changes.Transaction.t()
  def filter_read(%__MODULE__{} = perms, %Changes.Transaction{changes: changes} = tx) do
    %{tx | changes: Enum.filter(changes, &validate_read(&1, perms, tx.lsn))}
  end

  defp expand_change(change, perms) when is_update(change) do
    if modifies_scope_fk?(change, perms) do
      # expand an update that modifies a foreign key into the original update plus a
      # pseudo-insert into the scope defined by the updated foreign key
      insert = %Changes.NewRecord{relation: change.relation, record: change.record}
      [change, insert]
    else
      [change]
    end
  end

  defp expand_change(change, _perms) do
    [change]
  end

  defp modifies_scope_fk?(change, perms) do
    Enum.any?(perms.scopes, &Scope.modifies_fk?(perms.scope_resolver, &1, change))
  end

  defp verify_all_changes(changes, perms, lsn) do
    Enum.reduce_while(changes, :ok, fn change, :ok ->
      case validate_write(change, perms, lsn) do
        {:error, _} = error ->
          {:halt, error}

        role ->
          Logger.debug("role #{inspect(role)} grants permission for #{inspect(change)}")
          {:cont, :ok}
      end
    end)
  end

  defp validate_write(change, perms, lsn) do
    action = required_permission(change)

    role =
      perms.roles
      |> Map.get(action)
      |> valid_role_for_change(perms, change, lsn)

    role || permission_error(action)
  end

  defp validate_read(change, perms, lsn) do
    if grant_roles = Map.get(perms.roles, {change.relation, :SELECT}) do
      valid_role_for_change(grant_roles, perms, change, lsn)
    end
  end

  @spec valid_role_for_change(assigned_roles() | nil, t(), Changes.change(), lsn()) ::
          Role.t() | nil
  defp valid_role_for_change(nil, _perms, _change, _lsn) do
    nil
  end

  defp valid_role_for_change(grants, perms, change, lsn) do
    %{scoped: scoped_grant_roles, unscoped: unscoped_grant_roles} = grants

    validate_change_against_grants(unscoped_grant_roles, change) ||
      validate_scoped_roles(scoped_grant_roles, perms, change, lsn)
  end

  defp validate_scoped_roles(grant_roles, perms, change, lsn) do
    # find roles that are valid for the scope of the change
    valid_grant_roles = roles_for_change(grant_roles, perms.scope_resolver, change)

    validate_change_against_grants(valid_grant_roles, change) ||
      transient_permission_for_change(grant_roles, perms, change, lsn)
  end

  defp transient_permission_for_change(grant_roles, perms, change, lsn) do
    roles = Enum.map(grant_roles, &elem(&1, 1))
    transient_perms = Transient.for_roles(roles, lsn, perms.transient_lut)

    if perm =
         Enum.find(
           transient_perms,
           &change_in_scope?(perms.scope_resolver, &1.target_relation, &1.target_id, change)
         ) do
      Enum.find(roles, &(&1.assign_id == perm.assign_id))
    end
  end

  defp validate_change_against_grants(grant_roles, change) do
    grant_roles
    |> Enum.find(fn {grant, _role} ->
      # ensure that change is compatible with grant conditions
      # note that we're allowing the change if *any* grant allows it
      change_matches_columns?(grant, change) && change_passes_check?(grant, change)
    end)
    |> then(fn
      nil -> nil
      {_grant, role} -> role
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

        change_in_scope?(scope_resolv, scope_table, scope_id, change)
    end)
  end

  defp change_in_scope?(scope_resolver, scope_relation, scope_id, change) do
    case Scope.scope_id!(scope_resolver, scope_relation, change) do
      {:ok, id} -> scope_id == id
      # an {:error, _} response here means the change doesn't belong in the scope -- transient
      # runtime errors raise
      {:error, _reason} -> false
    end
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
      end

    {:error,
     "user does not have permission to " <>
       action <> Electric.Utils.inspect_relation(relation)}
  end
end
