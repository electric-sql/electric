defmodule Electric.Replication.Changes do
  defmodule(Transaction, do: defstruct([:changes, :commit_timestamp]))
  defmodule(NewRecord, do: defstruct([:relation, :record]))
  defmodule(UpdatedRecord, do: defstruct([:relation, :old_record, :record]))
  defmodule(DeletedRecord, do: defstruct([:relation, :old_record]))
  defmodule(TruncatedRelation, do: defstruct([:relation]))
end

defprotocol Electric.Replication.ToVaxine do
  @spec handle_change(change :: term()) :: :ok | {:error, reason :: term()}
  def handle_change(change)
end

defimpl Electric.Replication.ToVaxine, for: Electric.Replication.Changes.NewRecord do
  alias Electric.Replication.Row

  def handle_change(%{record: record, relation: {schema, table}}) do
    row = Row.new(schema, table, record)

    case Electric.VaxRepo.insert(row) do
      {:ok, _} -> :ok
      error -> error
    end
  end
end

defimpl Electric.Replication.ToVaxine, for: Electric.Replication.Changes.UpdatedRecord do
  alias Electric.Replication.Row

  def handle_change(%{old_record: old_record, record: new_record, relation: {schema, table}}) do
    schema
    |> Row.new(table, old_record)
    |> Ecto.Changeset.change(row: new_record)
    |> Electric.VaxRepo.update()
    |> case do
      {:ok, _} -> :ok
      error -> error
    end
  end
end
