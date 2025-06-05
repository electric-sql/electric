defmodule Electric.SnapshotError do
  require Logger

  alias Electric.DbConnectionError
  alias Electric.SnapshotError

  defexception [:message, :type]

  def table_lock_timeout do
    %SnapshotError{
      type: :table_lock_timeout,
      message: "Timed out while waiting for a table lock"
    }
  end

  def from_error(error) do
    case DbConnectionError.from_error(error) do
      %{type: :unknown} ->
        snapshot_error(error)

      error ->
        %SnapshotError{
          message: error.message,
          type: error.type
        }
    end
  end

  defp snapshot_error(%DBConnection.ConnectionError{reason: :queue_timeout}) do
    %SnapshotError{
      type: :queue_timeout,
      message: "Snapshot creation failed because of a connection pool queue timeout"
    }
  end

  defp snapshot_error(%Postgrex.Error{postgres: %{code: code}})
       when code in ~w|undefined_function undefined_table undefined_column|a do
    %SnapshotError{
      type: :schema_changed,
      message: "Schema changed while creating snapshot"
    }
  end

  defp snapshot_error(error) do
    Logger.error("Electric.SnapshotError unknown error: #{inspect(error)}")

    %SnapshotError{
      type: :unknown,
      message: "Unknown error while creating snapshot: #{inspect(error)}"
    }
  end
end
