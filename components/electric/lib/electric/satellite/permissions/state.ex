defmodule Electric.Satellite.Permissions.State do
  @moduledoc """
  Accepts changes from the replication stream and transforms them into permissions state changes,
  both global and per-user.
  """

  alias Electric.DDLX.Command
  alias Electric.Satellite.SatPerms
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Replication.Changes
  alias Electric.Postgres.Extension
  alias Electric.Satellite.Permissions.Trigger

  require Logger

  @electric_ddlx Extension.ddlx_relation()
  @electric_rules Extension.global_perms_relation()

  @enforce_keys [:rules, :schema]

  defstruct [:rules, :schema, triggers: %{}]

  @type name() :: Electric.Postgres.name()
  @type trigger_fun() ::
          (Changes.change(), SchemaLoader.t() -> {[Changes.change()], SchemaLoader.t()})
  @typep update_fun() :: (%SatPerms{}, %SatPerms.Role{} -> {:ok, %SatPerms.Roles{}, boolean()})

  @type t() :: %__MODULE__{
          rules: %SatPerms.Rules{},
          schema: SchemaLoader.Version.t(),
          triggers: %{Electric.Postgres.relation() => trigger_fun()}
        }

  @doc """
  Creates a new permissions consumer state, based on the current global rules and the current
  schema version.
  """
  @spec new(SchemaLoader.t()) :: {:ok, t()} | {:error, binary()}
  def new(loader) do
    with {:ok, schema_version} <- SchemaLoader.load(loader),
         {:ok, rules} <- SchemaLoader.global_permissions(loader) do
      # The rules we load here can be ahead of the replication stream, so we
      # may receive updates to the rules that are before the rules we load
      # here, and we will potentially be applying triggers from assigns that
      # didn't exist when a row from an assigns table was updated.
      #
      # This is ok though, things will eventually resolve to a consistent
      # state.
      {:ok, create_triggers(%__MODULE__{rules: rules, schema: schema_version})}
    end
  end

  @doc """
  Refreshes the current state after a migration updates the schema.
  """
  @spec update_schema(t(), SchemaLoader.Version.t()) :: t()
  def update_schema(state, %SchemaLoader.Version{} = schema_version) do
    create_triggers(%{state | schema: schema_version})
  end

  @doc """
  Accept a transaction, or set of changes from a transaction and transform them into global- or
  user-permissions changes.
  """
  @spec update(Changes.Transaction.t(), t(), SchemaLoader.t()) ::
          {:ok, Changes.Transaction.t(), t(), SchemaLoader.t()}
  def update(%Changes.Transaction{changes: changes} = tx, state, loader) do
    {:ok, changes, state, loader} = update(changes, state, loader)

    {:ok, %{tx | changes: changes}, state, loader}
  end

  @spec update([Changes.change()], t(), SchemaLoader.t()) ::
          {:ok, [Changes.change()], t(), SchemaLoader.t()}
  def update(changes, state, loader) when is_list(changes) do
    # group changes by relation -- this is really only to avoid churn on the global permissions
    # rules which is an expensive operation. by grouping on the relation we can transform a series
    # of ddlx permission commands into a single update to the global permissions struct
    {changes, {state, loader}} =
      changes
      |> Enum.chunk_by(& &1.relation)
      |> Enum.flat_map_reduce({state, loader}, &apply_changes/2)

    {:ok, changes, state, loader}
  end

  def apply_ddlx(ddlx, rules) do
    case apply_ddlx_txn(ddlx, rules) do
      {:ok, 0, rules} ->
        {:ok, 0, rules}

      {:ok, n, rules} ->
        {:ok, n, commit(rules)}
    end
  end

  def apply_ddlx!(ddlx, rules) do
    {:ok, _n, rules} = apply_ddlx(ddlx, rules)
    rules
  end

  def apply_ddlx_txn(
        %Electric.DDLX.Command{action: %SatPerms.DDLX{} = ddlx},
        %SatPerms.Rules{} = rules
      ) do
    apply_ddlx_txn(ddlx, rules)
  end

  def apply_ddlx_txn(%Electric.DDLX.Command{action: _}, %SatPerms.Rules{} = rules) do
    rules
  end

  def apply_ddlx_txn(%SatPerms.DDLX{} = ddlx, %SatPerms.Rules{} = rules) do
    with {rules, n} <- mutate_global(ddlx, rules) do
      {:ok, n, rules}
    end
  end

  def apply_ddlx_txn(_action, %SatPerms.Rules{} = rules) do
    {:ok, 0, rules}
  end

  def apply_ddlx_txn!(ddlx, %SatPerms.Rules{} = rules) do
    {:ok, _, rules} = apply_ddlx_txn(ddlx, rules)
    rules
  end

  @doc """
  Should be called before saving the permissions state to set up the
  permissions `id` and `parent_id`
  """
  @spec commit(%SatPerms.Rules{}) :: %SatPerms.Rules{}
  def commit(%SatPerms.Rules{} = rules) do
    increment_id(rules)
  end

  # just ignoring ddlx commmands for now. Because perms state mutations are
  # done in the proxy and arrive here fully-formed, the only ddlx command we
  # currently receive are `ELECTRIC SQLITE...`, which currently do nothing.
  defp apply_changes([%{relation: @electric_ddlx} | _], {state, loader}) do
    {[], {state, loader}}
  end

  defp apply_changes([%{relation: @electric_rules} | _] = changes, {state, loader}) do
    # we can just take the last insert and skip any intermediate states
    %{record: %{"rules" => bytes}} = List.last(changes)

    {:ok, new_rules} = decode_pb(bytes, SatPerms.Rules)

    if new_rules.id > state.rules.id do
      Logger.debug(fn -> "Updated global permissions id: #{new_rules.id}" end)

      {
        [updated_global_permissions(new_rules)],
        {create_triggers(%{state | rules: new_rules}), loader}
      }
    else
      {[], {state, loader}}
    end
  end

  defp apply_changes(changes, {state, loader}) do
    {changes, {_triggers, loader}} =
      Enum.flat_map_reduce(changes, {state.triggers, loader}, &apply_triggers/2)

    {changes, {state, loader}}
  end

  defp apply_triggers(change, {triggers, loader}) do
    {changes, loader} =
      Trigger.apply(change, triggers, loader)

    {changes, {triggers, loader}}
  end

  defp update_roles_callback(:passthrough, _change, loader) do
    {[], loader}
  end

  defp update_roles_callback({:insert, role}, _change, loader) do
    {:ok, loader, update_message} = mutate_user_perms(role, loader, &insert_role/2)

    {update_message, loader}
  end

  defp update_roles_callback({:update, old_role, new_role}, _change, loader) do
    if old_role.user_id == new_role.user_id do
      {:ok, loader, update_message} = mutate_user_perms(new_role, loader, &update_role/2)

      {update_message, loader}
    else
      {:ok, loader, old_update_message} = mutate_user_perms(old_role, loader, &delete_role/2)
      {:ok, loader, new_update_message} = mutate_user_perms(new_role, loader, &insert_role/2)

      {
        Enum.concat(
          old_update_message,
          new_update_message
        ),
        loader
      }
    end
  end

  defp update_roles_callback({:delete, role}, _change, loader) do
    {:ok, loader, update_message} = mutate_user_perms(role, loader, &delete_role/2)

    {update_message, loader}
  end

  @spec mutate_user_perms(%SatPerms.Role{}, SchemaLoader.t(), update_fun()) ::
          {:ok, SchemaLoader.t(), [Changes.UpdatedPermissions.t()]}
  defp mutate_user_perms(role, loader, update_fun) do
    with {:ok, loader, perms} <- SchemaLoader.user_permissions(loader, role.user_id),
         {:ok, roles, modified?} <- update_fun.(perms, role),
         {roles, modified?} = gc_roles(perms, roles, modified?) do
      if modified? do
        with {:ok, loader, perms} <-
               SchemaLoader.save_user_permissions(loader, role.user_id, roles) do
          Logger.debug(fn -> "Updated user permissions id: #{perms.id}" end,
            user_id: role.user_id
          )

          {:ok, loader, [updated_user_permissions(role.user_id, perms)]}
        end
      else
        {:ok, loader, []}
      end
    end
  end

  defp insert_role(perms, new_role) do
    with roles <- load_roles(perms) do
      {:ok, Map.update!(roles, :roles, &[new_role | &1]), true}
    end
  end

  defp update_role(perms, new_role) do
    with user_roles <- load_roles(perms) do
      {updated_roles, modified?} =
        Enum.map_reduce(user_roles.roles, false, fn role, modified? ->
          if role_match?(role, new_role), do: {new_role, true}, else: {role, modified?}
        end)

      {:ok, %{user_roles | roles: updated_roles}, modified?}
    end
  end

  defp delete_role(perms, new_role) do
    with user_roles <- load_roles(perms) do
      {updated_roles, modified?} =
        Enum.flat_map_reduce(user_roles.roles, false, fn role, modified? ->
          if role_match?(role, new_role), do: {[], true}, else: {[role], modified?}
        end)

      {:ok, %{user_roles | roles: updated_roles}, modified?}
    end
  end

  defp mutate_global(ddlx, rules, count \\ 0)

  defp mutate_global(
         %SatPerms.DDLX{grants: [], revokes: [], assigns: [], unassigns: []},
         rules,
         count
       ) do
    {rules, count}
  end

  defp mutate_global(%SatPerms.DDLX{} = ddlx, rules, count) do
    {do_apply_ddlx(rules, ddlx), count + count_changes(ddlx)}
  end

  defp role_match?(role1, role2) do
    role1.assign_id == role2.assign_id && role1.row_id == role2.row_id
  end

  defp load_roles(perms) do
    %{id: id, roles: role_list, rules: %{id: rules_id}} = perms

    %SatPerms.Roles{
      parent_id: id,
      rules_id: rules_id,
      roles: role_list
    }
  end

  defp gc_roles(perms, roles, modified?) do
    valid_assigns = MapSet.new(perms.rules.assigns, & &1.id)

    {updated_roles, modified?} =
      Enum.flat_map_reduce(roles.roles, modified?, fn role, modified? ->
        if MapSet.member?(valid_assigns, role.assign_id),
          do: {[role], modified?},
          else: {[], true}
      end)

    {%{roles | roles: updated_roles}, modified?}
  end

  # the `%SatPerms.DDLX{}` struct contains multiple instances of say a `%SatPerms.Grant{}` but these
  # multiple instances are the result of a single command (e.g. a `GRANT ALL...` will result in 4
  # separate entries in the `grants` list but represent a single statement).
  #
  # Thus the order they are applied in a migration is preserved by the ordering of the arrival of
  # the DDLX structs through the replication stream.
  #
  # Since each struct's id is a fingerprint that acts as a primary key, we just need to operate on
  # the existing rules keyed by this id.
  #
  # Public only for its usefulness in tests.
  @doc false
  @spec do_apply_ddlx(%SatPerms.Rules{}, %SatPerms.DDLX{}) :: %SatPerms.Rules{}

  defp do_apply_ddlx(%SatPerms.Rules{} = rules, %SatPerms.DDLX{} = ddlx) do
    rules
    |> update_grants(ddlx.grants)
    |> update_revokes(ddlx.revokes)
    |> update_assigns(ddlx.assigns)
    |> update_unassigns(ddlx.unassigns)
  end

  defp update_grants(rules, grants) do
    add_rules(rules, :grants, grants)
  end

  defp update_revokes(rules, revokes) do
    remove_rules(rules, :grants, revokes)
  end

  defp update_assigns(rules, assigns) do
    add_rules(rules, :assigns, assigns)
  end

  defp update_unassigns(rules, unassigns) do
    remove_rules(rules, :assigns, unassigns)
  end

  defp add_rules(rules, key, updates) do
    update_rules(rules, key, updates, fn update, existing ->
      Map.put(existing, update.id, update)
    end)
  end

  defp remove_rules(rules, key, updates) do
    update_rules(rules, key, updates, fn update, existing ->
      Map.delete(existing, update.id)
    end)
  end

  defp update_rules(rules, key, updates, update_fun) do
    Map.update!(rules, key, fn existing ->
      existing = Map.new(existing, &{&1.id, &1})

      # be absolutely sure that every permission struct has an id set
      updates
      |> Stream.map(&Command.put_id/1)
      |> Enum.reduce(existing, update_fun)
      |> Map.values()
    end)
  end

  defp increment_id(%{id: id} = rules) do
    %{rules | id: id + 1, parent_id: id}
  end

  defp count_changes(ddlx) do
    [:grants, :revokes, :assigns, :unassigns]
    |> Enum.reduce(0, fn key, count ->
      count + length(Map.fetch!(ddlx, key))
    end)
  end

  defp updated_user_permissions(user_id, permissions) do
    %Changes.UpdatedPermissions{
      type: :user,
      permissions: %Changes.UpdatedPermissions.UserPermissions{
        user_id: user_id,
        permissions: permissions
      }
    }
  end

  defp updated_global_permissions(permissions) do
    %Changes.UpdatedPermissions{
      type: :global,
      permissions: %Changes.UpdatedPermissions.GlobalPermissions{
        permissions_id: permissions.id
      }
    }
  end

  defp create_triggers(state) do
    triggers =
      Trigger.assign_triggers(state.rules.assigns, state.schema, &update_roles_callback/3)

    %{state | triggers: triggers}
  end

  def decode_rules(bytes) do
    decode_pb(bytes, SatPerms.Rules)
  end

  defp decode_pb(bytes, message) do
    pb_bytes =
      case bytes do
        "\\x" <> rest -> Base.decode16!(rest, case: :lower)
        bytes -> bytes
      end

    Protox.decode(pb_bytes, message)
  end
end
