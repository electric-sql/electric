defmodule Electric.Satellite.Permissions.Trigger do
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Replication.Changes
  alias Electric.Satellite.Permissions.Eval
  alias Electric.Satellite.SatPerms

  @type role() :: %SatPerms.Role{}
  @type role_event() ::
          {:insert, new :: role()}
          | {:update, old :: role(), new :: role()}
          | {:delete, old :: role()}
  @type callback_arg() :: term()
  @type callback_result() :: {[Changes.change() | [term()]], callback_arg()}
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

  It should return a tuple `{effects :: [term()], callback_arg()}` which is list of effects, which
  will be appended to the original change plus the modified callback argument it was given, or
  `nil` which is the same as returning `{[], original_callback_arg}`.
  """
  @spec assign_triggers([%SatPerms.Assign{}], SchemaLoader.Version.t(), callback_fun()) ::
          triggers()
  def assign_triggers(assigns, schema_version, trigger_callback_fun)
      when is_function(trigger_callback_fun, 3) do
    evaluator = Eval.new(schema_version)

    assigns
    |> Enum.map(&for_assign(&1, schema_version, evaluator, trigger_callback_fun))
    |> Enum.group_by(&elem(&1, 0), &elem(&1, 1))
  end

  def for_assign(assign, schema_version, trigger_callback_fun) do
    for_assign(assign, schema_version, Eval.new(schema_version), trigger_callback_fun)
  end

  @doc false
  @spec for_assign(%SatPerms.Assign{}, SchemaLoader.Version.t(), Eval.t(), callback_fun()) ::
          {Electric.Postgres.relation(), trigger_fun()}
  def for_assign(assign, schema_version, evaluator, trigger_callback_fun)
      when is_function(trigger_callback_fun, 3) do
    %{table: %{schema: schema, name: name}} = assign

    relation = {schema, name}

    {:ok, expression} = Eval.expression_context(evaluator, assign.if, relation)

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
      |> Map.put(:where, expression)

    {
      relation,
      &change_trigger(&1, &2, assign_data, pks, fks, trigger_callback_fun)
    }
  end

  @doc """
  Apply the triggers to the given change.

  The `fallback` function is called when no trigger exists for the given relation.

  """
  @spec apply(Changes.change(), triggers(), callback_arg()) :: callback_result()
  def apply(%{relation: relation} = change, triggers, callback_arg) do
    {effects, callback_arg} =
      triggers
      |> Map.get(relation, [&null_trigger/2])
      |> Enum.flat_map_reduce(callback_arg, fn trigger_fun, arg ->
        trigger_fun.(change, arg) || {[], arg}
      end)

    {[change | effects], callback_arg}
  end

  # just ignore changes with no relation
  def apply(_change, _triggers, callback_arg) do
    {[], callback_arg}
  end

  defp null_trigger(_change, arg) do
    {[], arg}
  end

  defp change_trigger(%Changes.NewRecord{} = change, loader, assign, pks, fks, callback_fun) do
    %{record: record} = change

    # only assign the role if the where expression passes
    if validate_where(assign, change) do
      role = role(record, assign, pks, fks)

      callback_fun.({:insert, role}, change, loader)
    else
      callback_fun.(:passthrough, change, loader)
    end
  end

  defp change_trigger(%Changes.UpdatedRecord{} = change, loader, assign, pks, fks, callback_fun) do
    %{old_record: old, record: new, changed_columns: changed_columns} = change

    if MapSet.size(changed_columns) > 0 do
      # if role as been detatched, e.g. by a fk with delete action "SET NULL" or the role value has
      # been nulled, then delete the role
      role_nulled? =
        assign.watch_columns
        |> Enum.filter(&MapSet.member?(changed_columns, &1))
        |> Enum.map(&Map.fetch!(new, &1))
        |> Enum.any?(&is_nil/1)

      r = &role(&1, assign, pks, fks)

      if role_nulled? do
        callback_fun.({:delete, r.(old)}, change, loader)
      else
        event =
          case validate_where(assign, change) do
            {true, true} ->
              # - old: t, new: t -> update: row still has a matching role, but that role may have changed
              {:update, r.(old), r.(new)}

            {true, false} ->
              # - old: t, new: f -> delete: old row did create role before but now shouldn't
              {:delete, r.(old)}

            {false, true} ->
              # - old: f, new: t -> insert: old row didn't create a role, but should now
              {:insert, r.(new)}

            {false, false} ->
              # - old: f, new: f -> passthrough: no role existed before, none should be created
              :passthrough
          end

        callback_fun.(event, change, loader)
      end
    end
  end

  defp change_trigger(%Changes.DeletedRecord{} = change, loader, assign, pks, fks, callback_fun) do
    %{old_record: record} = change

    role = role(record, assign, pks, fks)

    # send a delete even if say the row doesn't pass the where clause because
    # we lose nothing by deleting something that isn't there.
    # the callbacks should be able to handle a delete op on a non-existant role
    callback_fun.({:delete, role}, change, loader)
  end

  defp validate_where(%{where: nil}, %Changes.UpdatedRecord{} = _change) do
    {true, true}
  end

  defp validate_where(
         %{where: %Eval.ExpressionContext{} = expr},
         %Changes.UpdatedRecord{} = change
       ) do
    %{old_record: old, record: new} = change
    {Eval.evaluate!(expr, old), Eval.evaluate!(expr, new)}
  end

  defp validate_where(%{where: nil}, _change) do
    true
  end

  defp validate_where(%{where: %Eval.ExpressionContext{} = expr}, change) do
    Eval.execute!(expr, change)
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
