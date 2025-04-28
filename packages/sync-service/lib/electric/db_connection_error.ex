defmodule Electric.DbConnectionError do
  require Logger

  defexception [:message, :type, :original_error, :retry_may_fix?]

  alias Electric.DbConnectionError

  def from_error(
        %DBConnection.ConnectionError{message: "tcp recv: connection timed out - :etimedout"} =
          error
      ) do
    %DbConnectionError{
      message: "connection timed out",
      type: :connection_timeout,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(%DBConnection.ConnectionError{} = error) do
    maybe_nxdomain_error(error) || maybe_connection_refused_error(error) || unknown_error(error)
  end

  def from_error(
        %Postgrex.Error{
          postgres: %{
            code: :object_not_in_prerequisite_state,
            detail: "This slot has been invalidated" <> _,
            pg_code: "55000"
          }
        } = error
      ) do
    %DbConnectionError{
      message: error.postgres.detail,
      type: :database_slot_invalidated,
      original_error: error,
      retry_may_fix?: false
    }
  end

  def from_error(
        %Postgrex.Error{
          postgres: %{code: :object_not_in_prerequisite_state, message: msg, pg_code: "55000"}
        } = error
      )
      when msg == "logical decoding requires wal_level >= logical" or
             msg == "logical decoding requires \"wal_level\" >= \"logical\"" do
    %DbConnectionError{
      message: msg,
      type: :wal_level_is_not_logical,
      original_error: error,
      retry_may_fix?: false
    }
  end

  def from_error(%Postgrex.Error{postgres: %{code: :invalid_password}} = error) do
    %DbConnectionError{
      message: error.postgres.message,
      type: :invalid_username_or_password,
      original_error: error,
      retry_may_fix?: false
    }
  end

  def from_error(%Postgrex.Error{postgres: %{code: :internal_error, pg_code: "XX000"}} = error) do
    maybe_database_does_not_exist(error) || unknown_error(error)
  end

  def from_error(
        %Postgrex.Error{postgres: %{code: :invalid_catalog_name, pg_code: "3D000"}} = error
      ) do
    maybe_database_does_not_exist(error) || unknown_error(error)
  end

  def from_error(error), do: unknown_error(error)

  defp unknown_error(error) do
    Logger.error("Electric.DBConnection unknown error: #{inspect(error)}")

    %DbConnectionError{
      message: inspect(error),
      type: :unknown,
      original_error: error,
      retry_may_fix?: true
    }
  end

  defp maybe_database_does_not_exist(error) do
    if Regex.match?(~r/database ".*" does not exist$/, error.postgres.message) do
      %DbConnectionError{
        message: error.postgres.message,
        type: :database_does_not_exist,
        original_error: error,
        retry_may_fix?: false
      }
    end
  end

  defp maybe_nxdomain_error(error) do
    ~r/\((?<domain>[^:]+).*\): non-existing domain - :nxdomain/
    |> Regex.named_captures(error.message)
    |> case do
      %{"domain" => domain} ->
        %DbConnectionError{
          message: "domain does not exist: #{domain}",
          type: :nxdomain,
          original_error: error,
          retry_may_fix?: false
        }

      _ ->
        nil
    end
  end

  defp maybe_connection_refused_error(error) do
    ~r/\((?<destination>.*)\): connection refused - :econnrefused/
    |> Regex.named_captures(error.message)
    |> case do
      %{"destination" => destination} ->
        %DbConnectionError{
          message: "connection refused while trying to connect to #{destination}",
          type: :connection_refused,
          original_error: error,
          retry_may_fix?: false
        }

      _ ->
        nil
    end
  end
end
