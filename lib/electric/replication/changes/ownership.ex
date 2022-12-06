defmodule Electric.Replication.Changes.Ownership do
  alias Electric.Replication.Changes
  alias Electric.Satellite.Auth

  @user_id_column "electric_user_id"

  @spec id_column_name() :: Changes.db_identifier()
  def id_column_name, do: @user_id_column

  @doc """
  Given a `%Changes.Transaction{}` checks each update within it to verify that they all belong to
  the given user_id.

  If any of the changes fail this test then the transaction is deemed not to belong to the user.

  For a change to belong to a user with id `user_id` every changed row has to satisfy one of the
  following conditions:

  1. The table being modified has an `electric_user_id` and the value of this column is either
     `user_id`, `""` or `NULL`.

  2. The table being modified does not have an `electric_user_id` column. This would be classified
     as a "global" table where all entries are visible by everyone.
  """
  @spec belongs_to_user?(Changes.Transaction.t(), Auth.user_id()) :: boolean()
  def belongs_to_user?(transaction, user_id) do
    # FIXME: for now we hard-code the user id column for a table to be `electric_user_id`
    Enum.all?(transaction.changes, &change_belongs_to_user?(&1, user_id, @user_id_column))
  end

  @spec change_belongs_to_user?(Changes.change(), Auth.user_id(), Changes.db_identifier()) ::
          boolean()
  defp change_belongs_to_user?(%Changes.DeletedRecord{old_record: record}, user_id, owner_column) do
    validate_record(record, user_id, owner_column)
  end

  defp change_belongs_to_user?(%{record: record}, user_id, owner_column) do
    validate_record(record, user_id, owner_column)
  end

  @empty [nil, ""]

  @spec validate_record(Changes.record(), Auth.user_id(), Changes.db_identifier()) :: boolean()
  defp validate_record(record, user_id, owner_column) do
    case record do
      %{^owner_column => ^user_id} -> true
      %{^owner_column => empty} when empty in @empty -> true
      %{^owner_column => _other_id} -> false
      _global -> true
    end
  end
end
