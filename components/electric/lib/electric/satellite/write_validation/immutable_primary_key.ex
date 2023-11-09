defmodule Electric.Satellite.WriteValidation.ImmutablePrimaryKey do
  use Electric.Satellite.WriteValidation

  alias Electric.Postgres.Schema

  def is_allowed_update?(%UpdatedRecord{changed_columns: []}, _schema, _schema_loader) do
    :ok
  end

  def is_allowed_update?(%UpdatedRecord{} = change, schema, _schema_loader) do
    %{relation: {sname, tname}, changed_columns: changed} = change
    {:ok, pks} = Schema.primary_keys(schema, sname, tname)

    case Enum.filter(pks, &MapSet.member?(changed, &1)) do
      [] ->
        :ok

      changed_pks ->
        {:error,
         "Attempt to update table #{inspect(sname)}.#{inspect(tname)} primary key(s) #{inspect(changed_pks)}"}
    end
  end
end
