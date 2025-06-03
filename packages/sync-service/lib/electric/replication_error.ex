defmodule Electric.ReplicationError do
  require Logger

  defexception [:message, :type, :original_error, :retry_may_fix?]

  alias Electric.DbConnectionError
  alias Electric.ReplicationError

  def from_error(error) do
    case DbConnectionError.from_error(error) do
      {:ok, error} ->
        %ReplicationError{
          message: error.message,
          type: error.type,
          original_error: error.original_error,
          retry_may_fix?: error.retry_may_fix?
        }

      {:error, :not_recognised} ->
        replication_error(error)
    end
  end

  defp replication_error(
         %Postgrex.Error{
           postgres: %{code: :object_not_in_prerequisite_state, message: msg, pg_code: "55000"}
         } = error
       )
       when msg == "logical decoding requires wal_level >= logical" or
              msg == "logical decoding requires \"wal_level\" >= \"logical\"" do
    %ReplicationError{
      message:
        "Electric requires wal_level >= logical. See https://electric-sql.com/docs/guides/deployment#_1-running-postgres",
      type: :wal_level_is_not_logical,
      original_error: error,
      retry_may_fix?: false
    }
  end

  defp replication_error(
         %Postgrex.Error{
           postgres: %{
             code: :object_not_in_prerequisite_state,
             detail:
               "This slot has been invalidated because it exceeded the maximum reserved size."
           }
         } = error
       ) do
    %ReplicationError{
      message: """
      Couldn't start replication: slot has been invalidated because it exceeded the maximum reserved size.
        In order to recover consistent replication, the slot will be dropped along with all existing shapes.
        If you're seeing this message without having recently stopped Electric for a while,
        it's possible either Electric is lagging behind and you might need to scale up,
        or you might need to increase the `max_slot_wal_keep_size` parameter of the database.
      """,
      type: :replication_slot_invalidated,
      original_error: error,
      retry_may_fix?: false
    }
  end

  defp replication_error(
         %Postgrex.Error{
           postgres: %{
             code: :object_in_use,
             message: "replication slot " <> _,
             severity: "ERROR",
             pg_code: "55006"
           }
         } = error
       ) do
    # The full error message in this case looks like
    # "replication slot \"electric_slot_integration\" is active for PID 83",
    %ReplicationError{
      message:
        "Replication slot already in use by another database connection, possibly external to Electric.",
      type: :replication_slot_in_use,
      original_error: error,
      retry_may_fix?: true
    }
  end

  defp replication_error(
         %Postgrex.Error{
           postgres: %{
             code: :insufficient_privilege,
             detail: "Only roles with the REPLICATION attribute may start a WAL sender process."
           }
         } = error
       ) do
    %ReplicationError{
      message:
        "User does not have the REPLICATION attribute. See https://electric-sql.com/docs/guides/deployment#_1-running-postgres",
      type: :insufficient_privileges,
      original_error: error,
      retry_may_fix?: false
    }
  end

  defp replication_error(
         %Postgrex.Error{postgres: %{code: :syntax_error, pg_code: "42601"}} = error
       ) do
    %ReplicationError{
      message: error.postgres.message,
      type: :syntax_error,
      original_error: error,
      retry_may_fix?: false
    }
  end

  defp replication_error(
         %Postgrex.Error{postgres: %{code: :internal_error, pg_code: "XX000"}} = error
       ) do
    maybe_database_does_not_exist(error) || unknown_error(error)
  end

  defp replication_error(
         %Postgrex.Error{postgres: %{code: :invalid_catalog_name, pg_code: "3D000"}} = error
       ) do
    maybe_database_does_not_exist(error) || unknown_error(error)
  end

  defp replication_error(error), do: unknown_error(error)

  def format_original_error(%ReplicationError{original_error: error}) do
    inspect(error, pretty: true)
  end

  defp maybe_database_does_not_exist(error) do
    if Regex.match?(~r/database ".*" does not exist$/, error.postgres.message) do
      %ReplicationError{
        message: error.postgres.message,
        type: :database_does_not_exist,
        original_error: error,
        retry_may_fix?: false
      }
    end
  end

  defp unknown_error(error) do
    Logger.error("Electric.DBConnection unknown error: #{inspect(error)}")

    %ReplicationError{
      message: inspect(error),
      type: :unknown,
      original_error: error,
      retry_may_fix?: true
    }
  end
end
