defmodule Electric.Satellite.WriteValidation.ImmutablePrimaryKey do
  use Electric.Satellite.WriteValidation

  alias Electric.Postgres.Extension.SchemaLoader

  def validate_update(%UpdatedRecord{} = change, schema_version) do
    %{relation: relation, changed_columns: changed} = change

    if Enum.empty?(changed) do
      :ok
    else
      {:ok, pks} = SchemaLoader.Version.primary_keys(schema_version, relation)

      case Enum.filter(pks, &MapSet.member?(changed, &1)) do
        [] ->
          :ok

        changed_pks ->
          {:error,
           "Attempt to update table #{Electric.Utils.inspect_relation(relation)} primary key(s) #{inspect(changed_pks)}"}
      end
    end
  end
end
