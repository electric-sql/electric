defmodule Electric.DDLX.DDLXCommandsTest do
  use Electric.Extension.Case, async: false
  import ElectricTest.DDLXHelpers

  alias Electric.Satellite.SatPerms
  alias ElectricTest.PermissionsHelpers.Proto

  @moduletag ddlx: true

  describe "creating rows in postgres from command structs" do
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

      assign = %SatPerms.Assign{
        table: Proto.table("public", "memberships"),
        user_column: "user_id",
        scope: Proto.table("public", "projects"),
        role_name: nil,
        role_column: "role",
        if: "hello"
      }

      query(conn, Electric.DDLX.command_to_postgres(assign))

      assert_rows_slice(
        conn,
        "electric.assignments",
        [
          [
            quote_table(assign.table),
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
      CREATE TABLE public.memberships (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        role VARCHAR(64) NOT NULL,
        project_id uuid NOT NULL REFERENCES public.projects(id),
        user_id uuid NOT NULL REFERENCES public.users (id)
      );
      """

      query(conn, memberships_sql)

      assign = %SatPerms.Assign{
        table: Proto.table("public", "memberships"),
        user_column: "user_id",
        scope: Proto.table("public", "projects"),
        role_name: nil,
        role_column: "role",
        if: "hello"
      }

      query(conn, Electric.DDLX.command_to_postgres(assign))

      assert_rows_slice(
        conn,
        "electric.assignments",
        [
          [
            quote_table(assign.table),
            quote_table(assign.scope),
            "user_id",
            "__none__",
            "role",
            "hello"
          ]
        ],
        1..6
      )

      unassign = %SatPerms.Unassign{
        table: Proto.table("public", "memberships"),
        user_column: "user_id",
        scope: Proto.table("public", "projects"),
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
