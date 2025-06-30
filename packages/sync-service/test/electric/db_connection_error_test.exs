defmodule Electric.DbConnectionErrorTest do
  use ExUnit.Case, async: true

  alias Electric.DbConnectionError

  describe "from_error/1" do
    test "with an invalid username or password error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :invalid_password,
          line: "321",
          message: ~s|password authentication failed for user "postgres"|,
          file: "auth.c",
          unknown: "FATAL",
          severity: "FATAL",
          pg_code: "28P01",
          routine: "auth_failed"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message: ~s|password authentication failed for user "postgres"|,
               type: :invalid_username_or_password,
               original_error: error,
               retry_may_fix?: false
             } == DbConnectionError.from_error(error)
    end

    test "with insufficient privileges error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :insufficient_privilege,
          line: "994",
          message: "permission denied to start WAL sender",
          file: "postinit.c",
          unknown: "FATAL",
          severity: "FATAL",
          detail: "Only roles with the REPLICATION attribute may start a WAL sender process.",
          pg_code: "42501",
          routine: "InitPostgres"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message: "User does not have the REPLICATION attribute. " <> _,
               type: :insufficient_privileges,
               original_error: ^error,
               retry_may_fix?: false
             } = DbConnectionError.from_error(error)
    end

    test "with an invalid domain error" do
      error = %DBConnection.ConnectionError{
        message: "tcp connect (dbserver.example:5555): non-existing domain - :nxdomain",
        severity: :error,
        reason: :error
      }

      assert %DbConnectionError{
               message: "domain does not exist: dbserver.example",
               type: :nxdomain,
               original_error: error,
               retry_may_fix?: false
             } == DbConnectionError.from_error(error)
    end

    test "with a tcp timeout error" do
      for message <- [
            "tcp recv: connection timed out - :etimedout",
            "ssl recv (idle): timeout",
            "tcp recv: timeout"
          ] do
        error = %DBConnection.ConnectionError{
          message: message,
          severity: :error,
          reason: :error
        }

        assert %DbConnectionError{
                 message: "connection timed out",
                 type: :connection_timeout,
                 original_error: error,
                 retry_may_fix?: true
               } == DbConnectionError.from_error(error)
      end
    end

    test "with tcp closed error" do
      for message <- [
            "tcp recv (idle): closed",
            "ssl recv (idle): closed",
            "tcp recv: closed",
            "ssl recv: closed",
            "ssl async_recv: closed"
          ] do
        error = %DBConnection.ConnectionError{
          message: message,
          severity: :error,
          reason: :error
        }

        assert %DbConnectionError{
                 message: "connection closed while connecting to the database",
                 type: :connection_closed,
                 original_error: error,
                 retry_may_fix?: true
               } == DbConnectionError.from_error(error)
      end
    end

    test "with a connection refused error" do
      error = %DBConnection.ConnectionError{
        message: "tcp connect (localhost:54321): connection refused - :econnrefused",
        severity: :error,
        reason: :error
      }

      assert %DbConnectionError{
               message: "connection refused while trying to connect to localhost:54321",
               type: :connection_refused,
               original_error: error,
               retry_may_fix?: false
             } == DbConnectionError.from_error(error)
    end

    test "with compute quota exceeded error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :internal_error,
          message:
            "Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits.",
          unknown: "FATAL",
          severity: "FATAL",
          pg_code: "XX000"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message:
                 "Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits.",
               type: :compute_quota_exceeded,
               original_error: error,
               retry_may_fix?: false
             } == DbConnectionError.from_error(error)
    end
  end
end
