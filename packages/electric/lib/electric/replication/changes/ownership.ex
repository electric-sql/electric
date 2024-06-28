defmodule Electric.Replication.Changes.Ownership do
  alias Electric.Replication.Changes
  alias Electric.Satellite.Auth

  @user_id_column "electric_user_id"

  @spec id_column_name() :: Changes.db_identifier()
  def id_column_name, do: @user_id_column

  @doc """
  Given a change, checks if belongs to the given user_id.

  For a change to belong to a user with id `user_id` the row must satisfy one of the conditions:

  1. The table being modified has an `#{@user_id_column}` and the value of this column either
     matches provided `user_id`, or the column value is `""` or `NULL`.
  2. The table being modified does not have an `#{@user_id_column}` column. This would be classified
     as a "global" table where all entries are visible by everyone.
  """
  @spec change_belongs_to_user?(Changes.change(), Auth.user_id(), Changes.db_identifier()) ::
          boolean()
  def change_belongs_to_user?(change, user_id, owner_column \\ @user_id_column)

  def change_belongs_to_user?(%Changes.DeletedRecord{old_record: record}, user_id, owner_column) do
    validate_record(record, user_id, owner_column)
  end

  def change_belongs_to_user?(%{record: record}, user_id, owner_column) do
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
