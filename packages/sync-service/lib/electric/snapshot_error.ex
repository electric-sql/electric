defmodule Electric.SnapshotError do
  require Logger

  alias Electric.SnapshotError

  defexception [:message, :type, :original_error]

  def table_lock_timeout do
    %SnapshotError{
      type: :table_lock_timeout,
      message: "Snapshot timed out while waiting for a table lock"
    }
  end

  def from_error(%DBConnection.ConnectionError{reason: :queue_timeout} = error) do
    %SnapshotError{
      type: :queue_timeout,
      message: "Snapshot creation failed because of a connection pool queue timeout",
      original_error: error
    }
  end

  def from_error(%Postgrex.Error{postgres: %{code: code}} = error)
      when code in ~w|undefined_function undefined_table undefined_column|a do
    %SnapshotError{
      type: :schema_changed,
      message: "Schema changed while creating snapshot",
      original_error: error
    }
  end

  def from_error(%Postgrex.Error{postgres: %{code: :insufficient_privilege}} = error) do
    %SnapshotError{
      type: :missing_privilege,
      message: error.postgres.message,
      original_error: error
    }
  end

  def from_error(%Postgrex.Error{} = error) do
    %SnapshotError{
      type: :unknown,
      message: error.postgres.message,
      original_error: error
    }
  end

  def from_error(error) do
    %SnapshotError{
      type: :unknown,
      message: error.message,
      original_error: error
    }
  end
end
