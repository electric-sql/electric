defmodule Electric.FatalErrorTest do
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
  end
end
