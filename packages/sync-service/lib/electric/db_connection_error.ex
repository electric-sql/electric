defmodule Electric.DbConnectionError do
  require Logger

  defexception [:message, :type, :original_error, :retry_may_fix?]

  alias Electric.DbConnectionError

  def from_error(
        %DBConnection.ConnectionError{message: "tcp recv: connection timed out - :etimedout"} =
          error
      ) do
    %DbConnectionError{
      message: "connection timed out while trying to connect to the database",
      type: :connection_timeout,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(%DBConnection.ConnectionError{message: message} = error)
      when message in [
             "tcp recv (idle): closed",
             "ssl recv (idle): closed",
             "tcp recv: closed",
             "ssl recv: closed"
           ] do
    %DbConnectionError{
      message: "connection closed while connecting to the database",
      type: :connection_closed,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(%DBConnection.ConnectionError{} = error) do
    maybe_nxdomain_error(error) || maybe_connection_refused_error(error)
  end

  def from_error(%Postgrex.Error{postgres: %{code: :invalid_password}} = error) do
    %DbConnectionError{
      message: error.postgres.message,
      type: :invalid_username_or_password,
      original_error: error,
      retry_may_fix?: false
    }
  end

  def from_error(_error), do: nil

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
