defmodule Electric.Postgres.Inspector.DirectInspectorTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Inspector.DirectInspector

  describe "normalize_query_error/1" do
    test "classifies connection-class errors as :connection_not_available" do
      for message <- ["ssl recv: closed", "tcp recv: closed", "ssl connect: closed"] do
        error = %DBConnection.ConnectionError{message: message}

        assert {:error, :connection_not_available} =
                 DirectInspector.normalize_query_error(error)
      end
    end

    test "stringifies unknown connection errors" do
      error = %DBConnection.ConnectionError{message: "something inexplicable"}

      assert {:error, "something inexplicable"} = DirectInspector.normalize_query_error(error)
    end

    test "stringifies server-side errors" do
      error = %Postgrex.Error{
        postgres: %{
          code: :out_of_memory,
          pg_code: "53200",
          message: "out of memory",
          severity: "ERROR",
          unknown: "ERROR"
        }
      }

      assert {:error, message} = DirectInspector.normalize_query_error(error)
      assert message =~ "out of memory"
      assert is_binary(message)
    end
  end
end
