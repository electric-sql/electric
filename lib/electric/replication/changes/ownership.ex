defmodule Electric.Replication.Changes.Ownership do
  alias Electric.Replication.Changes

  @user_id_column "electric_user_id"

  @spec id_column_name() :: binary()
  def id_column_name, do: @user_id_column

  @spec belongs_to_user?(Changes.Transaction.t(), binary()) :: boolean()
  def belongs_to_user?(transaction, user_id) do
    # FIXME: for now we hard-code the user id column for a table to be `electric_user_id`
    Enum.all?(transaction.changes, &change_belongs_to_user?(&1, user_id, @user_id_column))
  end

  # FIXME: this requires that all tables in the schema have a `electric_user_id` column.
  @spec change_belongs_to_user?(Changes.change(), binary(), binary()) :: boolean()
  defp change_belongs_to_user?(%Changes.DeletedRecord{old_record: record}, user_id, owner_column) do
    validate_record(record, user_id, owner_column)
  end

  defp change_belongs_to_user?(%{record: record}, user_id, owner_column) do
    validate_record(record, user_id, owner_column)
  end

  @empty [nil, ""]

  defp validate_record(record, user_id, owner_column) do
    case record do
      %{^owner_column => ^user_id} -> true
      %{^owner_column => empty} when empty in @empty -> true
      %{^owner_column => _other_id} -> false
      _global -> true
    end
  end
end
