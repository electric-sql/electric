defmodule Electric.Postgres.PgParserTest do
  use ExUnit.Case
  use ExUnitProperties

  alias Electric.Postgres.SQLGenerator

  test "parser accepts all the inputs" do
    check all(sql <- SQLGenerator.sql_stream(use_schema: false)) do
      PgQuery.parse!(sql)
    end
  end

  test "parser returns errors" do
    assert {:error, _msg} = PgQuery.parse("please, select something erroneous and wrong")
  end
end
