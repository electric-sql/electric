defmodule Electric.DDLX.CommandTest do
  use ExUnit.Case, async: true

  alias Electric.DDLX
  alias Electric.DDLX.Command
  alias Electric.Satellite.SatPerms

  def parse(sql) do
    assert {:ok, cmd} = DDLX.Parser.parse(sql)
    cmd
  end

  def pg_sql(ddlx) do
    ddlx
    |> parse()
    |> Command.pg_sql()
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

      assert pg_sql(ddlx) == [
               "CALL electric.enable('\"public\".\"my_table\"');\n"
             ]
    end

    test "ELECTRIC ASSIGN" do
      ddlx = "ELECTRIC ASSIGN (projects, memberships.role) TO memberships.user_id"

      assert [
               ~S[INSERT INTO "electric"."ddlx_commands" (ddlx) VALUES ('\x] <> hex,
               ~S[CALL electric.assign(] <> args
             ] = pg_sql(ddlx)

      assert %SatPerms.DDLX{assigns: [assign]} = parse_pb(hex)

      assert %SatPerms.Assign{
               table: %{schema: "public", name: "memberships"},
               scope: %{schema: "public", name: "projects"},
               user_column: "user_id",
               role_column: "role"
             } = assign

      args =
        String.split(args, "\n", trim: true) |> Enum.map(&String.trim/1) |> Enum.slice(0..-2//1)

      assert args == [
               "assignment_id => 'cfl4yau3uwjlscmzukhavbniggdrpenr',",
               "assign_table_full_name => '\"public\".\"memberships\"',",
               "scope => '\"public\".\"projects\"',",
               "user_column_name => 'user_id',",
               "role_name_string => NULL,",
               "role_column_name => 'role',",
               "if_fn => NULL"
             ]
    end

    test "ELECTRIC UNASSIGN" do
      ddlx = "ELECTRIC UNASSIGN (projects, memberships.role) FROM memberships.user_id"

      assert [
               ~S[INSERT INTO "electric"."ddlx_commands" (ddlx) VALUES ('\x] <> hex,
               ~S[CALL electric.unassign(] <> args
             ] = pg_sql(ddlx)

      assert %SatPerms.DDLX{unassigns: [unassign]} = parse_pb(hex)

      assert %SatPerms.Unassign{
               table: %{schema: "public", name: "memberships"},
               scope: %{schema: "public", name: "projects"},
               user_column: "user_id",
               role_column: "role"
             } = unassign

      args =
        String.split(args, "\n", trim: true) |> Enum.map(&String.trim/1) |> Enum.slice(0..-2//1)

      assert args == [
               "assignment_id => 'cfl4yau3uwjlscmzukhavbniggdrpenr',",
               "assign_table_full_name => '\"public\".\"memberships\"',",
               "scope => '\"public\".\"projects\"',",
               "user_column_name => 'user_id',",
               "role_name_string => NULL,",
               "role_column_name => 'role'"
             ]
    end

    test "ELECTRIC GRANT" do
      ddlx = "ELECTRIC GRANT INSERT ON issues TO (projects, 'member')"

      assert [
               ~S[INSERT INTO "electric"."ddlx_commands" (ddlx) VALUES ('\x] <> hex
             ] = pg_sql(ddlx)

      assert %SatPerms.DDLX{grants: [grant]} = parse_pb(hex)

      assert %SatPerms.Grant{
               privilege: :INSERT,
               table: %{schema: "public", name: "issues"},
               role: %SatPerms.RoleName{role: {:application, "member"}},
               columns: nil,
               scope: %{schema: "public", name: "projects"},
               path: nil,
               check: nil
             } = grant
    end

    test "ELECTRIC REVOKE" do
      ddlx = "ELECTRIC REVOKE INSERT ON issues FROM (projects, 'member')"

      assert [
               ~S[INSERT INTO "electric"."ddlx_commands" (ddlx) VALUES ('\x] <> hex
             ] = pg_sql(ddlx)

      assert %SatPerms.DDLX{revokes: [revoke]} = parse_pb(hex)

      assert %SatPerms.Revoke{
               privilege: :INSERT,
               table: %{schema: "public", name: "issues"},
               role: %SatPerms.RoleName{role: {:application, "member"}},
               scope: %{schema: "public", name: "projects"},
               path: nil
             } = revoke
    end
  end
end
