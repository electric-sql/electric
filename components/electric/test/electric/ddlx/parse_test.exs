defmodule DDLXParserTest do
  use ExUnit.Case, async: true

  alias Electric.DDLX.Parse.Parser
  alias Electric.DDLX.Command.Enable
  alias Electric.DDLX.Command.Disable
  alias Electric.DDLX.Command.Grant
  alias Electric.DDLX.Command.Revoke
  alias Electric.DDLX.Command.Assign
  alias Electric.DDLX.Command.Unassign
  alias Electric.DDLX.Command.SQLite
  alias Electric.DDLX.Parse.Common

  describe "Can parse SQL into tokens" do
    test "can create tokens" do
      re = Common.regex_for_keywords(["hello", "fish", "dog"])
      input = "hello from \"old man\" with dog ( fish, toad, cow ) in his 'house';"
      tokens = Parser.get_tokens(input, re)

      assert tokens == [
               {:keyword, "hello"},
               {:name, "from"},
               {:name, "old man"},
               {:name, "with"},
               {:keyword, "dog"},
               {:collection, " fish, toad, cow "},
               {:name, "in"},
               {:name, "his"},
               {:string, "house"}
             ]
    end

    test "can create tokens with quoted names" do
      re = Common.regex_for_keywords(["hello", "fish", "dog"])

      test_inputs = [
        {"hello from stupid.\"old man\";", "stupid.old man"},
        {"hello from \"very stupid\".\"old man\";", "very stupid.old man"},
        {"hello from \"very stupid\".man ;", "very stupid.man"}
      ]

      Enum.each(test_inputs, fn {input, expected_token} ->
        tokens = Parser.get_tokens(input, re)

        assert tokens == [
                 {:keyword, "hello"},
                 {:name, "from"},
                 {:name, expected_token}
               ]
      end)
    end
  end

  describe "Can parse electric ddlx" do
    test "parse grant" do
      sql =
        "ELECTRIC GRANT UPDATE (status, name) ON thing.Köln_en$ts TO 'projects:house.admin' USING issue_id;"

      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Grant{
                 privilege: "update",
                 on_table: "thing.Köln_en$ts",
                 role: "house.admin",
                 column_names: ["status", "name"],
                 scope: "projects",
                 using_path: "issue_id",
                 check_fn: nil
               }
             ]
    end

    test "parse grant with no columns" do
      sql = "ELECTRIC GRANT UPDATE ON thing.Köln_en$ts TO 'projects:house.admin';"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Grant{
                 privilege: "update",
                 on_table: "thing.Köln_en$ts",
                 role: "house.admin",
                 column_names: ["*"],
                 scope: "projects",
                 using_path: nil,
                 check_fn: nil
               }
             ]
    end

    test "parse grant with check" do
      sql =
        "ELECTRIC GRANT UPDATE ON thing.Köln_en$ts TO 'projects:house.admin' USING project_id CHECK (name = Paul);"

      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Grant{
                 check_fn: "name = Paul",
                 column_names: ["*"],
                 on_table: "thing.Köln_en$ts",
                 privilege: "update",
                 role: "house.admin",
                 scope: "projects",
                 using_path: "project_id"
               }
             ]
    end

    test "parse grant with all" do
      sql = "ELECTRIC GRANT ALL ON thing.Köln_en$ts TO 'house.admin';"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Grant{
                 check_fn: nil,
                 column_names: ["*"],
                 on_table: "thing.Köln_en$ts",
                 privilege: "select",
                 role: "house.admin",
                 scope: "__global__",
                 using_path: nil
               },
               %Grant{
                 check_fn: nil,
                 column_names: ["*"],
                 on_table: "thing.Köln_en$ts",
                 privilege: "update",
                 role: "house.admin",
                 scope: "__global__",
                 using_path: nil
               },
               %Grant{
                 privilege: "insert",
                 on_table: "thing.Köln_en$ts",
                 role: "house.admin",
                 column_names: ["*"],
                 scope: "__global__",
                 using_path: nil,
                 check_fn: nil
               },
               %Grant{
                 check_fn: nil,
                 column_names: ["*"],
                 on_table: "thing.Köln_en$ts",
                 privilege: "delete",
                 role: "house.admin",
                 scope: "__global__",
                 using_path: nil
               }
             ]
    end

    test "parse revoke" do
      sql = "ELECTRIC REVOKE UPDATE ON thing.Köln_en$ts FROM 'projects:house.admin';"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Revoke{
                 privilege: "update",
                 on_table: "thing.Köln_en$ts",
                 role: "house.admin",
                 column_names: ["*"],
                 scope: "projects"
               }
             ]
    end

    test "parse revoke fails with string for table" do
      sql = "ELECTRIC REVOKE UPDATE ON 'thing.Köln_en$ts' FROM 'projects:house.admin';"
      {:error, _} = Parser.parse(sql)
    end

    test "parse revoke all" do
      sql = "ELECTRIC REVOKE ALL ON thing.Köln_en$ts FROM 'projects:house.admin';"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Revoke{
                 privilege: "select",
                 on_table: "thing.Köln_en$ts",
                 role: "house.admin",
                 column_names: ["*"],
                 scope: "projects"
               },
               %Revoke{
                 privilege: "update",
                 on_table: "thing.Köln_en$ts",
                 role: "house.admin",
                 column_names: ["*"],
                 scope: "projects"
               },
               %Revoke{
                 privilege: "insert",
                 on_table: "thing.Köln_en$ts",
                 role: "house.admin",
                 column_names: ["*"],
                 scope: "projects"
               },
               %Revoke{
                 privilege: "delete",
                 on_table: "thing.Köln_en$ts",
                 role: "house.admin",
                 column_names: ["*"],
                 scope: "projects"
               }
             ]
    end

    test "parse revoke cols" do
      sql =
        "ELECTRIC REVOKE UPDATE (status, name) ON thing.Köln_en$ts FROM 'projects:house.admin';"

      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Revoke{
                 privilege: "update",
                 on_table: "thing.Köln_en$ts",
                 role: "house.admin",
                 column_names: ["status", "name"],
                 scope: "projects"
               }
             ]
    end
  end

  describe "Can enable and disable" do
    test "parse enable" do
      sql = "ALTER TABLE things ENABLE ELECTRIC;"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Enable{
                 table_name: "public.things"
               }
             ]
    end

    test "parse disable" do
      sql = "ALTER TABLE things DISABLE ELECTRIC;"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Disable{
                 table_name: "public.things"
               }
             ]
    end
  end

  describe "Can electrify" do
    test "parse electrify" do
      sql = "ELECTRIFY things;"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Enable{
                 table_name: "public.things"
               }
             ]
    end

    test "parse unelectrify" do
      sql = "UNELECTRIFY things;"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Disable{
                 table_name: "public.things"
               }
             ]
    end
  end

  describe "Can do assign" do
    test "parse assign global named role role" do
      sql = "ELECTRIC ASSIGN 'admin' TO admin_users.user_id;"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Assign{
                 schema_name: "public",
                 table_name: "admin_users",
                 user_column: "user_id",
                 scope: nil,
                 role_name: "admin",
                 role_column: nil,
                 if_statement: nil
               }
             ]

      sql = "ELECTRIC ASSIGN (NULL, 'admin') TO admin_users.user_id;"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Assign{
                 schema_name: "public",
                 table_name: "admin_users",
                 user_column: "user_id",
                 scope: nil,
                 role_name: "admin",
                 role_column: nil,
                 if_statement: nil
               }
             ]

      sql = "ELECTRIC ASSIGN (NULL, admin) TO admin_users.user_id;"
      {:error, _} = Parser.parse(sql)
    end

    test "parse assign global role with column name" do
      sql = "ELECTRIC ASSIGN user_roles.role_name TO user_roles.user_id;"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Assign{
                 schema_name: "public",
                 table_name: "user_roles",
                 user_column: "user_id",
                 scope: nil,
                 role_name: nil,
                 role_column: "role_name",
                 if_statement: nil
               }
             ]

      sql = "ELECTRIC ASSIGN (NULL, user_roles.role_name) TO user_roles.user_id;"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Assign{
                 schema_name: "public",
                 table_name: "user_roles",
                 user_column: "user_id",
                 scope: nil,
                 role_name: nil,
                 role_column: "role_name",
                 if_statement: nil
               }
             ]
    end

    test "parse assign scoped role with column name" do
      sql = "ELECTRIC ASSIGN ( projects, project_members.role ) TO project_members.user_id;"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Assign{
                 schema_name: "public",
                 table_name: "project_members",
                 user_column: "user_id",
                 scope: "projects",
                 role_name: nil,
                 role_column: "role",
                 if_statement: nil
               }
             ]
    end

    test "parse assign scoped role with name" do
      sql = "ELECTRIC ASSIGN 'deliveries:driver' TO deliveries.driver_id;"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Assign{
                 schema_name: "public",
                 table_name: "deliveries",
                 user_column: "driver_id",
                 scope: "deliveries",
                 role_name: "driver",
                 role_column: nil,
                 if_statement: nil
               }
             ]

      sql = "ELECTRIC ASSIGN deliveries:driver TO deliveries.driver_id;"

      {:error, _msg} = Parser.parse(sql)
    end

    test "parse assign global named role with if function" do
      sql = "ELECTRIC ASSIGN 'record.reader' TO user_permissions.user_id IF ( can_read_records )"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Assign{
                 schema_name: "public",
                 table_name: "user_permissions",
                 user_column: "user_id",
                 scope: nil,
                 role_name: "record.reader",
                 role_column: nil,
                 if_statement: "can_read_records"
               }
             ]
    end

    test "parse unassign " do
      sql = "ELECTRIC UNASSIGN 'record.reader' FROM user_permissions.user_id;"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Unassign{
                 schema_name: "public",
                 table_name: "user_permissions",
                 user_column: "user_id",
                 scope: nil,
                 role_name: "record.reader",
                 role_column: nil
               }
             ]
    end

    test "parse sqlite " do
      sql = "ELECTRIC SQLITE '-- a comment;';"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %SQLite{
                 sqlite_statement: "-- a comment;"
               }
             ]
    end
  end
end
