defmodule Electric.DDLX.SqlReprTest do
  use ExUnit.Case, async: true

  import Electric.DDLX.Command.Common

  describe "sql_repr1/" do
    test "strings" do
      assert sql_repr("this") == "'this'"
    end

    test "escaping quotes" do
      assert sql_repr("don't do this") == "'don''t do this'"
    end

    test "list of strings" do
      assert sql_repr(["don't", "do", "this"]) == "ARRAY['don''t', 'do', 'this']"
    end

    test "integer" do
      assert sql_repr(10) == "10"
    end
  end
end
