defmodule Electric.DbConnectionError do
  alias Electric.DbConfigurationError
  alias Electric.DbConnectionError

  require Logger

  defexception [
    :message,
    :type,
    :original_error,
    :retry_may_fix?,
    drop_slot_and_restart?: false
  ]

  @type t() :: %{
          message: String.t(),
          type: atom(),
          original_error: any(),
          retry_may_fix?: boolean(),
          drop_slot_and_restart?: boolean()
        }

  def from_error(%DbConnectionError{} = error), do: error

  def from_error(%DBConnection.ConnectionError{message: message} = error)
      when message in [
             "tcp recv (idle): closed",
             "ssl recv (idle): closed",
             "tcp recv: closed",
             "ssl recv: closed",
             "ssl connect: closed",
             "tcp async recv: closed",
             "ssl async recv: closed",
             "tcp async_recv: closed",
             "ssl async_recv: closed"
           ] do
    %DbConnectionError{
      message: "connection closed while connecting to the database",
      type: :connection_closed,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(%DBConnection.ConnectionError{message: message} = error)
      when message in [
             "tcp recv: connection timed out - :etimedout",
             "tcp recv (idle): timeout",
             "ssl recv (idle): timeout",
             "ssl async_recv: timeout",
             "tcp async_recv: timeout",
             "tcp recv: timeout",
             "ssl recv: timeout"
           ] do
    %DbConnectionError{
      message: "connection timed out",
      type: :connection_timeout,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(%DBConnection.ConnectionError{message: message} = error)
      when message in [
             "tcp send: closed",
             "ssl send: closed"
           ] do
    %DbConnectionError{
      message: "connection closed while talking to the database",
      type: :connection_closed,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(%DBConnection.ConnectionError{} = error) do
    maybe_nxdomain_error(error) ||
      maybe_connection_refused_error(error) ||
      maybe_ssl_connection_error(error) ||
      maybe_connection_timeout_error(error) ||
      maybe_pool_queue_timeout_error(error) ||
      maybe_client_exit_error(error) ||
      unknown_error(error)
  end

  def from_error(
        %Postgrex.Error{
          postgres: %{code: :object_not_in_prerequisite_state, message: msg, pg_code: "55000"}
        } = error
      )
      when msg == "logical decoding requires wal_level >= logical" or
             msg == "logical decoding requires \"wal_level\" >= \"logical\"" do
    %DbConnectionError{
      message:
        "Electric requires wal_level >= logical. See https://electric-sql.com/docs/guides/deployment#_1-running-postgres",
      type: :wal_level_is_not_logical,
      original_error: error,
      retry_may_fix?: false
    }
  end

  def from_error(
        %Postgrex.Error{
          postgres: %{
            code: :object_not_in_prerequisite_state,
            detail:
              "This slot has been invalidated because it exceeded the maximum reserved size."
          }
        } = error
      ) do
    %DbConnectionError{
      message: """
      Couldn't start replication: slot has been invalidated because it exceeded the maximum reserved size.
        In order to recover consistent replication, the slot will be dropped along with all existing shapes.
        If you're seeing this message without having recently stopped Electric for a while,
        it's possible either Electric is lagging behind and you might need to scale up,
        or you might need to increase the `max_slot_wal_keep_size` parameter of the database.
      """,
      type: :database_slot_exceeded_max_size,
      original_error: error,
      retry_may_fix?: false,
      drop_slot_and_restart?: true
    }
  end

  def from_error(
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
    %DbConnectionError{
      message:
        "Replication slot already in use by another database connection, possibly external to Electric.",
      type: :replication_slot_in_use,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(
        %Postgrex.Error{
          postgres: %{
            code: :insufficient_privilege,
            detail: "Only roles with the REPLICATION attribute may start a WAL sender process."
          }
        } = error
      ) do
    %DbConnectionError{
      message:
        "User does not have the REPLICATION attribute. See https://electric-sql.com/docs/guides/deployment#_1-running-postgres",
      type: :insufficient_privileges,
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

  def from_error(%Postgrex.Error{postgres: %{code: :admin_shutdown, severity: "FATAL"}} = error) do
    %DbConnectionError{
      message: error.postgres.message,
      type: :database_server_shutting_down,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(
        %Postgrex.Error{postgres: %{code: :cannot_connect_now, severity: "FATAL"}} = error
      ) do
    %DbConnectionError{
      message: error.postgres.message,
      type: :database_server_unavailable,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(
        %Postgrex.Error{
          postgres: %{code: :too_many_connections, severity: "FATAL", pg_code: "53300"}
        } = error
      ) do
    %DbConnectionError{
      message: error.postgres.message,
      type: :insufficient_resources,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(
        %Postgrex.Error{
          postgres: %{code: :connection_failure, severity: "FATAL", pg_code: "08006"}
        } = error
      ) do
    %DbConnectionError{
      message: error.postgres.message,
      type: :connection_failure,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(
        %Postgrex.Error{
          postgres: %{
            code: :internal_error,
            message:
              "remaining connection slots are reserved for roles with the SUPERUSER attribute",
            severity: "ERROR",
            pg_code: "XX000"
          }
        } = error
      ) do
    %DbConnectionError{
      message: error.postgres.message,
      type: :insufficient_resources,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(%Postgrex.Error{message: "ssl not available"} = error) do
    %DbConnectionError{
      message: "Database server not configured to accept SSL connections",
      type: :connection_closed,
      original_error: error,
      retry_may_fix?: false
    }
  end

  def from_error(
        %Postgrex.Error{
          postgres: %{
            code: :protocol_violation,
            message: "server conn crashed?",
            severity: "FATAL",
            pg_code: "08P01"
          }
        } = error
      ) do
    %DbConnectionError{
      message: "Server connection crashed",
      type: :server_connection_crashed,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(
        %Postgrex.Error{
          postgres: %{
            code: :query_canceled,
            message: "canceling statement due to user request",
            severity: "ERROR",
            pg_code: "57014"
          }
        } = error
      ) do
    %DbConnectionError{
      message: error.postgres.message,
      type: :query_canceled,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(
        %Postgrex.Error{
          postgres: %{
            code: :undefined_object,
            message: "publication" <> _,
            severity: "ERROR",
            pg_code: "42704"
          }
        } = error
      ) do
    %DbConnectionError{
      message: """
      The publication was expected to be present but was not found.
      Publications and replication slots created by Electric should not
      be manually modified or deleted, as it breaks replication integrity.
      """,
      type: :missing_publication,
      original_error: error,
      retry_may_fix?: true
    }
  end

  def from_error(%Postgrex.Error{postgres: %{code: :internal_error, pg_code: "XX000"}} = error) do
    maybe_database_does_not_exist(error) ||
      maybe_endpoint_does_not_exist(error) ||
      maybe_compute_quota_exceeded(error) ||
      maybe_data_transfer_quota_exceeded(error) ||
      maybe_password_authentication_failed(error) ||
      maybe_pooler_login_error(error) ||
      unknown_error(error)
  end

  def from_error(
        %Postgrex.Error{postgres: %{code: :invalid_catalog_name, pg_code: "3D000"}} = error
      ) do
    maybe_database_does_not_exist(error) || unknown_error(error)
  end

  def from_error(%Postgrex.Error{postgres: %{code: :syntax_error, pg_code: "42601"}} = error) do
    %DbConnectionError{
      message: error.postgres.message,
      type: :syntax_error,
      original_error: error,
      retry_may_fix?: false
    }
  end

  def from_error({:irrecoverable_slot, {type, message}} = error) do
    %DbConnectionError{
      message: message,
      type: type,
      original_error: error,
      retry_may_fix?: false,
      drop_slot_and_restart?: true
    }
  end

  def from_error(%DbConfigurationError{} = error) do
    %DbConnectionError{
      message: error.message,
      type: :config_error,
      original_error: error,
      retry_may_fix?: false
    }
  end

  if Mix.env() == :test do
    def from_error(:shutdown) do
      %DbConnectionError{
        message: "Test database connection has been shutdown",
        type: :shutdown,
        original_error: :shutdown,
        # We don't want for this error to be treated as fatal because what would interfere with the
        # supervision startup/shutdown setup in tests. We just treat it as a retryable DB error
        # and let the test code control supervision tree orchestration.
        retry_may_fix?: true
      }
    end
  end

  def from_error(error), do: unknown_error(error)

  def format_original_error(%DbConnectionError{original_error: %DbConfigurationError{} = error}) do
    Exception.format(:error, error)
  end

  def format_original_error(%DbConnectionError{original_error: error}) do
    inspect(error, pretty: true)
  end

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

  defp maybe_endpoint_does_not_exist(error) do
    case error.postgres.message do
      "The requested endpoint could not be found, or you don't have access to it" <> _ ->
        %DbConnectionError{
          message: error.postgres.message,
          type: :endpoint_not_found,
          original_error: error,
          retry_may_fix?: false
        }

      _ ->
        nil
    end
  end

  defp maybe_compute_quota_exceeded(error) do
    case error.postgres.message do
      "Your account or project has exceeded the compute time quota" <> _ ->
        %DbConnectionError{
          message: error.postgres.message,
          type: :compute_quota_exceeded,
          original_error: error,
          retry_may_fix?: false
        }

      _ ->
        nil
    end
  end

  defp maybe_data_transfer_quota_exceeded(error) do
    case error.postgres.message do
      "Your project has exceeded the data transfer quota." <> _ ->
        %DbConnectionError{
          message: error.postgres.message,
          type: :data_transfer_quota_exceeded,
          original_error: error,
          retry_may_fix?: false
        }

      _ ->
        nil
    end
  end

  defp maybe_password_authentication_failed(error) do
    if Regex.match?(~r/^password authentication failed for user '.*'$/, error.postgres.message) do
      %DbConnectionError{
        message: error.postgres.message,
        type: :invalid_username_or_password,
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
          retry_may_fix?: true
        }

      _ ->
        nil
    end
  end

  defp maybe_pooler_login_error(error) do
    if Regex.match?(
         ~r/^server login has been failing, cached error: connect failed \(server_login_retry\)$/,
         error.postgres.message
       ) do
      %DbConnectionError{
        message: error.postgres.message,
        type: :pooler_login_failed,
        original_error: error,
        retry_may_fix?: true
      }
    end
  end

  defp maybe_ssl_connection_error(error) do
    case error.message do
      "ssl connect: " <> message ->
        if String.contains?(message, [
             "Unknown CA",
             "unknown_ca",
             "Bad Certificate",
             "Invalid CA certificate file"
           ]) do
          %DbConnectionError{
            message: "SSL connection failed to verify server certificate: " <> message,
            type: :ssl_connection_failed,
            original_error: error,
            retry_may_fix?: false
          }
        end

      _ ->
        nil
    end
  end

  defp maybe_connection_timeout_error(error) do
    ~r/tcp connect \((?<destination>.*)\): (?:timeout|connection timed out - :etimedout)/
    |> Regex.named_captures(error.message)
    |> case do
      %{"destination" => destination} ->
        %DbConnectionError{
          message: "connection timed out while trying to connect to #{destination}",
          type: :connection_timeout,
          original_error: error,
          retry_may_fix?: true
        }

      _ ->
        nil
    end
  end

  defp maybe_pool_queue_timeout_error(error) do
    if Regex.match?(
         ~r/^client #PID<\d+.\d+.\d+> timed out because it queued and checked out the connection for longer than \d+ms/,
         error.message
       ) do
      %DbConnectionError{
        message: "timed out trying to acquire connection from pool",
        type: :connection_timeout,
        original_error: error,
        retry_may_fix?: true
      }
    end
  end

  defp maybe_client_exit_error(
         %DBConnection.ConnectionError{message: message, severity: :info, reason: :error} = error
       ) do
    if Regex.match?(~r/^client #PID<\d+.\d+.\d+> exited$/, message) do
      %DbConnectionError{
        message: "connection exited",
        type: :client_exit,
        original_error: error,
        retry_may_fix?: true
      }
    end
  end

  defp maybe_client_exit_error(_), do: nil
end
