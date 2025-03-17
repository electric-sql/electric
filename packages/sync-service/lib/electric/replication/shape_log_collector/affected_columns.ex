defmodule Electric.Replication.ShapeLogCollector.AffectedColumns do
  @moduledoc false

  require Logger
  alias Electric.Replication.Changes.Relation

  def init(%{id_to_table_info: id_to_table_info, table_to_id: table_to_id})
      when is_map(id_to_table_info) and is_map(table_to_id) do
    {:ok, %{id_to_table_info: id_to_table_info, table_to_id: table_to_id}}
  end

  def transform_relation(
        %Relation{schema: schema, table: table, id: id} = rel,
        %{
          id_to_table_info: id_to_table_info,
          table_to_id: table_to_id
        } = state
      ) do
    schema_table = {schema, table}

    existing_id = Map.get(table_to_id, schema_table)
    existing_rel = Map.get(id_to_table_info, id)

    case {existing_id, existing_rel} do
      # New relation, register it
      {nil, nil} ->
        {rel, add_relation(state, id, rel)}

      # Relation identity matches known, let's compare columns
      {^id, %Relation{schema: ^schema, table: ^table}} ->
        case find_differing_columns(existing_rel, rel) do
          # No (noticable) changes to the relation, continue as-is
          [] ->
            {rel, state}

          affected_cols ->
            updated_rel = %{rel | affected_columns: affected_cols}
            {updated_rel, add_relation(state, id, rel)}
        end

      # Some part of identity changed, update the state and pass it through
      {_, _} ->
        Logger.debug(fn ->
          "Relation identity changed: #{existing_id}/#{inspect(existing_rel)} -> #{inspect(rel)}"
        end)

        {rel,
         state
         |> delete_tracked_relation(schema_table_key(existing_rel), existing_id)
         |> add_relation(id, rel)}
    end
  end

  defp schema_table_key(%Relation{schema: schema, table: table}), do: {schema, table}
  defp schema_table_key(nil), do: nil

  defp add_relation(state, id, rel) do
    state
    |> put_in([:table_to_id, schema_table_key(rel)], id)
    |> put_in([:id_to_table_info, id], rel)
  end

  defp delete_tracked_relation(state, schema_table, id) do
    state
    |> update_in([:table_to_id], &Map.delete(&1, schema_table))
    |> update_in([:id_to_table_info], &Map.delete(&1, id))
  end

  defp find_differing_columns(%Relation{columns: old_cols}, %Relation{columns: new_cols})
       when old_cols == new_cols,
       do: []

  defp find_differing_columns(%Relation{columns: old_cols}, %Relation{columns: new_cols}) do
    (old_cols ++ new_cols)
    |> Enum.reduce(%{}, fn
      %{name: name, type_oid: type_oid}, acc when is_map_key(acc, name) ->
        # We're seeing column with this name for a second time, so we can remove it from the diff if type oid is the same
        if acc[name] == type_oid, do: Map.delete(acc, name), else: acc

      %{name: name, type_oid: type_oid}, acc ->
        # If we're seeing column with this name for a first time, it'll either stay if it's present only in one set,
        # or be deleted if seen again
        Map.put(acc, name, type_oid)
    end)
    |> Map.keys()
  end
end
