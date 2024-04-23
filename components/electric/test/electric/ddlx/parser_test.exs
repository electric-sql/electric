defmodule Electric.DDLX.ParserTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Electric.DDLX.Parser
  alias Electric.DDLX.Command
  alias Electric.Satellite.SatPerms
  alias ElectricTest.PermissionsHelpers.Proto

  describe "ENABLE ELECTRIC" do
    test "parse enable" do
      sql = "ALTER TABLE things ENABLE ELECTRIC;"
      {:ok, result} = Parser.parse(sql)

      assert result ==
               %Command{
                 action: %Command.Enable{
                   table_name: {"public", "things"}
                 },
                 stmt: sql,
                 tables: [{"public", "things"}],
                 tag: "ELECTRIC ENABLE"
               }
    end

    test "parse enable with quoted names" do
      sql = ~s[ALTER TABLE "Private"."Items" ENABLE ELECTRIC;]

      assert parse(sql) == %Command{
               action: %Command.Enable{
                 table_name: {"Private", "Items"}
               },
               stmt: sql,
               tables: [{"Private", "Items"}],
               tag: "ELECTRIC ENABLE"
             }
    end

    test "parse enable with unquoted uppercase names" do
      sql = ~s[ALTER TABLE Private.Items ENABLE ELECTRIC;]

      assert parse(sql) == %Command{
               action: %Command.Enable{
                 table_name: {"private", "items"}
               },
               stmt: sql,
               tables: [{"private", "items"}],
               tag: "ELECTRIC ENABLE"
             }
    end

    property "enable" do
      check all(
              table <- Electric.Postgres.SQLGenerator.DDLX.table_name(),
              ddlx <- Electric.Postgres.SQLGenerator.DDLX.enable(table: table)
            ) do
        # IO.puts(ddlx)
        assert {:ok, %Command{action: %Command.Enable{} = cmd}} =
                 Parser.parse(ddlx, default_schema: "my_default")

        assert cmd.table_name == normalise(table, "my_default")
      end
    end
  end

  def parse(sql) do
    assert {:ok, result} = Parser.parse(sql, default_schema: "my_default")
    result
  end

  describe "ELECTRIC ASSIGN" do
    test "www example 1" do
      sql = "ELECTRIC ASSIGN 'admin' TO admin_users.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "2uidsvryaa2k6xjbmq6zlu7nfy2ytg6b",
                     table: Proto.table("my_default", "admin_users"),
                     user_column: "user_id",
                     scope: nil,
                     role_name: "admin",
                     role_column: nil,
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"my_default", "admin_users"}],
               tag: "ELECTRIC ASSIGN"
             }

      sql = "ELECTRIC ASSIGN 'admin' TO admin_users.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "2uidsvryaa2k6xjbmq6zlu7nfy2ytg6b",
                     table: Proto.table("my_default", "admin_users"),
                     user_column: "user_id",
                     scope: nil,
                     role_name: "admin",
                     role_column: nil,
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"my_default", "admin_users"}],
               tag: "ELECTRIC ASSIGN"
             }
    end

    test "www example 2" do
      sql = "ELECTRIC ASSIGN user_roles.role_name TO user_roles.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "pxrga7klxw65mybjn6vrta3vs5t2rkhe",
                     table: Proto.table("my_default", "user_roles"),
                     user_column: "user_id",
                     scope: nil,
                     role_name: nil,
                     role_column: "role_name",
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"my_default", "user_roles"}],
               tag: "ELECTRIC ASSIGN"
             }

      sql = "ELECTRIC ASSIGN application.user_roles.role_name TO application.user_roles.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "tcdchugjrxs6o52wlikvoaoqz5gef7du",
                     table: Proto.table("application", "user_roles"),
                     user_column: "user_id",
                     scope: nil,
                     role_name: nil,
                     role_column: "role_name",
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"application", "user_roles"}],
               tag: "ELECTRIC ASSIGN"
             }

      sql =
        "ELECTRIC ASSIGN (NuLl, application.user_roles.role_name) TO application.user_roles.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "tcdchugjrxs6o52wlikvoaoqz5gef7du",
                     table: Proto.table("application", "user_roles"),
                     user_column: "user_id",
                     scope: nil,
                     role_name: nil,
                     role_column: "role_name",
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"application", "user_roles"}],
               tag: "ELECTRIC ASSIGN"
             }

      sql =
        "ELECTRIC ASSIGN (NuLl, \"Application\".user_roles.role_name) TO \"Application\".user_roles.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "fq7ybdqfg6mee6cdnhx2ciyhzjxtwj3a",
                     table: Proto.table("Application", "user_roles"),
                     user_column: "user_id",
                     scope: nil,
                     role_name: nil,
                     role_column: "role_name",
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"Application", "user_roles"}],
               tag: "ELECTRIC ASSIGN"
             }

      sql =
        "ELECTRIC ASSIGN (NuLl, Application.User_roles.Role_name) TO Application.user_roles.User_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "tcdchugjrxs6o52wlikvoaoqz5gef7du",
                     table: Proto.table("application", "user_roles"),
                     user_column: "user_id",
                     scope: nil,
                     role_name: nil,
                     role_column: "role_name",
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"application", "user_roles"}],
               tag: "ELECTRIC ASSIGN"
             }
    end

    test "www example 3" do
      sql = "ELECTRIC ASSIGN (projects, project_members.role) TO project_members.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "rzs4jo7bvzfmj2a5pjjblypdy2kw5vzc",
                     table: Proto.table("my_default", "project_members"),
                     user_column: "user_id",
                     scope: Proto.table("my_default", "projects"),
                     role_name: nil,
                     role_column: "role",
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"my_default", "project_members"}],
               tag: "ELECTRIC ASSIGN"
             }

      sql =
        "ELECTRIC ASSIGN (auth.projects, application.project_members.role) TO application.project_members.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "fcld4tiw2qsr4yxlwmytijlj5tl4mklp",
                     table: Proto.table("application", "project_members"),
                     user_column: "user_id",
                     scope: Proto.table("auth", "projects"),
                     role_name: nil,
                     role_column: "role",
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"application", "project_members"}],
               tag: "ELECTRIC ASSIGN"
             }
    end

    test "invalid examples" do
      stmts = [
        "electric assign (projects, ) to users.user_id",
        "electric assign '' to users.user_id",
        "electric assign abusers.role to users.user_id"
      ]

      for ddlx <- stmts do
        assert match?({:error, _}, Parser.parse(ddlx)),
               "expected #{inspect(ddlx)} to return an error"
      end
    end

    test "scope extraction" do
      assert {:ok,
              %{
                action: %{
                  assigns: [%{scope: %{schema: "my_default", name: "bslaiqzpkkrql_ugfjog"}}]
                }
              }} =
               Parser.parse(
                 ~s[ELECTRIC ASSIGN (bslaiqzpkkrql_ugfjog, 'mscuqqjmltikiblihlbizrdwfgxxbkzhiqznwnguehipzktiecxbw') TO lfqtmmgnkcawqqtayufujumxmkwsz_nbj_odyzhxjxomc_jicpmi_dzkkgozlednrqsspibjspgyabumzxoxhccnomssuzqf."BKxHbrgtmXdAeebwgDiGuLWt"."wGUBAoaXNAAxYJqtItIHckiflTvyKmCebTUYsYtbFxpekYhCKRyJMfbUaeiRnNHrOfKrrYIkdB"],
                 default_schema: "my_default"
               )

      assert {:ok,
              %{
                action: %{
                  assigns: [%{scope: %{schema: "my_default", name: "aaa"}}]
                }
              }} =
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
        # IO.puts(ddlx)
        assert {:ok, %{action: %SatPerms.DDLX{assigns: [assign]}}} =
                 Parser.parse(ddlx, default_schema: "my_default")

        {user_table, user_column} = user_def

        assert assign.table == pbnormalise(user_table, "my_default")
        assert assign.user_column == pbnormalise(user_column)

        case role_def do
          {{_, _} = _table, {_, _} = column} ->
            assert assign.role_column == normalise(column)

          {_, _} = name ->
            assert assign.role_name == normalise(name)
        end

        assert assign.scope == pbnormalise(scope, "my_default")
      end
    end

    test "parse assign global named role" do
      sql = "ELECTRIC ASSIGN 'admin' TO admin_users.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "2uidsvryaa2k6xjbmq6zlu7nfy2ytg6b",
                     table: Proto.table("my_default", "admin_users"),
                     user_column: "user_id",
                     scope: nil,
                     role_name: "admin",
                     role_column: nil,
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"my_default", "admin_users"}],
               tag: "ELECTRIC ASSIGN"
             }

      sql = "ELECTRIC ASSIGN (NULL, 'admin') TO admin_users.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "2uidsvryaa2k6xjbmq6zlu7nfy2ytg6b",
                     table: Proto.table("my_default", "admin_users"),
                     user_column: "user_id",
                     scope: nil,
                     role_name: "admin",
                     role_column: nil,
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"my_default", "admin_users"}],
               tag: "ELECTRIC ASSIGN"
             }

      sql = "ELECTRIC ASSIGN (NULL, admin) TO admin_users.user_id;"

      {:error, _} = Parser.parse(sql)
    end

    test "parse assign global role with column name" do
      sql = "ELECTRIC ASSIGN user_roles.role_name TO user_roles.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "pxrga7klxw65mybjn6vrta3vs5t2rkhe",
                     table: Proto.table("my_default", "user_roles"),
                     user_column: "user_id",
                     scope: nil,
                     role_name: nil,
                     role_column: "role_name",
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"my_default", "user_roles"}],
               tag: "ELECTRIC ASSIGN"
             }

      sql = "ELECTRIC ASSIGN (NULL, user_roles.role_name) TO user_roles.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "pxrga7klxw65mybjn6vrta3vs5t2rkhe",
                     table: Proto.table("my_default", "user_roles"),
                     user_column: "user_id",
                     scope: nil,
                     role_name: nil,
                     role_column: "role_name",
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"my_default", "user_roles"}],
               tag: "ELECTRIC ASSIGN"
             }
    end

    test "parse assign scoped role with column name" do
      sql = "ELECTRIC ASSIGN ( projects, project_members.role ) TO project_members.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "rzs4jo7bvzfmj2a5pjjblypdy2kw5vzc",
                     table: Proto.table("my_default", "project_members"),
                     user_column: "user_id",
                     scope: Proto.table("my_default", "projects"),
                     role_name: nil,
                     role_column: "role",
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"my_default", "project_members"}],
               tag: "ELECTRIC ASSIGN"
             }
    end

    test "parse assign scoped role with name" do
      sql = "ELECTRIC ASSIGN 'deliveries:driver' TO deliveries.driver_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "uk3vbzo7am3uxtlnjprioxwgv52aeojz",
                     table: Proto.table("my_default", "deliveries"),
                     user_column: "driver_id",
                     scope: Proto.table("my_default", "deliveries"),
                     role_name: "driver",
                     role_column: nil,
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"my_default", "deliveries"}],
               tag: "ELECTRIC ASSIGN"
             }

      sql = "ELECTRIC ASSIGN 'other.deliveries:driver' TO other.deliveries.driver_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "z5wssirjrctqy3zfbs25yfuuvou77gip",
                     table: Proto.table("other", "deliveries"),
                     user_column: "driver_id",
                     scope: Proto.table("other", "deliveries"),
                     role_name: "driver",
                     role_column: nil,
                     if: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"other", "deliveries"}],
               tag: "ELECTRIC ASSIGN"
             }

      sql = "ELECTRIC ASSIGN deliveries:driver TO deliveries.driver_id;"

      {:error, _msg} = Parser.parse(sql)
    end

    test "parse assign global named role with if function" do
      sql =
        "ELECTRIC ASSIGN 'record.reader' TO user_permissions.user_id IF ( can_read_records() )"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 assigns: [
                   %SatPerms.Assign{
                     id: "o7iyzse5guwyxjwr367hpfbmcg2irbyi",
                     table: Proto.table("my_default", "user_permissions"),
                     user_column: "user_id",
                     scope: nil,
                     role_name: "record.reader",
                     role_column: nil,
                     if: "can_read_records()"
                   }
                 ]
               },
               stmt: sql,
               tables: [{"my_default", "user_permissions"}],
               tag: "ELECTRIC ASSIGN"
             }
    end
  end

  defp pbnormalise(nil, _default_schema) do
    nil
  end

  defp pbnormalise({{_, _} = schema, {_, _} = table}, _default_schema) do
    Proto.table(normalise_case(schema), normalise_case(table))
  end

  defp pbnormalise({_, _} = table, default_schema) do
    Proto.table(default_schema, normalise_case(table))
  end

  defp pbnormalise(nil) do
    nil
  end

  defp pbnormalise({_, _} = column) do
    normalise_case(column)
  end

  ###

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
      # using clauses are currently ignored, and not referenced in the docs, but I'm retaining
      # support in the parser
      sql =
        "ELECTRIC GRANT UPDATE (status, name) ON thing.\"Köln_en$ts\" TO (projects, 'house.admin') USING issue_id;"

      {:ok, result} = Parser.parse(sql)

      assert result == %Command{
               action: %SatPerms.DDLX{
                 grants: [
                   %SatPerms.Grant{
                     id: "6qwbckegxcxt2zesymulmwqotberhp4m",
                     privilege: :UPDATE,
                     table: Proto.table("thing", "Köln_en$ts"),
                     role: Proto.role("house.admin"),
                     columns: %SatPerms.ColumnList{names: ["status", "name"]},
                     scope: Proto.table("public", "projects"),
                     path: ["issue_id"],
                     check: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "Köln_en$ts"}],
               tag: "ELECTRIC GRANT"
             }
    end

    test "parse scoped grant" do
      sql =
        "ELECTRIC GRANT UPDATE (status, name) ON thing.\"Köln_en$ts\" TO (projects, 'house.admin') USING issue_id;"

      {:ok, result} = Parser.parse(sql)

      assert result == %Command{
               action: %SatPerms.DDLX{
                 grants: [
                   %SatPerms.Grant{
                     id: "6qwbckegxcxt2zesymulmwqotberhp4m",
                     privilege: :UPDATE,
                     table: Proto.table("thing", "Köln_en$ts"),
                     role: Proto.role("house.admin"),
                     columns: %SatPerms.ColumnList{names: ["status", "name"]},
                     scope: Proto.table("public", "projects"),
                     path: ["issue_id"],
                     check: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "Köln_en$ts"}],
               tag: "ELECTRIC GRANT"
             }
    end

    test "parse grant with no columns" do
      sql = "ELECTRIC GRANT UPDATE ON thing.\"Köln_en$ts\" TO (projects, 'house.admin');"
      {:ok, result} = Parser.parse(sql)

      assert result == %Command{
               action: %SatPerms.DDLX{
                 grants: [
                   %SatPerms.Grant{
                     id: "6qwbckegxcxt2zesymulmwqotberhp4m",
                     privilege: :UPDATE,
                     table: Proto.table("thing", "Köln_en$ts"),
                     role: Proto.role("house.admin"),
                     columns: nil,
                     scope: Proto.table("public", "projects"),
                     path: nil,
                     check: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "Köln_en$ts"}],
               tag: "ELECTRIC GRANT"
             }
    end

    test "parse grant with check" do
      sql =
        "ELECTRIC GRANT UPDATE ON thing.Köln_en$ts TO (projects, 'house.admin') WHERE (name = 'Paul');"

      {:ok, result} = Parser.parse(sql)

      assert result == %Command{
               action: %SatPerms.DDLX{
                 grants: [
                   %SatPerms.Grant{
                     id: "unz3ra6f4w3luf2wdfhjsiryuyp4bdse",
                     check: "name = 'Paul'",
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :UPDATE,
                     role: Proto.role("house.admin"),
                     scope: Proto.table("public", "projects")
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "köln_en$ts"}],
               tag: "ELECTRIC GRANT"
             }
    end

    test "parse grant with old style string scope definition" do
      sql =
        "ELECTRIC GRANT UPDATE ON thing.Köln_en$ts TO 'projects:house.admin' WHERE (name = 'Paul');"

      {:ok, result} = Parser.parse(sql)

      assert result == %Command{
               action: %SatPerms.DDLX{
                 grants: [
                   %SatPerms.Grant{
                     id: "l5clz3xxefjb7pn2erskct2qvh3jjxzv",
                     check: "name = 'Paul'",
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :UPDATE,
                     role: Proto.role("projects:house.admin"),
                     scope: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "köln_en$ts"}],
               tag: "ELECTRIC GRANT"
             }
    end

    test "parse grant with multiple privileges" do
      sql =
        "ELECTRIC GRANT WRITE ON thing.Köln_en$ts TO (projects, 'house.admin') WHERE (name = 'Paul');"

      {:ok, result} = Parser.parse(sql)

      assert result == %Command{
               action: %SatPerms.DDLX{
                 grants: [
                   %SatPerms.Grant{
                     id: "2ag4ijgsjmrexpfbqzpyljuqnj4x4qry",
                     check: "name = 'Paul'",
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :INSERT,
                     role: Proto.role("house.admin"),
                     scope: Proto.table("public", "projects")
                   },
                   %SatPerms.Grant{
                     id: "unz3ra6f4w3luf2wdfhjsiryuyp4bdse",
                     check: "name = 'Paul'",
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :UPDATE,
                     role: Proto.role("house.admin"),
                     scope: Proto.table("public", "projects")
                   },
                   %SatPerms.Grant{
                     id: "tr7tdsl5c7uv6pkcth5ybgtz6tddewnd",
                     check: "name = 'Paul'",
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :DELETE,
                     role: Proto.role("house.admin"),
                     scope: Proto.table("public", "projects")
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "köln_en$ts"}],
               tag: "ELECTRIC GRANT"
             }
    end

    test "parse grant with all" do
      sql = "ELECTRIC GRANT ALL ON thing.Köln_en$ts TO 'house.admin';"
      {:ok, result} = Parser.parse(sql)

      assert result == %Command{
               action: %SatPerms.DDLX{
                 grants: [
                   %SatPerms.Grant{
                     id: "q5m3kn7dzjptvnf7a4y456l6n4j3bmy3",
                     check: nil,
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :SELECT,
                     role: Proto.role("house.admin"),
                     scope: nil,
                     path: nil
                   },
                   %SatPerms.Grant{
                     id: "qcw7p6e4aj7nfev7vqwrgtuqx3kai3xd",
                     check: nil,
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :INSERT,
                     role: Proto.role("house.admin"),
                     scope: nil,
                     path: nil
                   },
                   %SatPerms.Grant{
                     id: "qw366w63mnmifcedq3aqr7wt4gfxhc2v",
                     check: nil,
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :UPDATE,
                     role: Proto.role("house.admin"),
                     scope: nil,
                     path: nil
                   },
                   %SatPerms.Grant{
                     id: "qrvaeunuhz3tzvkvxfyidadr6w6a4zis",
                     check: nil,
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :DELETE,
                     role: Proto.role("house.admin"),
                     scope: nil,
                     path: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "köln_en$ts"}],
               tag: "ELECTRIC GRANT"
             }

      sql = "ELECTRIC GRANT ALL PRIVILEGES ON thing.Köln_en$ts TO 'house.admin';"
      {:ok, result} = Parser.parse(sql)

      assert result == %Command{
               action: %SatPerms.DDLX{
                 grants: [
                   %SatPerms.Grant{
                     id: "q5m3kn7dzjptvnf7a4y456l6n4j3bmy3",
                     check: nil,
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :SELECT,
                     role: Proto.role("house.admin"),
                     scope: nil,
                     path: nil
                   },
                   %SatPerms.Grant{
                     id: "qcw7p6e4aj7nfev7vqwrgtuqx3kai3xd",
                     check: nil,
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :INSERT,
                     role: Proto.role("house.admin"),
                     scope: nil,
                     path: nil
                   },
                   %SatPerms.Grant{
                     id: "qw366w63mnmifcedq3aqr7wt4gfxhc2v",
                     check: nil,
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :UPDATE,
                     role: Proto.role("house.admin"),
                     scope: nil,
                     path: nil
                   },
                   %SatPerms.Grant{
                     id: "qrvaeunuhz3tzvkvxfyidadr6w6a4zis",
                     check: nil,
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :DELETE,
                     role: Proto.role("house.admin"),
                     scope: nil,
                     path: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "köln_en$ts"}],
               tag: "ELECTRIC GRANT"
             }
    end

    test "parse grant with all and column list" do
      sql = "ELECTRIC GRANT ALL (col1, col2) ON thing.Köln_en$ts TO 'house.admin';"
      {:ok, result} = Parser.parse(sql)

      assert result == %Command{
               action: %SatPerms.DDLX{
                 grants: [
                   %SatPerms.Grant{
                     id: "q5m3kn7dzjptvnf7a4y456l6n4j3bmy3",
                     check: nil,
                     columns: %SatPerms.ColumnList{names: ["col1", "col2"]},
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :SELECT,
                     role: Proto.role("house.admin"),
                     scope: nil,
                     path: nil
                   },
                   %SatPerms.Grant{
                     id: "qcw7p6e4aj7nfev7vqwrgtuqx3kai3xd",
                     check: nil,
                     columns: %SatPerms.ColumnList{names: ["col1", "col2"]},
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :INSERT,
                     role: Proto.role("house.admin"),
                     scope: nil,
                     path: nil
                   },
                   %SatPerms.Grant{
                     id: "qw366w63mnmifcedq3aqr7wt4gfxhc2v",
                     check: nil,
                     columns: %SatPerms.ColumnList{names: ["col1", "col2"]},
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :UPDATE,
                     role: Proto.role("house.admin"),
                     scope: nil,
                     path: nil
                   },
                   %SatPerms.Grant{
                     id: "qrvaeunuhz3tzvkvxfyidadr6w6a4zis",
                     check: nil,
                     columns: %SatPerms.ColumnList{names: ["col1", "col2"]},
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :DELETE,
                     role: Proto.role("house.admin"),
                     scope: nil,
                     path: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "köln_en$ts"}],
               tag: "ELECTRIC GRANT"
             }
    end

    test "parse grant to anyone" do
      sql = "ELECTRIC GRANT ALL ON thing.Köln_en$ts TO ANYONE;"
      {:ok, result} = Parser.parse(sql)

      assert result == %Command{
               action: %SatPerms.DDLX{
                 grants: [
                   %SatPerms.Grant{
                     id: "2akoxmzkfwchadl6qcf22f6syd2btygl",
                     check: nil,
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :SELECT,
                     role: Proto.anyone(),
                     scope: nil,
                     path: nil
                   },
                   %SatPerms.Grant{
                     id: "jk7n6coz7jejdybyayxtwfni7jet43pv",
                     check: nil,
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :INSERT,
                     role: Proto.anyone(),
                     scope: nil,
                     path: nil
                   },
                   %SatPerms.Grant{
                     id: "nv2253mnh3xo6ozaefj4kpfmbb5ervsz",
                     check: nil,
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :UPDATE,
                     role: Proto.anyone(),
                     scope: nil,
                     path: nil
                   },
                   %SatPerms.Grant{
                     id: "t3rp5vrt5r3tzzye33pcgwmxyovzgxb7",
                     check: nil,
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :DELETE,
                     role: Proto.anyone(),
                     scope: nil,
                     path: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "köln_en$ts"}],
               tag: "ELECTRIC GRANT"
             }
    end

    test "parse grant to authenticated" do
      sql = "ELECTRIC GRANT READ ON thing.Köln_en$ts TO AUTHENTICATED;"
      {:ok, result} = Parser.parse(sql)

      assert result == %Command{
               action: %SatPerms.DDLX{
                 grants: [
                   %SatPerms.Grant{
                     id: "dfhpttndlmoswwso2idggsadq4vwuikg",
                     check: nil,
                     columns: nil,
                     table: Proto.table("thing", "köln_en$ts"),
                     privilege: :SELECT,
                     role: Proto.authenticated(),
                     scope: nil,
                     path: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "köln_en$ts"}],
               tag: "ELECTRIC GRANT"
             }
    end

    test "grant with field accesses in check clause" do
      sql =
        "ELECTRIC GRANT READ ON issues TO (projects, 'editor') WHERE (row.user_id = AUTH.user_id)"

      {:ok, result} = Parser.parse(sql)

      assert result == %Command{
               action: %SatPerms.DDLX{
                 grants: [
                   %SatPerms.Grant{
                     id: "baa4uqpavntlksnbmmw7eqp24mela3ed",
                     check: "ROW.user_id = AUTH.user_id",
                     table: Proto.table("issues"),
                     privilege: :SELECT,
                     role: Proto.role("editor"),
                     scope: Proto.scope("projects")
                   }
                 ]
               },
               stmt: sql,
               tables: [{"public", "issues"}],
               tag: "ELECTRIC GRANT"
             }
    end

    test "grant with type casting in check clause" do
      sql =
        "ELECTRIC GRANT READ ON issues TO (projects, 'editor') WHERE (row.user_id::text = AUTH.user_id)"

      {:ok, result} = Parser.parse(sql)

      assert result == %Command{
               action: %SatPerms.DDLX{
                 grants: [
                   %SatPerms.Grant{
                     id: "baa4uqpavntlksnbmmw7eqp24mela3ed",
                     check: "ROW.user_id::text = AUTH.user_id",
                     table: Proto.table("issues"),
                     privilege: :SELECT,
                     role: Proto.role("editor"),
                     scope: Proto.scope("projects")
                   }
                 ]
               },
               stmt: sql,
               tables: [{"public", "issues"}],
               tag: "ELECTRIC GRANT"
             }
    end

    test "grant with multiple clauses in check clause" do
      sql =
        "ELECTRIC GRANT READ ON issues TO (projects, 'editor') WHERE ((row.user_id = AUTH.user_id) AND (thing.reason > 2))"

      {:ok, result} = Parser.parse(sql)

      assert result == %Command{
               action: %SatPerms.DDLX{
                 grants: [
                   %SatPerms.Grant{
                     id: "baa4uqpavntlksnbmmw7eqp24mela3ed",
                     check: "(ROW.user_id = AUTH.user_id) AND (THING.reason > 2)",
                     table: Proto.table("issues"),
                     privilege: :SELECT,
                     role: Proto.role("editor"),
                     scope: Proto.scope("projects")
                   }
                 ]
               },
               stmt: sql,
               tables: [{"public", "issues"}],
               tag: "ELECTRIC GRANT"
             }
    end
  end

  describe "ELECTRIC REVOKE" do
    test "parse revoke" do
      sql =
        "ELECTRIC REVOKE UPDATE ON \"Thing\".\"Köln_en$ts\" FROM (\"Thing\".projects, 'house.admin');"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 revokes: [
                   %SatPerms.Revoke{
                     id: "dajpwzccceliaxpwwru4rxc4f4qisw6j",
                     privilege: :UPDATE,
                     table: Proto.table("Thing", "Köln_en$ts"),
                     role: Proto.role("house.admin"),
                     scope: Proto.table("Thing", "projects")
                   }
                 ]
               },
               stmt: sql,
               tables: [{"Thing", "Köln_en$ts"}],
               tag: "ELECTRIC REVOKE"
             }
    end

    test "parse revoke all" do
      sql = "ELECTRIC REVOKE ALL ON thing.Köln_en$ts FROM (projects, 'house.admin');"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 revokes: [
                   %SatPerms.Revoke{
                     id: "7nwvujrdfzxc6i2733x2bl3z72ea7htc",
                     privilege: :SELECT,
                     table: Proto.table("thing", "köln_en$ts"),
                     role: Proto.role("house.admin"),
                     scope: Proto.table("my_default", "projects")
                   },
                   %SatPerms.Revoke{
                     id: "tuanwoqchn5fvfkffu6bvjdhqkogo6nd",
                     privilege: :INSERT,
                     table: Proto.table("thing", "köln_en$ts"),
                     role: Proto.role("house.admin"),
                     scope: Proto.table("my_default", "projects")
                   },
                   %SatPerms.Revoke{
                     id: "5re2yqzv7oogtv7p7pyt7cmfxtnl3bpo",
                     privilege: :UPDATE,
                     table: Proto.table("thing", "köln_en$ts"),
                     role: Proto.role("house.admin"),
                     scope: Proto.table("my_default", "projects")
                   },
                   %SatPerms.Revoke{
                     id: "cpqo4as7pkf4coouxze6xfec2bd65hio",
                     privilege: :DELETE,
                     table: Proto.table("thing", "köln_en$ts"),
                     role: Proto.role("house.admin"),
                     scope: Proto.table("my_default", "projects")
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "köln_en$ts"}],
               tag: "ELECTRIC REVOKE"
             }
    end

    test "parse revoke fails with string for table" do
      sql = "ELECTRIC REVOKE UPDATE ON 'thing.Köln_en$ts' FROM (projects, 'house.admin');"
      {:error, _} = Parser.parse(sql)
    end

    test "parse revoke cols" do
      sql =
        "ELECTRIC REVOKE UPDATE (status, name) ON thing.Köln_en$ts FROM (projects, 'house.admin');"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 revokes: [
                   %SatPerms.Revoke{
                     id: "5re2yqzv7oogtv7p7pyt7cmfxtnl3bpo",
                     privilege: :UPDATE,
                     table: Proto.table("thing", "köln_en$ts"),
                     role: Proto.role("house.admin"),
                     scope: Proto.table("my_default", "projects")
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "köln_en$ts"}],
               tag: "ELECTRIC REVOKE"
             }
    end

    test "parse revoke namespaced scope" do
      sql =
        "ELECTRIC REVOKE UPDATE (status, name) ON thing.Köln_en$ts FROM (thing.projects, 'house.admin');"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 revokes: [
                   %SatPerms.Revoke{
                     id: "lwxqdr32qyfd6g7e3jfiioid4pxv7j2i",
                     privilege: :UPDATE,
                     table: Proto.table("thing", "köln_en$ts"),
                     role: Proto.role("house.admin"),
                     scope: Proto.table("thing", "projects")
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "köln_en$ts"}],
               tag: "ELECTRIC REVOKE"
             }
    end

    test "parse revoke multiple permissions" do
      sql =
        "ELECTRIC REVOKE WRITE (status, name) ON thing.Köln_en$ts FROM (thing.projects, 'house.admin');"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 revokes: [
                   %SatPerms.Revoke{
                     id: "ew7qw5tu7zaqwuwv72cdppnqbbynzpoj",
                     privilege: :INSERT,
                     table: Proto.table("thing", "köln_en$ts"),
                     role: Proto.role("house.admin"),
                     scope: Proto.table("thing", "projects")
                   },
                   %SatPerms.Revoke{
                     id: "lwxqdr32qyfd6g7e3jfiioid4pxv7j2i",
                     privilege: :UPDATE,
                     table: Proto.table("thing", "köln_en$ts"),
                     role: Proto.role("house.admin"),
                     scope: Proto.table("thing", "projects")
                   },
                   %SatPerms.Revoke{
                     id: "7ocohdpexauh56fkfgsakqeldvposuvw",
                     privilege: :DELETE,
                     table: Proto.table("thing", "köln_en$ts"),
                     role: Proto.role("house.admin"),
                     scope: Proto.table("thing", "projects")
                   }
                 ]
               },
               stmt: sql,
               tables: [{"thing", "köln_en$ts"}],
               tag: "ELECTRIC REVOKE"
             }
    end
  end

  describe "ELECTRIC DISABLE" do
    test "parses" do
      sql = "ALTER TABLE things DISABLE ELECTRIC;"

      assert parse(sql) == %Command{
               action: %Command.Disable{
                 table_name: {"my_default", "things"}
               },
               stmt: sql,
               tables: [{"my_default", "things"}],
               tag: "ELECTRIC DISABLE"
             }
    end

    test "parse disable with quoted names" do
      sql = ~s[ALTER TABLE "Private"."Items" DISABLE ELECTRIC;]

      assert parse(sql) == %Command{
               action: %Command.Disable{
                 table_name: {"Private", "Items"}
               },
               stmt: sql,
               tables: [{"Private", "Items"}],
               tag: "ELECTRIC DISABLE"
             }
    end

    test "parse disable with unquoted uppercase names" do
      sql = ~s[ALTER TABLE Private.Items DISABLE ELECTRIC;]

      assert parse(sql) == %Command{
               action: %Command.Disable{
                 table_name: {"private", "items"}
               },
               stmt: sql,
               tables: [{"private", "items"}],
               tag: "ELECTRIC DISABLE"
             }
    end
  end

  describe "ELECTRIC {EN,DIS}ABLE" do
    test "parse electrify" do
      sql = "ELECTRIC ENABLE things;"

      assert parse(sql) == %Command{
               action: %Command.Enable{
                 table_name: {"my_default", "things"}
               },
               stmt: sql,
               tables: [{"my_default", "things"}],
               tag: "ELECTRIC ENABLE"
             }
    end

    test "parse unelectrify" do
      sql = "ELECTRIC DISABLE application.things;"

      assert parse(sql) == %Command{
               action: %Command.Disable{
                 table_name: {"application", "things"}
               },
               stmt: sql,
               tables: [{"application", "things"}],
               tag: "ELECTRIC DISABLE"
             }
    end
  end

  describe "ELECTRIC UNASSIGN" do
    test "parse unassign" do
      sql = "ELECTRIC UNASSIGN 'record.reader' FROM user_permissions.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 unassigns: [
                   %SatPerms.Unassign{
                     id: "o7iyzse5guwyxjwr367hpfbmcg2irbyi",
                     table: Proto.table("my_default", "user_permissions"),
                     user_column: "user_id",
                     scope: nil,
                     role_name: "record.reader",
                     role_column: nil
                   }
                 ]
               },
               stmt: sql,
               tables: [{"my_default", "user_permissions"}],
               tag: "ELECTRIC UNASSIGN"
             }
    end

    test "parse unassign with scope" do
      sql =
        "ELECTRIC UNASSIGN (other.projects, other.user_permissions.user_role) FROM other.user_permissions.user_id;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 unassigns: [
                   %SatPerms.Unassign{
                     id: "nugp4djlkslpzpevh245r2kzurlf3k4p",
                     table: Proto.table("other", "user_permissions"),
                     user_column: "user_id",
                     scope: Proto.table("other", "projects"),
                     role_name: nil,
                     role_column: "user_role"
                   }
                 ]
               },
               stmt: sql,
               tables: [{"other", "user_permissions"}],
               tag: "ELECTRIC UNASSIGN"
             }
    end
  end

  describe "ELECTRIC SQLITE" do
    test "parse sqlite " do
      sql = "ELECTRIC SQLITE '-- a comment;';"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 sqlite: [
                   %SatPerms.Sqlite{
                     stmt: "-- a comment;"
                   }
                 ]
               },
               stmt: sql,
               tables: [],
               tag: "ELECTRIC SQLITE"
             }
    end

    test "parse sqlite with $ delim" do
      sql = "ELECTRIC SQLITE $sqlite$-- comment\nselect 'this';$sqlite$;"

      assert parse(sql) == %Command{
               action: %SatPerms.DDLX{
                 sqlite: [
                   %SatPerms.Sqlite{
                     stmt: "-- comment\nselect 'this';"
                   }
                 ]
               },
               stmt: sql,
               tables: [],
               tag: "ELECTRIC SQLITE"
             }
    end
  end
end
