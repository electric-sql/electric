defmodule Electric.DbConnectionError do
  defexception [:message, :type, :original_error, :retry_may_fix?]

  alias Electric.DbConnectionError

  def from_error(error) do
    case connection_error(error) do
      nil ->
        {:error, :not_recognised}

      connection_error ->
        {:ok, connection_error}
    end
  end

  defp connection_error(
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

  defp connection_error(%DBConnection.ConnectionError{message: message} = error)
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

  defp connection_error(%DBConnection.ConnectionError{} = error) do
    maybe_nxdomain_error(error) || maybe_connection_refused_error(error)
  end

  defp connection_error(%Postgrex.Error{postgres: %{code: :invalid_password}} = error) do
    %DbConnectionError{
      message: error.postgres.message,
      type: :invalid_username_or_password,
      original_error: error,
      retry_may_fix?: false
    }
  end

  defp connection_error(_error), do: nil

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
