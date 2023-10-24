defmodule DDLXParserTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Electric.DDLX.Parse.Parser
  alias Electric.DDLX.Command.Enable
  alias Electric.DDLX.Command.Disable
  alias Electric.DDLX.Command.Grant
  alias Electric.DDLX.Command.Revoke
  alias Electric.DDLX.Command.Assign
  alias Electric.DDLX.Command.Unassign
  alias Electric.DDLX.Command.SQLite
  alias Electric.DDLX.Parse.Common

  property "enable" do
    check all(
            table <- Electric.Postgres.SQLGenerator.DDLX.table_name(),
            ddlx <- Electric.Postgres.SQLGenerator.DDLX.enable(table: table)
          ) do
      IO.puts(ddlx)
      assert {:ok, _} = Parser.parse(ddlx, default_schema: "my_default") |> dbg
      # assert {:ok, %Enable{} = cmd} = Parser.parse(ddlx, default_schema: "my_default")
      # assert cmd.table_name == normalise(table, "my_default")
    end
  end

  describe "ELECTRIC ASSIGN" do
    test "www example 1" do
      assert {:ok,
              %Assign{
                # FIXME: default schema application
                # schema_name: "my_default",
                table_name: "admin_users",
                user_column: "user_id",
                scope: nil,
                role_name: "admin",
                role_column: nil,
                if_statement: nil
              }} =
               Parser.parse("ELECTRIC ASSIGN 'admin' TO admin_users.user_id;",
                 default_schema: "my_default"
               )
               |> dbg

      assert {:ok,
              %Assign{
                schema_name: "application",
                table_name: "admin_users",
                user_column: "user_id",
                scope: nil,
                role_name: "admin",
                role_column: nil,
                if_statement: nil
              }} =
               Parser.parse("ELECTRIC ASSIGN 'admin' TO application.admin_users.user_id;",
                 default_schema: "my_default"
               )
    end

    test "www example 2" do
      assert {:ok,
              %Assign{
                # FIXME: default schema application
                # schema_name: "my_default",
                table_name: {"my_default", "user_roles"},
                user_column: "user_id",
                scope: nil,
                role_name: nil,
                role_column: "role_name",
                if_statement: nil
              }} =
               Parser.parse("ELECTRIC ASSIGN user_roles.role_name TO user_roles.user_id;",
                 default_schema: "my_default"
               )
               |> dbg

      assert {:ok,
              %Assign{
                table_name: {"application", "user_roles"},
                user_column: "user_id",
                scope: nil,
                role_name: nil,
                role_column: "role_name",
                if_statement: nil
              }} =
               Parser.parse(
                 "ELECTRIC ASSIGN application.user_roles.role_name TO application.user_roles.user_id;",
                 default_schema: "my_default"
               )

      assert {:ok,
              %Assign{
                table_name: {"application", "user_roles"},
                user_column: "user_id",
                scope: nil,
                role_name: nil,
                role_column: "role_name",
                if_statement: nil
              }} =
               Parser.parse(
                 "ELECTRIC ASSIGN (NuLl, application.user_roles.role_name) TO application.user_roles.user_id;",
                 default_schema: "my_default"
               )

      assert {:ok,
              %Assign{
                table_name: {"Application", "user_roles"},
                user_column: "user_id",
                scope: nil,
                role_name: nil,
                role_column: "role_name",
                if_statement: nil
              }} =
               Parser.parse(
                 "ELECTRIC ASSIGN (NuLl, \"Application\".user_roles.role_name) TO \"Application\".user_roles.user_id;",
                 default_schema: "my_default"
               )

      assert {:ok,
              %Assign{
                table_name: {"application", "user_roles"},
                user_column: "user_id",
                scope: nil,
                role_name: nil,
                role_column: "role_name",
                if_statement: nil
              }} =
               Parser.parse(
                 "ELECTRIC ASSIGN (NuLl, Application.user_roles.role_name) TO application.user_roles.user_id;",
                 default_schema: "my_default"
               )
    end

    test "www example 3" do
      assert {:ok,
              %Assign{
                table_name: {"my_default", "project_members"},
                user_column: "user_id",
                scope: {"my_default", "projects"},
                role_name: nil,
                role_column: "role",
                if_statement: nil
              }} =
               Parser.parse(
                 "ELECTRIC ASSIGN ( projects, project_members.role) TO project_members.user_id;",
                 default_schema: "my_default"
               )

      assert {:ok,
              %Assign{
                table_name: {"application", "project_members"},
                user_column: "user_id",
                scope: {"auth", "projects"},
                role_name: nil,
                role_column: "role",
                if_statement: nil
              }} =
               Parser.parse(
                 "ELECTRIC ASSIGN ( auth.projects, application.project_members.role) TO application.project_members.user_id;",
                 default_schema: "my_default"
               )
    end

    test "invalid examples" do
      stmts = [
        "electric assign 'projects:' to users.user_id",
        "electric assign '' to users.user_id",
        "electric assign ':' to users.user_id",
        "electric assign ':admin' to users.user_id",
        "electric assign abusers.role to users.user_id"
      ]

      for ddlx <- stmts do
        assert match?({:error, _}, Parser.parse(ddlx) |> dbg),
               "expected #{inspect(ddlx)} to return an error"
      end
    end

    property "generated" do
      check all(ddlx <- Electric.Postgres.SQLGenerator.DDLX.Assign.generator()) do
        IO.puts(ddlx)
        # IO.inspect(Parser.tokens(ddlx))
        # |> dbg
        assert {:ok, _} = Parser.parse(ddlx, default_schema: "my_default")
        # Parser.parse(ddlx, default_schema: "my_default") |> dbg
      end
    end
  end

  test "temp" do
    Parser.tokens("ELECTRIC ASSIGN NULL:\"rK\".dmz TO tonpnrryzaseqxyn.zuilhqbdihqhwhjlvfy")
    |> :ddlx.parse()
    |> dbg

    # Parser.tokens("ALTER TABLE \"old \"\"man\" with dog ( fish, toad, cow ) in his 'house';")
    # |> :ddlx.parse()
    # |> dbg
    #
    # Parser.tokens("alter Table \"old man\".\"Something\" enable ELECTRIC;")
    # |> :ddlx.parse()
    # |> dbg
    #
    # Parser.tokens("alter Table old man.Something enable ELECTRIC;")
    # |> :ddlx.parse()
    # |> dbg
    #
    # Parser.tokens("hello from old_man.something with dog ( fish, toad, cow ) in his 'house';")
    # |> dbg
  end

  defp normalise({{_, _} = schema, {_, _} = table}, _default_schema) do
    {normalise_case(schema), normalise_case(table)}
  end

  defp normalise({_, _} = table, default_schema) do
    {default_schema, normalise_case(table)}
  end

  defp normalise_case({quoted, name}) when is_boolean(quoted) and is_binary(name) do
    if quoted do
      name
    else
      String.downcase(name)
    end
  end

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
        "ELECTRIC GRANT UPDATE (status, name) ON thing.\"Köln_en$ts\" TO 'projects:house.admin' USING issue_id;"

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
                 table_name: {"public", "things"}
               }
             ]
    end

    test "parse enable with quoted names" do
      sql = ~s[ALTER TABLE "Private"."Items" ENABLE ELECTRIC;]

      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Enable{
                 table_name: {"Private", "Items"}
               }
             ]
    end

    test "parse enable with unquoted uppercase names" do
      sql = ~s[ALTER TABLE Private.Items ENABLE ELECTRIC;]

      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Enable{
                 table_name: {"private", "items"}
               }
             ]
    end

    test "parse disable" do
      sql = "ALTER TABLE things DISABLE ELECTRIC;"
      {:ok, result} = Parser.parse(sql)

      assert result == [
               %Disable{
                 table_name: {"public", "things"}
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
      {:ok, result} = Parser.old_parse(sql)

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
      {:ok, result} = Parser.old_parse(sql)

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
