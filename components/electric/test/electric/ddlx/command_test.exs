defmodule Electric.DDLX.CommandTest do
  use ExUnit.Case, async: true

  alias Electric.DDLX
  alias Electric.DDLX.Command
  alias Electric.Satellite.SatPerms

  def parse(sql) do
    assert {:ok, cmd} = DDLX.Parser.parse(sql)
    cmd
  end

  def pg_sql(ddlx, ddl \\ []) do
    ddlx
    |> parse()
    |> Command.proxy_sql(ddl, fn sql -> "$$" <> sql <> "$$" end)
  end

  def parse_pb(hex) do
    [hex, "::bytea" <> _] = String.split(hex, "'")
    {:ok, bytes} = Base.decode16(hex)
    assert {:ok, ddlx} = Protox.decode(bytes, SatPerms.DDLX)
    ddlx
  end

  describe "pg_sql/1" do
    test "ELECTRIC ENABLE" do
      ddlx = "ALTER TABLE my_table ENABLE ELECTRIC"

      ddl = "CREATE TABLE public.my_table (id uuid PRIMARY KEY)"

      assert pg_sql(ddlx, [ddl]) == [
               "CALL electric.electrify_with_ddl('public', 'my_table', $$#{ddl}$$);\n"
             ]
    end

    test "ELECTRIC ASSIGN" do
      ddlx = "ELECTRIC ASSIGN (projects, memberships.role) TO memberships.user_id"

      assert [] = pg_sql(ddlx)
    end

    test "ELECTRIC UNASSIGN" do
      ddlx = "ELECTRIC UNASSIGN (projects, memberships.role) FROM memberships.user_id"

      assert [] = pg_sql(ddlx)
    end

    test "ELECTRIC GRANT" do
      ddlx = "ELECTRIC GRANT INSERT ON issues TO (projects, 'member')"

      assert [] = pg_sql(ddlx)
    end

    test "ELECTRIC REVOKE" do
      ddlx = "ELECTRIC REVOKE INSERT ON issues FROM (projects, 'member')"

      assert [] = pg_sql(ddlx)
    end
  end
end
