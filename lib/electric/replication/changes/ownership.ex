defmodule Electric.Replication.Changes.Ownership do
  alias Electric.Replication.Changes

  @spec belongs_to_user?(Changes.Transaction.t(), binary()) :: boolean()
  def belongs_to_user?(transaction, user_id) do
    # FIXME: for now we hard-code the user id column for a table to be `user_id`
    Enum.all?(transaction.changes, &change_belongs_to_user?(&1, user_id, "user_id"))
  end

  # FIXME: this requires that all tables in the schema have a `user_id` column.
  @spec change_belongs_to_user?(Changes.change(), binary(), binary()) :: boolean()
  defp change_belongs_to_user?(%Changes.DeletedRecord{old_record: record}, user_id, owner_column) do
    record[owner_column] == user_id
  end

  defp change_belongs_to_user?(%{record: record}, user_id, owner_column) do
    record[owner_column] == user_id
  end
end
