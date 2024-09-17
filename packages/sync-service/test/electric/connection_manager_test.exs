defmodule Electric.ConnectionManagerTest do
  use ExUnit.Case, async: true

  alias Electric.ConnectionManager

  describe "Electric.ConnectionManager.State" do
    test "inspect does not leak password" do
      safe_connection_opts = [database: "database", username: "username"]
      unsafe_connection_opts = safe_connection_opts ++ [password: "thepassword"]
      replication_opts = [start_streaming: false, publication_name: "publication_name"]

      state = %ConnectionManager.State{
        connection_opts: unsafe_connection_opts,
        replication_opts: replication_opts
      }

      out = inspect(state, pretty: true)

      assert out =~ ~r/password: "\*/
      refute out =~ ~r/thepassword/

      for {k, v} <- replication_opts ++ safe_connection_opts do
        assert out =~ ~r/#{k}:/
        assert out =~ ~r/#{v}/
      end
    end
  end
end
