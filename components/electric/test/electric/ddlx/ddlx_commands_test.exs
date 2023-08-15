defmodule DDLXCommandsTest do
  use ExUnit.Case, async: true

  @moduledoc """
  These tests expect to have an empty postgres to connect to as per init_helper_db. Warning it will delete the DB.
  """

  alias Electric.DDLX.TestHelper
  alias Electric.DDLX

  alias Electric.DDLX.Command

  alias Electric.DDLX.Command.{
    Grant,
    Revoke,
    Assign,
    Unassign,
    Enable,
    Disable,
    SQLite
  }

  @electric_grants "electric.grants"

  def init_helper_db() do
    TestHelper.init_db()
  end

  def setup_ddlx(conn) do
    # for statement <- DDLX.init_statements() do
    #   TestHelper.sql_do(conn, statement)
    # end
  end

  describe "checking statements" do
    test "check grant" do
      assert DDLX.is_ddlx("ELECTRIC GRANT then any old rubbish")
      assert DDLX.is_ddlx("ELECTRIC REVOKE then any old rubbish")
      assert not DDLX.is_ddlx("ELECTRIC ELEPHANT then any old rubbish")
    end
  end

  describe "parsing statements" do
    test "parse success" do
      sql =
        "ELECTRIC GRANT UPDATE ON thing.Köln_en$ts TO 'projects:house.admin' USING project_id CHECK (name = Paul);"

      {:ok, _} = DDLX.ddlx_to_commands(sql)
    end

    test "parse fail" do
      sql =
        "ELECTRIC GRANT JUNK ON thing.Köln_en$ts TO 'projects:house.admin' USING project_id CHECK (name = Paul);"

      {:error, %Command.Error{sql: ^sql, message: "Something went wrong near JUNK"}} =
        DDLX.ddlx_to_commands(sql)
    end
  end

  describe "setup ddlx" do
    test "tables" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)
    end
  end

  describe "creating rows in postgres from command structs" do
    test "adding a grant from electric" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      grant1 = %Grant{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["*"],
        scope: "projects",
        using_path: nil,
        check_fn: nil
      }

      TestHelper.sql_do(conn, Electric.DDLX.command_to_postgres(grant1))

      TestHelper.assert_rows(conn, @electric_grants, [
        ["update", "thing.Köln_en$ts", "house.admin", "*", "projects", nil, nil]
      ])
    end

    test "adding a grant from electric twice" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      grant1 = %Grant{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["*"],
        scope: "projects",
        using_path: nil,
        check_fn: nil
      }

      sql = Electric.DDLX.command_to_postgres(grant1)

      TestHelper.sql_do(conn, sql)
      TestHelper.sql_do(conn, sql)
    end

    test "adding a grant with multiple grant columns" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      grant1 = %Grant{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["name", "description"],
        scope: "projects",
        using_path: nil,
        check_fn: nil
      }

      TestHelper.sql_do(conn, Electric.DDLX.command_to_postgres(grant1))

      TestHelper.assert_rows(
        conn,
        @electric_grants,
        [
          ["update", "thing.Köln_en$ts", "house.admin", "name", "projects", nil, nil],
          ["update", "thing.Köln_en$ts", "house.admin", "description", "projects", nil, nil]
        ]
      )
    end

    test "adding and delete a grant" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      grant1 = %Grant{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["*"],
        scope: "projects",
        using_path: nil,
        check_fn: nil
      }

      TestHelper.sql_do(conn, Electric.DDLX.command_to_postgres(grant1))

      TestHelper.assert_rows(conn, @electric_grants, [
        ["update", "thing.Köln_en$ts", "house.admin", "*", "projects", nil, nil]
      ])

      revoke = %Revoke{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["*"],
        scope: "projects"
      }

      TestHelper.sql_do(conn, Command.pg_sql(revoke))

      TestHelper.assert_rows(
        conn,
        @electric_grants,
        []
      )
    end

    test "adding and delete a grant no op" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      grant1 = %Grant{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["*"],
        scope: "projects",
        using_path: nil,
        check_fn: nil
      }

      TestHelper.sql_do(conn, Electric.DDLX.command_to_postgres(grant1))

      TestHelper.assert_rows(conn, @electric_grants, [
        ["update", "thing.Köln_en$ts", "house.admin", "*", "projects", nil, nil]
      ])

      revoke = %Revoke{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["name"],
        scope: "projects"
      }

      TestHelper.sql_do(conn, Electric.DDLX.command_to_postgres(revoke))

      TestHelper.assert_rows(conn, @electric_grants, [
        ["update", "thing.Köln_en$ts", "house.admin", "*", "projects", nil, nil]
      ])
    end

    test "adding a grant with using path" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      grant1 = %Grant{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["*"],
        scope: "projects",
        using_path: "project_id",
        check_fn: nil
      }

      TestHelper.sql_do(conn, Electric.DDLX.command_to_postgres(grant1))

      TestHelper.assert_rows(conn, @electric_grants, [
        ["update", "thing.Köln_en$ts", "house.admin", "*", "projects", "project_id", nil]
      ])
    end

    test "assign creates an assignment" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      projects_sql = """
      CREATE TABLE projects(
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(64) NOT NULL);
      """

      TestHelper.sql_do(conn, projects_sql)

      users_sql = """
      CREATE TABLE users(
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(64) NOT NULL);
      """

      TestHelper.sql_do(conn, users_sql)

      memberships_sql = """
      CREATE TABLE public.memberships(
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
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

      TestHelper.sql_do(conn, memberships_sql)

      assign = %Assign{
        schema_name: "public",
        table_name: "memberships",
        user_column: "user_id",
        scope: "projects",
        role_name: nil,
        role_column: "role",
        if_statement: "hello"
      }

      TestHelper.sql_do(conn, Electric.DDLX.command_to_postgres(assign))

      TestHelper.assert_rows_slice(
        conn,
        "electric.assignments",
        [["public.memberships", "projects", "user_id", "__none__", "role", "hello"]],
        1..6
      )
    end

    test "unassign" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      projects_sql = """
      CREATE TABLE public.projects(
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(64) NOT NULL);
      """

      TestHelper.sql_do(conn, projects_sql)

      users_sql = """
      CREATE TABLE public.users(
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(64) NOT NULL);
      """

      TestHelper.sql_do(conn, users_sql)

      memberships_sql = """
      CREATE TABLE public.memberships(
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
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

      TestHelper.sql_do(conn, memberships_sql)

      assign = %Assign{
        schema_name: "public",
        table_name: "memberships",
        user_column: "user_id",
        scope: "projects",
        role_name: nil,
        role_column: "role",
        if_statement: "hello"
      }

      TestHelper.sql_do(conn, Electric.DDLX.command_to_postgres(assign))

      TestHelper.assert_rows_slice(
        conn,
        "electric.assignments",
        [["public.memberships", "projects", "user_id", "__none__", "role", "hello"]],
        1..6
      )

      unassign = %Unassign{
        schema_name: "public",
        table_name: "memberships",
        user_column: "user_id",
        scope: "projects",
        role_name: nil,
        role_column: "role"
      }

      TestHelper.sql_do(conn, Electric.DDLX.command_to_postgres(unassign))

      TestHelper.assert_rows_slice(
        conn,
        "electric.assignments",
        [],
        1..6
      )
    end

    test "enable" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      enable = %Enable{
        table_name: "test"
      }

      {:ok, _, _result} = TestHelper.sql_do(conn, Electric.DDLX.command_to_postgres(enable))
    end

    test "disable" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      disable = %Disable{
        table_name: "test"
      }

      {:ok, _, _result} = TestHelper.sql_do(conn, Electric.DDLX.command_to_postgres(disable))
    end

    test "sqlite" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      sqlite = %SQLite{
        sqlite_statement: "--hello"
      }

      {:ok, _, _result} = TestHelper.sql_do(conn, Electric.DDLX.command_to_postgres(sqlite))
    end
  end
end
