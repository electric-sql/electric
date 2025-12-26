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

    test "with an invalid username or password error (internal)" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :internal_error,
          message: "password authentication failed for user 'foo'",
          severity: "ERROR",
          pg_code: "XX000"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message: ~s|password authentication failed for user 'foo'|,
               type: :invalid_username_or_password,
               original_error: error,
               retry_may_fix?: false
             } == DbConnectionError.from_error(error)
    end

    test "with database does not exist error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :internal_error,
          message: ~s|database "foo" does not exist|,
          severity: "ERROR",
          pg_code: "XX000"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message: ~s|database "foo" does not exist|,
               type: :database_does_not_exist,
               original_error: error,
               retry_may_fix?: false
             } == DbConnectionError.from_error(error)
    end

    test "with endpoint could not be found error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :internal_error,
          message:
            ~s|The requested endpoint could not be found, or you don't have access to it. Please check the provided ID and try again.|,
          severity: "ERROR",
          pg_code: "XX000"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message:
                 ~s|The requested endpoint could not be found, or you don't have access to it. Please check the provided ID and try again.|,
               type: :endpoint_not_found,
               original_error: error,
               retry_may_fix?: false
             } == DbConnectionError.from_error(error)
    end

    test "with too many connections error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :too_many_connections,
          line: "353",
          message:
            "number of requested standby connections exceeds max_wal_senders (currently 5)",
          file: "proc.c",
          unknown: "FATAL",
          severity: "FATAL",
          pg_code: "53300",
          routine: "InitProcess"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message:
                 ~s|number of requested standby connections exceeds max_wal_senders (currently 5)|,
               type: :insufficient_resources,
               original_error: error,
               retry_may_fix?: true
             } == DbConnectionError.from_error(error)
    end

    test "with connection failure from upstream" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :connection_failure,
          message: "connection closed by upstream database",
          unknown: "FATAL",
          severity: "FATAL",
          detail: "The upstream Postgres database has closed the connection.",
          pg_code: "08006"
        },
        connection_id: 8186,
        query: nil
      }

      assert %DbConnectionError{
               message: "connection closed by upstream database",
               type: :connection_failure,
               original_error: error,
               retry_may_fix?: true
             } == DbConnectionError.from_error(error)
    end

    test "with remaining connection slots reserved error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :internal_error,
          message:
            "remaining connection slots are reserved for roles with the SUPERUSER attribute",
          severity: "ERROR",
          pg_code: "XX000"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message:
                 "remaining connection slots are reserved for roles with the SUPERUSER attribute",
               type: :insufficient_resources,
               original_error: error,
               retry_may_fix?: true
             } == DbConnectionError.from_error(error)
    end

    test "with slot exceeded max size error (only on <PG18)" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :object_not_in_prerequisite_state,
          message: "cannot read from logical replication slot \"electric_slot_integration\"",
          detail: "This slot has been invalidated because it exceeded the maximum reserved size.",
          severity: "ERROR",
          pg_code: "55000"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message: "Couldn't start replication: slot has been invalidated" <> _,
               type: :database_slot_exceeded_max_size,
               original_error: ^error,
               retry_may_fix?: false,
               drop_slot_and_restart?: true
             } = DbConnectionError.from_error(error)
    end

    test "with slot invalidated and wal removed (max size exceeded >=PG18)" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :object_not_in_prerequisite_state,
          message: "can no longer access replication slot \"electric_slot_integration\"",
          detail: "This replication slot has been invalidated due to \"wal_removed\".",
          severity: "ERROR",
          pg_code: "55000"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message:
                 "Couldn't start replication: slot has been invalidated with reason \"wal_removed\"." <>
                   _,
               type: :database_slot_invalidated,
               original_error: ^error,
               retry_may_fix?: false,
               drop_slot_and_restart?: true
             } = DbConnectionError.from_error(error)
    end

    test "with server connection crashed error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :protocol_violation,
          message: "server conn crashed?",
          severity: "FATAL",
          pg_code: "08P01"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message: "Server connection crashed",
               type: :server_connection_crashed,
               original_error: error,
               retry_may_fix?: true
             } == DbConnectionError.from_error(error)
    end

    test "with query cancelled error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :query_canceled,
          message: "canceling statement due to user request",
          severity: "ERROR",
          pg_code: "57014"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message: "canceling statement due to user request",
               type: :query_canceled,
               original_error: error,
               retry_may_fix?: true
             } == DbConnectionError.from_error(error)
    end

    test "with publication not found error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :undefined_object,
          message: "publication \"cloud_electric_pub_random_tenant_id\" does not exist",
          severity: "ERROR",
          pg_code: "42704"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message: """
               The publication was expected to be present but was not found.
               Publications and replication slots created by Electric should not
               be manually modified or deleted, as it breaks replication integrity.
               """,
               type: :missing_publication,
               original_error: error,
               retry_may_fix?: true
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
            "ssl async_recv: timeout",
            "tcp async_recv: timeout",
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

    test "with a tcp timeout with destination error" do
      for message <- [
            "tcp connect (localhost:54321): connection timed out - :etimedout",
            "tcp connect (localhost:54321): timeout"
          ] do
        error = %DBConnection.ConnectionError{
          message: message,
          severity: :error,
          reason: :error
        }

        assert %DbConnectionError{
                 message: "connection timed out while trying to connect to localhost:54321",
                 type: :connection_timeout,
                 original_error: error,
                 retry_may_fix?: true
               } == DbConnectionError.from_error(error)
      end
    end

    test "with a pool queue timeout error" do
      error = %DBConnection.ConnectionError{
        message:
          "client #PID<0.4201.0> timed out because it queued and checked out the connection for longer than 3000ms\n\n whatever stack trace",
        severity: :error,
        reason: :error
      }

      assert %DbConnectionError{
               message: "timed out trying to acquire connection from pool",
               type: :connection_timeout,
               original_error: error,
               retry_may_fix?: true
             } == DbConnectionError.from_error(error)
    end

    test "with a client exit error" do
      error = %DBConnection.ConnectionError{
        message: "client #PID<0.4201.0> exited",
        severity: :info,
        reason: :error
      }

      assert %DbConnectionError{
               message: "connection exited",
               type: :client_exit,
               original_error: error,
               retry_may_fix?: true
             } == DbConnectionError.from_error(error)
    end

    test "with tcp closed error" do
      for message <- [
            "tcp recv (idle): closed",
            "ssl recv (idle): closed",
            "tcp recv: closed",
            "ssl recv: closed",
            "ssl connect: closed",
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

    test "with a compute node unreachable error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :internal_error,
          message: "Couldn't connect to compute node",
          severity: "ERROR",
          pg_code: "XX000"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message: error.postgres.message,
               type: :compute_node_unreachable,
               original_error: error,
               retry_may_fix?: true
             } == DbConnectionError.from_error(error)
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
               retry_may_fix?: true
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

    test "with data transfer quota exceeded error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :internal_error,
          message:
            "Your project has exceeded the data transfer quota. Upgrade your plan to increase limits.",
          severity: "ERROR",
          pg_code: "XX000"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message:
                 "Your project has exceeded the data transfer quota. Upgrade your plan to increase limits.",
               type: :data_transfer_quota_exceeded,
               original_error: error,
               retry_may_fix?: false
             } == DbConnectionError.from_error(error)
    end

    test "with pooler login failed error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :internal_error,
          message:
            "server login has been failing, cached error: connect failed (server_login_retry)",
          severity: "ERROR",
          pg_code: "XX000"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message:
                 "server login has been failing, cached error: connect failed (server_login_retry)",
               type: :pooler_login_failed,
               original_error: error,
               retry_may_fix?: true
             } == DbConnectionError.from_error(error)
    end

    test "with badkey failed to identify database error" do
      message =
        "Failed to identify your database: Your account has restrictions: planLimitReached. " <>
          "Please contact Prisma support to resolve account restrictions."

      error = {:badkey, :code, %{message: message}}

      assert %DbConnectionError{
               message: message,
               type: :endpoint_not_found,
               original_error: error,
               retry_may_fix?: false
             } == DbConnectionError.from_error(error)
    end

    test "with disk full error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :disk_full,
          message: "could not write init file: No space left on device",
          severity: "FATAL",
          pg_code: "53100",
          routine: "write_item"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message: "could not write init file: No space left on device",
               type: :disk_full,
               original_error: error,
               retry_may_fix?: true
             } == DbConnectionError.from_error(error)
    end

    test "with duplicate slot file error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :duplicate_file,
          message: "could not create file \"slot_file.tmp\": File exists",
          pg_code: "58P02",
          routine: "SaveSlotToPath"
        },
        connection_id: 24414,
        query: nil
      }

      assert %DbConnectionError{
               message: "could not create file \"slot_file.tmp\": File exists",
               type: :duplicate_slot_file,
               original_error: error,
               retry_may_fix?: true
             } == DbConnectionError.from_error(error)
    end

    test "with branch does not exist error" do
      error = %Postgrex.Error{
        message: nil,
        postgres: %{
          code: :invalid_authorization_specification,
          message: "branch 3ibd4pbmos9p does not exist",
          unknown: "FATAL",
          severity: "FATAL",
          pg_code: "28000"
        },
        connection_id: nil,
        query: nil
      }

      assert %DbConnectionError{
               message: "branch 3ibd4pbmos9p does not exist",
               type: :branch_does_not_exist,
               original_error: error,
               retry_may_fix?: false
             } == DbConnectionError.from_error(error)
    end

    test "with an unknown error" do
      error = %DBConnection.ConnectionError{
        message: "made-up error",
        severity: :error,
        reason: :error
      }

      assert %DbConnectionError{
               type: :unknown,
               message:
                 "%DBConnection.ConnectionError{message: \"made-up error\", severity: :error, reason: :error}",
               original_error: error,
               retry_may_fix?: true
             } == DbConnectionError.from_error(error)
    end
  end
end
