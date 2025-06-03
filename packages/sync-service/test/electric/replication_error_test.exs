defmodule Electric.ReplicationErrorTest do
  use ExUnit.Case, async: true

  alias Electric.ReplicationError

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

      assert %ReplicationError{
               message: ~s|password authentication failed for user "postgres"|,
               type: :invalid_username_or_password,
               original_error: error,
               retry_may_fix?: false
             } == ReplicationError.from_error(error)
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

      assert %ReplicationError{
               message: "User does not have the REPLICATION attribute. " <> _,
               type: :insufficient_privileges,
               original_error: ^error,
               retry_may_fix?: false
             } = ReplicationError.from_error(error)
    end

    test "with an invalid domain error" do
      error = %DBConnection.ConnectionError{
        message: "tcp connect (dbserver.example:5555): non-existing domain - :nxdomain",
        severity: :error,
        reason: :error
      }

      assert %ReplicationError{
               message: "domain does not exist: dbserver.example",
               type: :nxdomain,
               original_error: error,
               retry_may_fix?: false
             } == ReplicationError.from_error(error)
    end

    test "with a tcp timeout error" do
      error = %DBConnection.ConnectionError{
        message: "tcp recv: connection timed out - :etimedout",
        severity: :error,
        reason: :error
      }

      assert %ReplicationError{
               message: "connection timed out while trying to connect to the database",
               type: :connection_timeout,
               original_error: error,
               retry_may_fix?: true
             } == ReplicationError.from_error(error)
    end

    test "with tcp closed error" do
      error = %DBConnection.ConnectionError{
        message: "tcp recv (idle): closed",
        severity: :error,
        reason: :error
      }

      assert %ReplicationError{
               message: "connection closed while connecting to the database",
               type: :connection_closed,
               original_error: error,
               retry_may_fix?: true
             } == ReplicationError.from_error(error)
    end

    test "with a connection refused error" do
      error = %DBConnection.ConnectionError{
        message: "tcp connect (localhost:54321): connection refused - :econnrefused",
        severity: :error,
        reason: :error
      }

      assert %ReplicationError{
               message: "connection refused while trying to connect to localhost:54321",
               type: :connection_refused,
               original_error: error,
               retry_may_fix?: false
             } == ReplicationError.from_error(error)
    end
  end
end
