defmodule Electric.DDLX.DDLXCommandsTest do
  use Electric.Extension.Case, async: false
  import ElectricTest.DDLXHelpers

  alias Electric.DDLX
  alias Electric.DDLX.Command

  @moduletag ddlx: true

  @electric_grants "electric.grants"

  describe "parsing statements" do
    test "parse success" do
      sql =
        "ELECTRIC GRANT UPDATE ON thing.Köln_en$ts TO 'projects:house.admin' USING project_id CHECK (name = Paul);"

      {:ok, _} = DDLX.parse(sql)
    end

    test "parse fail" do
      sql =
        "ELECTRIC GRANT JUNK ON thing.Köln_en$ts TO 'projects:house.admin' USING project_id CHECK (name = Paul);"

      {:error, %Command.Error{sql: ^sql, message: "syntax error before: <<\"JUNK\">>"}} =
        DDLX.parse(sql)
    end
  end

  describe "creating rows in postgres from command structs" do
    test_tx "adding a grant from electric", fn conn ->
      grant1 = %Command.Grant{
        privileges: ["update"],
        on_table: {"thing", "Köln_en$ts"},
        role: "house.admin",
        column_names: ["*"],
        scope: {"public", "projects"},
        using_path: nil,
        check_fn: nil
      }

      query(conn, Electric.DDLX.command_to_postgres(grant1))

      assert_rows(conn, @electric_grants, [
        [
          "update",
          quote_table(grant1.on_table),
          "house.admin",
          "*",
          quote_table(grant1.scope),
          nil,
          nil
        ]
      ])
    end

    test_tx "adding a grant from electric twice", fn conn ->
      grant1 = %Command.Grant{
        privileges: ["update"],
        on_table: {"thing", "Köln_en$ts"},
        role: "house.admin",
        column_names: ["*"],
        scope: {"public", "projects"},
        using_path: nil,
        check_fn: nil
      }

      sql = Electric.DDLX.command_to_postgres(grant1)

      {:ok, _, _} = query(conn, sql)
      {:ok, _, _} = query(conn, sql)
    end

    test_tx "adding a grant with multiple grant columns", fn conn ->
      grant1 = %Command.Grant{
        privileges: ["update"],
        on_table: {"thing", "Köln_en$ts"},
        role: "house.admin",
        column_names: ["name", "description"],
        scope: {"public", "projects"},
        using_path: nil,
        check_fn: nil
      }

      query(conn, Electric.DDLX.command_to_postgres(grant1))

      assert_rows(
        conn,
        @electric_grants,
        [
          [
            "update",
            quote_table(grant1.on_table),
            "house.admin",
            "name",
            quote_table(grant1.scope),
            nil,
            nil
          ],
          [
            "update",
            quote_table(grant1.on_table),
            "house.admin",
            "description",
            quote_table(grant1.scope),
            nil,
            nil
          ]
        ]
      )
    end

    test_tx "adding and delete a grant", fn conn ->
      grant1 = %Command.Grant{
        privileges: ["update"],
        on_table: {"thing", "Köln_en$ts"},
        role: "house.admin",
        column_names: ["*"],
        scope: {"public", "projects"},
        using_path: nil,
        check_fn: nil
      }

      query(conn, Electric.DDLX.command_to_postgres(grant1))

      assert_rows(conn, @electric_grants, [
        [
          "update",
          quote_table(grant1.on_table),
          "house.admin",
          "*",
          quote_table(grant1.scope),
          nil,
          nil
        ]
      ])

      revoke = %Command.Revoke{
        privileges: ["update"],
        on_table: {"thing", "Köln_en$ts"},
        role: "house.admin",
        column_names: ["*"],
        scope: {"public", "projects"}
      }

      query(conn, Command.pg_sql(revoke))

      assert_rows(
        conn,
        @electric_grants,
        []
      )
    end

    def quote_table({schema, table}) do
      ~s["#{schema}"."#{table}"]
    end

    test_tx "adding and delete a grant no op", fn conn ->
      grant1 = %Command.Grant{
        privileges: ["update"],
        on_table: {"thing", "Köln_en$ts"},
        role: "house.admin",
        column_names: ["*"],
        scope: {"public", "projects"},
        using_path: nil,
        check_fn: nil
      }

      query(conn, Electric.DDLX.command_to_postgres(grant1))

      assert_rows(conn, @electric_grants, [
        [
          "update",
          quote_table(grant1.on_table),
          "house.admin",
          "*",
          quote_table(grant1.scope),
          nil,
          nil
        ]
      ])

      revoke = %Command.Revoke{
        privileges: ["update"],
        on_table: {"thing", "Köln_en$ts"},
        role: "house.admin",
        column_names: ["name"],
        scope: {"public", "projects"}
      }

      query(conn, Electric.DDLX.command_to_postgres(revoke))

      assert_rows(conn, @electric_grants, [
        [
          "update",
          quote_table(grant1.on_table),
          "house.admin",
          "*",
          quote_table(grant1.scope),
          nil,
          nil
        ]
      ])
    end

    test_tx "adding a grant with using path", fn conn ->
      grant1 = %Command.Grant{
        privileges: ["update"],
        on_table: {"thing", "Köln_en$ts"},
        role: "house.admin",
        column_names: ["*"],
        scope: {"public", "projects"},
        using_path: "project_id",
        check_fn: nil
      }

      query(conn, Electric.DDLX.command_to_postgres(grant1))

      assert_rows(conn, @electric_grants, [
        [
          "update",
          quote_table(grant1.on_table),
          "house.admin",
          "*",
          quote_table(grant1.scope),
          "project_id",
          nil
        ]
      ])
    end

    test_tx "assign creates an assignment", fn conn ->
      # {:ok, conn} = init_helper_db()
      # setup_ddlx(conn)

      projects_sql = """
      CREATE TABLE projects(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(64) NOT NULL);
      """

      query(conn, projects_sql)

      users_sql = """
      CREATE TABLE users(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(64) NOT NULL);
      """

      query(conn, users_sql)

      memberships_sql = """
      CREATE TABLE public.memberships(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        role VARCHAR(64) NOT NULL,
        project_id uuid NOT NULL,
        user_id uuid NOT NULL,
        CONSTRAINT user_fk
          FOREIGN KEY(user_id)
          REFERENCES users(id),
        CONSTRAINT project_fk
          FOREIGN KEY(project_id)
          REFERENCES projects(id)
      );
      """

      query(conn, memberships_sql)

      assign = %Command.Assign{
        table_name: {"public", "memberships"},
        user_column: "user_id",
        scope: {"public", "projects"},
        role_name: nil,
        role_column: "role",
        if_statement: "hello"
      }

      query(conn, Electric.DDLX.command_to_postgres(assign))

      assert_rows_slice(
        conn,
        "electric.assignments",
        [
          [
            quote_table(assign.table_name),
            quote_table(assign.scope),
            "user_id",
            "__none__",
            "role",
            "hello"
          ]
        ],
        1..6
      )
    end

    test_tx "unassign", fn conn ->
      projects_sql = """
      CREATE TABLE public.projects(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(64) NOT NULL);
      """

      query(conn, projects_sql)

      users_sql = """
      CREATE TABLE public.users(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(64) NOT NULL);
      """

      query(conn, users_sql)

      memberships_sql = """
      CREATE TABLE public.memberships(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        role VARCHAR(64) NOT NULL,
        project_id uuid NOT NULL,
        user_id uuid NOT NULL,
        CONSTRAINT user_fk
          FOREIGN KEY(user_id)
          REFERENCES public.users(id),
        CONSTRAINT project_fk
          FOREIGN KEY(project_id)
          REFERENCES public.projects(id)
      );
      """

      query(conn, memberships_sql)

      assign = %Command.Assign{
        table_name: {"public", "memberships"},
        user_column: "user_id",
        scope: {"public", "projects"},
        role_name: nil,
        role_column: "role",
        if_statement: "hello"
      }

      query(conn, Electric.DDLX.command_to_postgres(assign))

      assert_rows_slice(
        conn,
        "electric.assignments",
        [
          [
            quote_table(assign.table_name),
            quote_table(assign.scope),
            "user_id",
            "__none__",
            "role",
            "hello"
          ]
        ],
        1..6
      )

      unassign = %Command.Unassign{
        table_name: {"public", "memberships"},
        user_column: "user_id",
        scope: {"public", "projects"},
        role_name: nil,
        role_column: "role"
      }

      query(conn, Electric.DDLX.command_to_postgres(unassign))

      assert_rows_slice(
        conn,
        "electric.assignments",
        [],
        1..6
      )
    end

    # test_tx "disable", fn conn ->
    #   disable = %Disable{
    #     table_name: "test"
    #   }
    #
    #   {:ok, _, _result} = query(conn, Electric.DDLX.command_to_postgres(disable))
    # end
    #
    # test_tx "sqlite", fn conn ->
    #   sqlite = %SQLite{
    #     sqlite_statement: "--hello"
    #   }
    #
    #   {:ok, _, _result} = query(conn, Electric.DDLX.command_to_postgres(sqlite))
    # end
  end
end
