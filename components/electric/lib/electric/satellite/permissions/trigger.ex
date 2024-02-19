defmodule Electric.Satellite.Permissions.Trigger do
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Replication.Changes
  alias Electric.Satellite.SatPerms

  @type role() :: %SatPerms.Role{}
  @type role_event() ::
          {:insert, new :: role()}
          | {:update, old :: role(), new :: role()}
          | {:delete, old :: role()}
  @type callback_arg() :: term()
  @type callback_result() :: {[term()], callback_arg()}
  @type callback_fun() :: (role_event(), Changes.change(), callback_arg() -> callback_result())
  @type trigger_fun() :: (Changes.change(), callback_arg() -> callback_result())
  @type triggers() :: %{Electric.Postgres.relation() => trigger_fun()}

  @doc """
  Create a callback map for the given list of assignments.

  The callback map is a map of relation => function.

  The function expects to be called with two arguments:

  1. The change struct from the logical replication stream
  2. Some user defined argument that will be passed to the final callback function
     (`trigger_callback_function()`)

  The `trigger_callback_function()` is called with 3 arguments:

  1. The role change event which is a map of the original change in the data to the resulting
     change in role
  2. The original pg change event
  3. The second argument to the original callback
  """
  @spec assign_triggers([%SatPerms.Assign{}], SchemaLoader.Version.t(), callback_fun()) ::
          triggers()
  def assign_triggers(assigns, schema_version, trigger_callback_fun)
      when is_function(trigger_callback_fun, 3) do
    assigns
    |> Enum.map(&for_assign(&1, schema_version, trigger_callback_fun))
    |> Enum.group_by(&elem(&1, 0), &elem(&1, 1))
  end

  @doc false
  @spec for_assign(%SatPerms.Assign{}, SchemaLoader.Version.t(), callback_fun()) ::
          {Electric.Postgres.relation(), trigger_fun()}
  def for_assign(assign, schema_version, trigger_callback_fun)
      when is_function(trigger_callback_fun, 3) do
    %{table: %{schema: schema, name: name}} = assign

    relation = {schema, name}

    {:ok, fks} =
      case assign do
        %{scope: %{schema: scope_schema, name: scope_table}} ->
          SchemaLoader.Version.foreign_keys(
            schema_version,
            relation,
            {scope_schema, scope_table}
          )

        %{scope: nil} ->
          {:ok, []}
      end

    {:ok, pks} = SchemaLoader.Version.primary_keys(schema_version, relation)

    assign_data =
      assign
      |> Map.from_struct()
      |> Map.put(
        :watch_columns,
        Enum.reject(fks ++ [assign.user_column, assign.role_column], &is_nil/1)
      )

    {
      relation,
      &change_trigger(&1, &2, assign_data, pks, fks, trigger_callback_fun)
    }
  end

  @doc """
  Apply the triggers to the given change.

  The `fallback` function is called when no trigger exists for the given relation.
  """
  @spec apply(Changes.change(), triggers(), callback_arg(), trigger_fun()) :: callback_result()
  def apply(change, triggers, callback_arg, fallback \\ &passthrough_trigger/2)

  def apply(%{relation: relation} = change, triggers, callback_arg, fallback) do
    # TODO: altough this claims to support multiple triggers per relation, in reality
    # if we were to have that it would be difficult to manage which of the triggers
    # passes on the change data itself
    # Perhaps should be re-written as pass on change plus any supplemental stream
    # elements...
    triggers
    |> Map.get(relation, [fallback])
    |> Enum.flat_map_reduce(callback_arg, fn trigger_fun, arg ->
      trigger_fun.(change, arg)
    end)
  end

  # just pass through changes with no relation
  def apply(change, _triggers, callback_arg, _fallback) do
    {[change], callback_arg}
  end

  defp passthrough_trigger(change, arg) do
    {[change], arg}
  end

  defp change_trigger(%Changes.NewRecord{} = change, loader, assign, pks, fks, callback_fun) do
    %{record: record} = change

    role = role(record, assign, pks, fks)

    callback_fun.({:insert, role}, change, loader)
  end

  defp change_trigger(%Changes.UpdatedRecord{} = change, loader, assign, pks, fks, callback_fun) do
    %{old_record: old, record: new, changed_columns: changed_columns} = change

    if MapSet.size(changed_columns) == 0 do
      {[change], loader}
    else
      # if role as been detatched, e.g. by a fk with delete action "SET NULL" or the role value has
      # been nulled, then delete the role
      role_nulled? =
        assign.watch_columns
        |> Stream.filter(&MapSet.member?(changed_columns, &1))
        |> Stream.map(&Map.fetch!(new, &1))
        |> Enum.any?(&is_nil/1)

      if role_nulled? do
        old_role = role(old, assign, pks, fks)

        callback_fun.({:delete, old_role}, change, loader)
      else
        old_role = role(old, assign, pks, fks)
        new_role = role(new, assign, pks, fks)

        callback_fun.({:update, old_role, new_role}, change, loader)
      end
    end
  end

  defp change_trigger(%Changes.DeletedRecord{} = change, loader, assign, pks, fks, callback_fun) do
    %{old_record: record} = change

    role = role(record, assign, pks, fks)

    callback_fun.({:delete, role}, change, loader)
  end

  defp role(record, assign, pks, fks) do
    %SatPerms.Role{
      row_id: Enum.map(pks, &Map.fetch!(record, &1)),
      role: role_name(record, assign),
      user_id: Map.fetch!(record, assign.user_column),
      assign_id: assign.id,
      scope: role_scope(fks, record, assign)
    }
  end

  defp role_name(_record, %{role_column: nil, role_name: role_name}) when is_binary(role_name) do
    role_name
  end

  defp role_name(record, %{role_column: role_column}) when is_binary(role_column) do
    Map.fetch!(record, role_column)
  end

  defp role_scope(_fks, _record, %{scope: nil}) do
    nil
  end

  defp role_scope(fks, record, %{scope: %{schema: sname, name: tname}}) do
    %SatPerms.Scope{table: role_table(sname, tname), id: Enum.map(fks, &Map.fetch!(record, &1))}
  end

  defp role_table(schema, name) do
    %SatPerms.Table{schema: schema, name: name}
  end
end
