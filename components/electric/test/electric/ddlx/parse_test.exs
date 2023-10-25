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
  alias Electric.DDLX.Command
  alias Electric.DDLX.Parse.Common

  describe "tokens/1" do
    test "string" do
      delims = ~w[' $$ $delim$]

      strings = [
        "my string",
        "my ' string"
      ]

      for d <- delims do
        for s <- strings do
          quoted = if(d == "'", do: :binary.replace(s, "'", "''", [:global]), else: s)
          source = "#{d}#{quoted}#{d}"
          tokens = Parser.tokens("ELECTRIC SQLITE #{source};")

          dbg(source)

          assert match?(
                   [
                     {:electric, {1, 0, nil}, _},
                     {:sqlite, {1, 9, nil}, _},
                     {:string, {1, 16, ^source}, ^s}
                   ],
                   tokens
                 ),
                 "string #{inspect(s)} not matched with delim #{inspect(d)}: #{inspect(tokens)}"
        end
      end

      tokens =
        Parser.tokens("ELECTRIC GRANT UPDATE ON thing.Köln_en$ts TO 'projects:house.admin'")

      assert [
               {:electric, {1, 0, nil}, "ELECTRIC"},
               {:grant, {1, 9, nil}, "GRANT"},
               {:update, {1, 15, nil}, "UPDATE"},
               {:on, {1, 22, nil}, "ON"},
               {:ident, {1, 25, nil}, "thing"},
               {:., {1, 30, nil}},
               {:ident, {1, 31, nil}, "Köln_en$ts"},
               {:to, {1, 42, nil}, "TO"},
               {:string, {1, 45, "'projects:house.admin'"}, "projects:house.admin"}
             ] = tokens
    end
  end

  describe "ENABLE ELECTRIC" do
    test "parse enable" do
      sql = "ALTER TABLE things ENABLE ELECTRIC;"
      {:ok, result} = Parser.parse(sql)

      assert result == %Enable{
               table_name: {"public", "things"}
             }
    end

    test "parse enable with quoted names" do
      sql = ~s[ALTER TABLE "Private"."Items" ENABLE ELECTRIC;]

      {:ok, result} = Parser.parse(sql)

      assert result == %Enable{
               table_name: {"Private", "Items"}
             }
    end

    test "parse enable with unquoted uppercase names" do
      sql = ~s[ALTER TABLE Private.Items ENABLE ELECTRIC;]

      {:ok, result} = Parser.parse(sql)

      assert result == %Enable{
               table_name: {"private", "items"}
             }
    end

    property "enable" do
      check all(
              table <- Electric.Postgres.SQLGenerator.DDLX.table_name(),
              ddlx <- Electric.Postgres.SQLGenerator.DDLX.enable(table: table)
            ) do
        # IO.puts(ddlx)
        assert {:ok, %Enable{} = cmd} = Parser.parse(ddlx, default_schema: "my_default")
        assert cmd.table_name == normalise(table, "my_default")
      end
    end
  end

  describe "ELECTRIC ASSIGN" do
    test "www example 1" do
      assert {:ok,
              %Assign{
                table_name: {"my_default", "admin_users"},
                user_column: "user_id",
                scope: nil,
                role_name: "admin",
                role_column: nil,
                if_statement: nil
              }} =
               Parser.parse("ELECTRIC ASSIGN 'admin' TO admin_users.user_id;",
                 default_schema: "my_default"
               )

      assert {:ok,
              %Assign{
                table_name: {"application", "admin_users"},
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
              } = assign} =
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
        assert match?({:error, _}, Parser.parse(ddlx)),
               "expected #{inspect(ddlx)} to return an error"
      end
    end

    test "scope extraction" do
      assert {:ok, %{scope: {"my_default", "bslaiqzpkkrql_ugfjog"}}} =
               Parser.parse(
                 ~s[ELECTRIC ASSIGN (bslaiqzpkkrql_ugfjog, 'mscuqqjmltikiblihlbizrdwfgxxbkzhiqznwnguehipzktiecxbw') TO lfqtmmgnkcawqqtayufujumxmkwsz_nbj_odyzhxjxomc_jicpmi_dzkkgozlednrqsspibjspgyabumzxoxhccnomssuzqf."BKxHbrgtmXdAeebwgDiGuLWt"."wGUBAoaXNAAxYJqtItIHckiflTvyKmCebTUYsYtbFxpekYhCKRyJMfbUaeiRnNHrOfKrrYIkdB"],
                 default_schema: "my_default"
               )

      assert {:ok, %{scope: {"my_default", "aaa"}}} =
               Parser.parse(
                 ~s[ELECTRIC ASSIGN aaa:'gzp' TO "pTw"."cjd".twi],
                 default_schema: "my_default"
               )
    end

    property "generated" do
      alias Electric.Postgres.SQLGenerator.DDLX.Assign

      check all(
              {scope, user_def, role_def} = scope_user_role <- Assign.scope_user_role(),
              ddlx <- Assign.generator(scope_user_role: scope_user_role)
            ) do
        IO.puts(ddlx)
        assert {:ok, assign} = Parser.parse(ddlx, default_schema: "my_default")

        {user_table, user_column} = user_def

        assert assign.table_name == normalise(user_table, "my_default")
        assert assign.user_column == normalise(user_column)

        case role_def do
          {{_, _} = _table, {_, _} = column} ->
            assert assign.role_column == normalise(column)

          {_, _} = name ->
            assert assign.role_name == normalise(name)
        end

        assert assign.scope == normalise(scope, "my_default")
      end
    end

    test "parse assign global named role" do
      sql = "ELECTRIC ASSIGN 'admin' TO admin_users.user_id;"
      {:ok, result} = Parser.parse(sql)

      assert result ==
               %Assign{
                 table_name: {"public", "admin_users"},
                 user_column: "user_id",
                 scope: nil,
                 role_name: "admin",
                 role_column: nil,
                 if_statement: nil
               }

      sql = "ELECTRIC ASSIGN (NULL, 'admin') TO admin_users.user_id;"
      {:ok, result} = Parser.parse(sql)

      assert result == %Assign{
               table_name: {"public", "admin_users"},
               user_column: "user_id",
               scope: nil,
               role_name: "admin",
               role_column: nil,
               if_statement: nil
             }

      sql = "ELECTRIC ASSIGN (NULL, admin) TO admin_users.user_id;"
      {:error, _} = Parser.parse(sql)
    end

    test "parse assign global role with column name" do
      sql = "ELECTRIC ASSIGN user_roles.role_name TO user_roles.user_id;"
      {:ok, result} = Parser.parse(sql)

      assert result == %Assign{
               table_name: {"public", "user_roles"},
               user_column: "user_id",
               scope: nil,
               role_name: nil,
               role_column: "role_name",
               if_statement: nil
             }

      sql = "ELECTRIC ASSIGN (NULL, user_roles.role_name) TO user_roles.user_id;"
      {:ok, result} = Parser.parse(sql)

      assert result == %Assign{
               table_name: {"public", "user_roles"},
               user_column: "user_id",
               scope: nil,
               role_name: nil,
               role_column: "role_name",
               if_statement: nil
             }
    end

    test "parse assign scoped role with column name" do
      sql = "ELECTRIC ASSIGN ( projects, project_members.role ) TO project_members.user_id;"
      {:ok, result} = Parser.parse(sql)

      assert result == %Assign{
               table_name: {"public", "project_members"},
               user_column: "user_id",
               scope: {"public", "projects"},
               role_name: nil,
               role_column: "role",
               if_statement: nil
             }
    end

    test "parse assign scoped role with name" do
      sql = "ELECTRIC ASSIGN 'deliveries:driver' TO deliveries.driver_id;"
      {:ok, result} = Parser.parse(sql)

      assert result == %Assign{
               table_name: {"public", "deliveries"},
               user_column: "driver_id",
               scope: {"public", "deliveries"},
               role_name: "driver",
               role_column: nil,
               if_statement: nil
             }

      sql = "ELECTRIC ASSIGN 'other.deliveries:driver' TO other.deliveries.driver_id;"
      {:ok, result} = Parser.parse(sql)

      assert result == %Assign{
               table_name: {"other", "deliveries"},
               user_column: "driver_id",
               scope: {"other", "deliveries"},
               role_name: "driver",
               role_column: nil,
               if_statement: nil
             }

      sql = "ELECTRIC ASSIGN deliveries:driver TO deliveries.driver_id;"

      {:error, _msg} = Parser.parse(sql)
    end

    test "parse assign global named role with if function" do
      sql =
        "ELECTRIC ASSIGN 'record.reader' TO user_permissions.user_id IF ( can_read_records() )"

      {:ok, result} = Parser.parse(sql)

      assert result == %Assign{
               table_name: {"public", "user_permissions"},
               user_column: "user_id",
               scope: nil,
               role_name: "record.reader",
               role_column: nil,
               if_statement: "can_read_records()"
             }
    end
  end

  defp normalise(nil, _default_schema) do
    nil
  end

  defp normalise({{_, _} = schema, {_, _} = table}, _default_schema) do
    {normalise_case(schema), normalise_case(table)}
  end

  defp normalise({_, _} = table, default_schema) do
    {default_schema, normalise_case(table)}
  end

  defp normalise(nil) do
    nil
  end

  defp normalise({_, _} = column) do
    normalise_case(column)
  end

  defp normalise_case({quoted, name}) when is_boolean(quoted) and is_binary(name) do
    if quoted do
      name
    else
      String.downcase(name)
    end
  end

  describe "ELECTRIC GRANT" do
    test "parse grant" do
      sql =
        "ELECTRIC GRANT UPDATE (status, name) ON thing.\"Köln_en$ts\" TO 'projects:house.admin' USING issue_id;"

      {:ok, result} = Parser.parse(sql)

      assert result == %Grant{
               privileges: ["update"],
               on_table: {"thing", "Köln_en$ts"},
               role: "house.admin",
               column_names: ["status", "name"],
               scope: {"public", "projects"},
               using_path: ["issue_id"],
               check_fn: nil
             }
    end

    test "parse grant with no columns" do
      sql = "ELECTRIC GRANT UPDATE ON thing.\"Köln_en$ts\" TO 'projects:house.admin';"
      {:ok, result} = Parser.parse(sql)

      assert result == %Grant{
               privileges: ["update"],
               on_table: {"thing", "Köln_en$ts"},
               role: "house.admin",
               column_names: ["*"],
               scope: {"public", "projects"},
               using_path: nil,
               check_fn: nil
             }
    end

    test "parse grant with check" do
      sql =
        "ELECTRIC GRANT UPDATE ON thing.Köln_en$ts TO 'projects:house.admin' USING project_id CHECK (name = 'Paul');"

      {:ok, result} = Parser.parse(sql)

      assert result == %Grant{
               check_fn: "name = 'Paul'",
               column_names: ["*"],
               on_table: {"thing", "köln_en$ts"},
               privileges: ["update"],
               role: "house.admin",
               scope: {"public", "projects"},
               using_path: ["project_id"]
             }
    end

    test "parse grant with all" do
      sql = "ELECTRIC GRANT ALL ON thing.Köln_en$ts TO 'house.admin';"
      {:ok, result} = Parser.parse(sql)

      assert result == %Grant{
               check_fn: nil,
               column_names: ["*"],
               on_table: {"thing", "köln_en$ts"},
               privileges: ["select", "insert", "update", "delete"],
               role: "house.admin",
               scope: "__global__",
               using_path: nil
             }
    end
  end

  describe "ELECTRIC REVOKE" do
    test "parse revoke" do
      sql = "ELECTRIC REVOKE UPDATE ON \"Thing\".\"Köln_en$ts\" FROM 'projects:house.admin';"
      {:ok, result} = Parser.parse(sql)

      assert result == %Revoke{
               privileges: ["update"],
               on_table: {"Thing", "Köln_en$ts"},
               role: "house.admin",
               column_names: ["*"],
               scope: {"public", "projects"}
             }
    end

    test "parse revoke all" do
      sql = "ELECTRIC REVOKE ALL ON thing.Köln_en$ts FROM 'projects:house.admin';"
      {:ok, result} = Parser.parse(sql)

      assert result == %Revoke{
               privileges: ["select", "insert", "update", "delete"],
               on_table: {"thing", "köln_en$ts"},
               role: "house.admin",
               column_names: ["*"],
               scope: {"public", "projects"}
             }
    end

    test "parse revoke fails with string for table" do
      sql = "ELECTRIC REVOKE UPDATE ON 'thing.Köln_en$ts' FROM 'projects:house.admin';"
      {:error, _} = Parser.parse(sql)
    end

    test "parse revoke cols" do
      sql =
        "ELECTRIC REVOKE UPDATE (status, name) ON thing.Köln_en$ts FROM 'projects:house.admin';"

      {:ok, result} = Parser.parse(sql)

      assert result == %Revoke{
               privileges: ["update"],
               on_table: {"thing", "köln_en$ts"},
               role: "house.admin",
               column_names: ["status", "name"],
               scope: {"public", "projects"}
             }
    end

    test "parse revoke namespaced scope" do
      sql =
        "ELECTRIC REVOKE UPDATE (status, name) ON thing.Köln_en$ts FROM 'thing.projects:house.admin';"

      {:ok, result} = Parser.parse(sql)

      assert result == %Revoke{
               privileges: ["update"],
               on_table: {"thing", "köln_en$ts"},
               role: "house.admin",
               column_names: ["status", "name"],
               scope: {"thing", "projects"}
             }
    end
  end

  describe "ELECTRIC DISABLE" do
    test "parses" do
      sql = "ALTER TABLE things DISABLE ELECTRIC;"
      {:ok, result} = Parser.parse(sql)

      assert result == %Disable{
               table_name: {"public", "things"}
             }
    end

    test "parse disable with quoted names" do
      sql = ~s[ALTER TABLE "Private"."Items" DISABLE ELECTRIC;]

      {:ok, result} = Parser.parse(sql)

      assert result == %Disable{
               table_name: {"Private", "Items"}
             }
    end

    test "parse disable with unquoted uppercase names" do
      sql = ~s[ALTER TABLE Private.Items DISABLE ELECTRIC;]

      {:ok, result} = Parser.parse(sql)

      assert result == %Disable{
               table_name: {"private", "items"}
             }
    end
  end

  describe "ELECTRIC {EN,DIS}ABLE" do
    test "parse electrify" do
      sql = "ELECTRIC ENABLE things;"
      {:ok, result} = Parser.parse(sql, default_schema: "application")

      assert result == %Enable{
               table_name: {"application", "things"}
             }
    end

    test "parse unelectrify" do
      sql = "ELECTRIC DISABLE application.things;"
      {:ok, result} = Parser.parse(sql)

      assert result == %Disable{
               table_name: {"application", "things"}
             }
    end
  end

  describe "ELECTRIC UNASSIGN" do
    test "parse unassign " do
      sql = "ELECTRIC UNASSIGN 'record.reader' FROM user_permissions.user_id;"
      {:ok, result} = Parser.parse(sql)

      assert result == %Unassign{
               table_name: {"public", "user_permissions"},
               user_column: "user_id",
               scope: nil,
               role_name: "record.reader",
               role_column: nil
             }
    end
  end

  describe "ELECTRIC SQLITE" do
    test "parse sqlite " do
      sql = "ELECTRIC SQLITE '-- a comment;';"
      {:ok, result} = Parser.parse(sql)

      assert result == %SQLite{
               sqlite_statement: "-- a comment;"
             }
    end

    test "parse sqlite with $ delim" do
      sql = "ELECTRIC SQLITE $sqlite$-- comment\nselect 'this';$sqlite$;"
      {:ok, result} = Parser.parse(sql)

      assert result == %SQLite{
               sqlite_statement: "-- comment\nselect 'this';"
             }
    end
  end
end
