defmodule Electric.DDLX.DDLXCommandsTest do
  use Electric.Extension.Case, async: false

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

  @moduletag ddlx: true

  @electric_grants "electric.grants"

  def query(conn, query) do
    with {:ok, cols, rows} <- :epgsql.equery(conn, query, []) do
      {:ok, cols, Enum.map(rows, &Tuple.to_list/1) |> Enum.map(&null_to_nil/1)}
    end
  end

  defp null_to_nil(row) do
    Enum.map(row, fn
      :null -> nil
      value -> value
    end)
  end

  def assert_rows(conn, table_name, expected_rows) do
    {:ok, _cols, rows} = query(conn, "select * from #{table_name}")

    assert(
      rows == expected_rows,
      "Row assertion failed on #{table_name}, #{inspect(rows)} != #{inspect(expected_rows)}\n"
    )
  end

  def assert_rows_slice(conn, table_name, expected_rows, range) do
    {:ok, _cols, rows} = query(conn, "select * from #{table_name}")

    rows =
      rows
      |> Enum.map(&Enum.slice(&1, range))

    assert(
      rows == expected_rows,
      "Row assertion failed on #{table_name}, #{inspect(rows)} != #{inspect(expected_rows)}\n"
    )
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

  describe "creating rows in postgres from command structs" do
    test_tx "adding a grant from electric", fn conn ->
      grant1 = %Grant{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["*"],
        scope: "projects",
        using_path: nil,
        check_fn: nil
      }

      query(conn, Electric.DDLX.command_to_postgres(grant1))

      assert_rows(conn, @electric_grants, [
        ["update", "thing.Köln_en$ts", "house.admin", "*", "projects", nil, nil]
      ])
    end

    test_tx "adding a grant from electric twice", fn conn ->
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

      query(conn, sql)
      query(conn, sql)
    end

    test_tx "adding a grant with multiple grant columns", fn conn ->
      grant1 = %Grant{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["name", "description"],
        scope: "projects",
        using_path: nil,
        check_fn: nil
      }

      query(conn, Electric.DDLX.command_to_postgres(grant1))

      assert_rows(
        conn,
        @electric_grants,
        [
          ["update", "thing.Köln_en$ts", "house.admin", "name", "projects", nil, nil],
          ["update", "thing.Köln_en$ts", "house.admin", "description", "projects", nil, nil]
        ]
      )
    end

    test_tx "adding and delete a grant", fn conn ->
      grant1 = %Grant{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["*"],
        scope: "projects",
        using_path: nil,
        check_fn: nil
      }

      query(conn, Electric.DDLX.command_to_postgres(grant1))

      assert_rows(conn, @electric_grants, [
        ["update", "thing.Köln_en$ts", "house.admin", "*", "projects", nil, nil]
      ])

      revoke = %Revoke{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["*"],
        scope: "projects"
      }

      query(conn, Command.pg_sql(revoke))

      assert_rows(
        conn,
        @electric_grants,
        []
      )
    end

    test_tx "adding and delete a grant no op", fn conn ->
      grant1 = %Grant{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["*"],
        scope: "projects",
        using_path: nil,
        check_fn: nil
      }

      query(conn, Electric.DDLX.command_to_postgres(grant1))

      assert_rows(conn, @electric_grants, [
        ["update", "thing.Köln_en$ts", "house.admin", "*", "projects", nil, nil]
      ])

      revoke = %Revoke{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["name"],
        scope: "projects"
      }

      query(conn, Electric.DDLX.command_to_postgres(revoke))

      assert_rows(conn, @electric_grants, [
        ["update", "thing.Köln_en$ts", "house.admin", "*", "projects", nil, nil]
      ])
    end

    test_tx "adding a grant with using path", fn conn ->
      grant1 = %Grant{
        privilege: "update",
        on_table: "thing.Köln_en$ts",
        role: "house.admin",
        column_names: ["*"],
        scope: "projects",
        using_path: "project_id",
        check_fn: nil
      }

      query(conn, Electric.DDLX.command_to_postgres(grant1))

      assert_rows(conn, @electric_grants, [
        ["update", "thing.Köln_en$ts", "house.admin", "*", "projects", "project_id", nil]
      ])
    end

    test_tx "assign creates an assignment", fn conn ->
      # {:ok, conn} = init_helper_db()
      # setup_ddlx(conn)

      projects_sql = """
      CREATE TABLE projects(
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(64) NOT NULL);
      """

      query(conn, projects_sql)

      users_sql = """
      CREATE TABLE users(
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(64) NOT NULL);
      """

      query(conn, users_sql)

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

      query(conn, memberships_sql)

      assign = %Assign{
        schema_name: "public",
        table_name: "memberships",
        user_column: "user_id",
        scope: "projects",
        role_name: nil,
        role_column: "role",
        if_statement: "hello"
      }

      query(conn, Electric.DDLX.command_to_postgres(assign))

      assert_rows_slice(
        conn,
        "electric.assignments",
        [["public.memberships", "projects", "user_id", "__none__", "role", "hello"]],
        1..6
      )
    end

    test_tx "unassign", fn conn ->
      projects_sql = """
      CREATE TABLE public.projects(
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(64) NOT NULL);
      """

      query(conn, projects_sql)

      users_sql = """
      CREATE TABLE public.users(
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(64) NOT NULL);
      """

      query(conn, users_sql)

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

      query(conn, memberships_sql)

      assign = %Assign{
        schema_name: "public",
        table_name: "memberships",
        user_column: "user_id",
        scope: "projects",
        role_name: nil,
        role_column: "role",
        if_statement: "hello"
      }

      query(conn, Electric.DDLX.command_to_postgres(assign))

      assert_rows_slice(
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

      query(conn, Electric.DDLX.command_to_postgres(unassign))

      assert_rows_slice(
        conn,
        "electric.assignments",
        [],
        1..6
      )
    end

    test_tx "enable", fn conn ->
      enable = %Enable{
        table_name: "test"
      }

      {:ok, _, _result} = query(conn, Electric.DDLX.command_to_postgres(enable))
    end

    test_tx "disable", fn conn ->
      disable = %Disable{
        table_name: "test"
      }

      {:ok, _, _result} = query(conn, Electric.DDLX.command_to_postgres(disable))
    end

    test_tx "sqlite", fn conn ->
      sqlite = %SQLite{
        sqlite_statement: "--hello"
      }

      {:ok, _, _result} = query(conn, Electric.DDLX.command_to_postgres(sqlite))
    end
  end
end
