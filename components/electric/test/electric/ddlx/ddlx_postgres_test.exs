defmodule DDLXPostgresTest do
  @moduledoc """
  These tests expect to have an empty postgres to connect to as per
  init_helper_db. Warning it will delete the DB.
  """

  use ExUnit.Case

  alias Electric.DDLX.TestHelper
  alias Electric.DDLX

  @moduletag ddlx: true

  def init_helper_db() do
    TestHelper.init_db()
  end

  def setup_ddlx(conn) do
    # for statement <- DDLX.init_statements() do
    #   TestHelper.sql_do(conn, statement)
    # end
  end

  describe "testing creation of table and functions in postgres on init" do
    test "creates grants table" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      grants_column_asserts = %{
        "privilege" => %{
          "udt_name" => "varchar",
          "is_nullable" => "NO"
        },
        "on_table" => %{
          "udt_name" => "varchar",
          "is_nullable" => "NO"
        },
        "role" => %{
          "udt_name" => "varchar",
          "is_nullable" => "NO"
        },
        "column_name" => %{
          "udt_name" => "varchar",
          "is_nullable" => "NO"
        },
        "scope" => %{
          "udt_name" => "varchar",
          "is_nullable" => "NO"
        },
        "using_path" => %{
          "udt_name" => "text",
          "is_nullable" => "YES"
        },
        "check_fn" => %{
          "udt_name" => "text",
          "is_nullable" => "YES"
        }
      }

      Electric.DDLX.TestHelper.assert_table(conn, "grants", grants_column_asserts)
    end

    test "creates assignments table" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      assignments_column_asserts = %{
        "id" => %{
          "udt_name" => "uuid",
          "is_nullable" => "NO"
        },
        "table_name" => %{
          "udt_name" => "varchar",
          "is_nullable" => "NO"
        },
        "scope_table" => %{
          "udt_name" => "varchar",
          "is_nullable" => "NO"
        },
        "user_column" => %{
          "udt_name" => "varchar",
          "is_nullable" => "NO"
        },
        "role_name" => %{
          "udt_name" => "varchar",
          "is_nullable" => "NO"
        },
        "role_column" => %{
          "udt_name" => "varchar",
          "is_nullable" => "NO"
        },
        "if_fn" => %{
          "udt_name" => "text",
          "is_nullable" => "YES"
        }
      }

      Electric.DDLX.TestHelper.assert_table(conn, "assignments", assignments_column_asserts)
    end

    test "creates roles table" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      roles_column_asserts = %{
        "id" => %{
          "udt_name" => "uuid",
          "is_nullable" => "NO"
        },
        "role" => %{
          "udt_name" => "varchar",
          "is_nullable" => "NO"
        },
        "user_id" => %{
          "udt_name" => "varchar",
          "is_nullable" => "NO"
        },
        "scope_table" => %{
          "udt_name" => "varchar",
          "is_nullable" => "YES"
        },
        "scope_id" => %{
          "udt_name" => "varchar",
          "is_nullable" => "YES"
        }
      }

      Electric.DDLX.TestHelper.assert_table(conn, "roles", roles_column_asserts)
    end

    test "add ddlx functions" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      func_sql = """
      SELECT
          routine_name
      FROM
          information_schema.routines
      WHERE
          routine_type = 'FUNCTION'
      AND
          routine_schema = 'electric';
      """

      {:ok, _, result} = TestHelper.sql_do(conn, func_sql)

      expected_funcs = [
        "enable",
        "disable",
        "grant",
        "revoke",
        "assign",
        "unassign",
        "sqlite",
        "find_fk_to_table",
        "find_fk_for_column",
        "find_pk"
      ]

      installed_funcs = List.flatten(result.rows)

      for f <- expected_funcs do
        assert f in installed_funcs
      end
    end
  end

  def set_up_assignment(conn) do
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
  end

  def set_up_assignment_compound(conn) do
    projects_sql = """
    CREATE TABLE public.projects(
      id uuid DEFAULT uuid_generate_v4(),
      name VARCHAR(64) NOT NULL,
      PRIMARY KEY (id, name)
    );
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
      project_name VARCHAR(64) NOT NULL,
      user_id uuid NOT NULL,
      CONSTRAINT user_fk
        FOREIGN KEY(user_id)
        REFERENCES users(id),
      CONSTRAINT project_fk
        FOREIGN KEY(project_id, project_name)
        REFERENCES projects(id, name)
    );
    """

    TestHelper.sql_do(conn, memberships_sql)
  end

  def set_up_assignment_compound_membership(conn) do
    projects_sql = """
    CREATE TABLE public.projects(
      id uuid DEFAULT uuid_generate_v4(),
      name VARCHAR(64) NOT NULL,
      PRIMARY KEY (id, name)
    );
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
      role VARCHAR(64) NOT NULL,
      project_id uuid NOT NULL,
      project_name VARCHAR(64) NOT NULL,
      user_id uuid NOT NULL,
      CONSTRAINT user_fk
        FOREIGN KEY(user_id)
        REFERENCES users(id),
      CONSTRAINT project_fk
        FOREIGN KEY(project_id, project_name)
        REFERENCES projects(id, name),
      PRIMARY KEY (user_id, project_id, project_name)
    );
    """

    TestHelper.sql_do(conn, memberships_sql)
  end

  describe "testing postgres functions" do
    test "adding a grant" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      pg_sql = """
      SELECT electric.grant('update', 'things', 'admin' , ARRAY['one', 'two'], 'project', 'project_id', 'function body')
      """

      TestHelper.sql_do(conn, pg_sql)

      TestHelper.assert_rows(
        conn,
        "electric.grants",
        [
          ["update", "things", "admin", "one", "project", "project_id", "function body"],
          ["update", "things", "admin", "two", "project", "project_id", "function body"]
        ]
      )
    end

    test "removing a grant" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

      pg_sql = """
      SELECT electric.grant('update', 'things', 'admin' , ARRAY['one', 'two'], 'project', 'project_id', 'function body')
      """

      TestHelper.sql_do(conn, pg_sql)

      TestHelper.assert_rows(
        conn,
        "electric.grants",
        [
          ["update", "things", "admin", "one", "project", "project_id", "function body"],
          ["update", "things", "admin", "two", "project", "project_id", "function body"]
        ]
      )

      pg_sql2 = """
      SELECT electric.revoke('update', 'things', 'admin' , ARRAY['one'], 'project')
      """

      TestHelper.sql_do(conn, pg_sql2)

      TestHelper.assert_rows(
        conn,
        "electric.grants",
        [["update", "things", "admin", "two", "project", "project_id", "function body"]]
      )
    end

    test "assign creates an assignment" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)
      set_up_assignment(conn)

      pg_sql = """
      SELECT electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => null,
        role_column_name => 'role',
        if_fn => 'hello');
      """

      {:ok, _, result} = TestHelper.sql_do(conn, pg_sql)

      assert result.rows == [[true]]

      TestHelper.assert_rows_slice(
        conn,
        "electric.assignments",
        [["public.memberships", "projects", "user_id", "__none__", "role", "hello"]],
        1..6
      )
    end

    test "assign with scope compound key makes join table" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)
      set_up_assignment_compound(conn)

      pg_sql = """
      SELECT electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => null,
        role_column_name => 'role',
        if_fn => 'hello');
      """

      {:ok, _, result} = TestHelper.sql_do(conn, pg_sql)

      assert result.rows == [[true]]

      {:ok, _, result} = TestHelper.sql_do(conn, "select * from electric.assignments")
      row = List.first(result.rows)

      assert Enum.slice(row, 1..6) == [
               "public.memberships",
               "projects",
               "user_id",
               "__none__",
               "role",
               "hello"
             ]

      ## checking the join table that is created
      assignment_id = List.first(row)
      uuid_string = UUID.binary_to_string!(assignment_id) |> String.replace("-", "_")
      join_table_name = "assignment_#{uuid_string}_join"

      tables = TestHelper.list_tables_in_schema(conn, "electric")

      assert join_table_name in tables
      columns = TestHelper.list_columns(conn, join_table_name)

      assert %{
               "assignment_id" => _,
               "id" => _,
               "project_id" => _,
               "project_name" => _,
               "memberships_id" => _,
               "user_id" => _
             } = columns

      fks = TestHelper.get_foreign_keys(conn, join_table_name)

      assert Enum.sort([
               [
                 "electric",
                 join_table_name,
                 ["assignment_id"],
                 "electric",
                 "assignments",
                 ["id"],
                 ["uuid"]
               ],
               [
                 "electric",
                 join_table_name,
                 ["role_id"],
                 "electric",
                 "roles",
                 ["id"],
                 ["uuid"]
               ],
               [
                 "electric",
                 join_table_name,
                 ["memberships_id"],
                 "public",
                 "memberships",
                 ["id"],
                 ["uuid"]
               ],
               [
                 "electric",
                 join_table_name,
                 ["project_id", "project_name"],
                 "public",
                 "projects",
                 ["id", "name"],
                 ["uuid", "character varying"]
               ],
               [
                 "electric",
                 join_table_name,
                 ["user_id"],
                 "public",
                 "users",
                 ["id"],
                 ["uuid"]
               ]
             ]) == Enum.sort(fks)
    end

    test "assign makes functions and triggers" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)
      set_up_assignment_compound(conn)

      pg_sql = """
      SELECT electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => null,
        role_column_name => 'role',
        if_fn => 'hello');
      """

      {:ok, _, _result} = TestHelper.sql_do(conn, pg_sql)
      {:ok, _, result} = TestHelper.sql_do(conn, "select * from electric.assignments")

      row = List.first(result.rows)

      assignment_id = List.first(row)
      uuid_string = UUID.binary_to_string!(assignment_id) |> String.replace("-", "_")

      func_sql = """
      SELECT
          routine_name
      FROM
          information_schema.routines
      WHERE
          routine_type = 'FUNCTION'
      AND
          routine_schema = 'electric';
      """

      {:ok, _, result} = TestHelper.sql_do(conn, func_sql)

      assert ["upsert_role_#{uuid_string}"] in result.rows
      assert ["cleanup_role_#{uuid_string}"] in result.rows

      triggers_sql = """
      SELECT
          trigger_name
      FROM
          information_schema.triggers
      WHERE
          event_object_table = 'memberships';
      """

      {:ok, _, result} = TestHelper.sql_do(conn, triggers_sql)

      assert ["electric_insert_role_#{uuid_string}"] in result.rows
      assert ["electric_update_role_#{uuid_string}"] in result.rows

      triggers_sql = """
      SELECT
          trigger_name
      FROM
          information_schema.triggers
      WHERE
          event_object_table = 'assignment_#{uuid_string}_join';
      """

      {:ok, _, result} = TestHelper.sql_do(conn, triggers_sql)
      assert ["electric_cleanup_role_#{uuid_string}"] in result.rows
    end

    test "role assignment" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)
      set_up_assignment_compound(conn)

      pg_sql = """
      SELECT electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => null,
        role_column_name => 'role',
        if_fn => 'TRUE');
      """

      {:ok, _, _result} = TestHelper.sql_do(conn, pg_sql)

      ## add a user, project and membership

      add_project_sql = """
      INSERT INTO projects ( name ) VALUES ( 'project_1' ) returning id;
      """

      {:ok, _query, result} = TestHelper.sql_do(conn, add_project_sql)

      project_id = List.first(List.first(result.rows))

      add_user_sql = """
      INSERT INTO users ( name ) VALUES ( 'paul' ) returning id;
      """

      {:ok, _, result} = TestHelper.sql_do(conn, add_user_sql)

      person_id = List.first(List.first(result.rows))

      add_membership_sql = """
      INSERT INTO memberships ( role, project_id, project_name, user_id ) VALUES ( 'admin', $1, 'project_1',  $2);
      """

      {:ok, _, _result} =
        TestHelper.sql_do_params(conn, add_membership_sql, [project_id, person_id])

      TestHelper.assert_rows_slice(
        conn,
        "electric.roles",
        [
          [
            "admin",
            UUID.binary_to_string!(person_id),
            "projects",
            "#{UUID.binary_to_string!(project_id)}, project_1"
          ]
        ],
        1..4
      )
    end

    test "role assignment with compound membership pk" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)
      set_up_assignment_compound_membership(conn)

      pg_sql = """
      SELECT electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => null,
        role_column_name => 'role',
        if_fn => 'TRUE');
      """

      {:ok, _, _result} = TestHelper.sql_do(conn, pg_sql)

      ## add a user, project and membership

      add_project_sql = """
      INSERT INTO projects ( name ) VALUES ( 'project_1' ) returning id;
      """

      {:ok, _query, result} = TestHelper.sql_do(conn, add_project_sql)

      project_id = List.first(List.first(result.rows))

      add_user_sql = """
      INSERT INTO users ( name ) VALUES ( 'paul' ) returning id;
      """

      {:ok, _, result} = TestHelper.sql_do(conn, add_user_sql)

      person_id = List.first(List.first(result.rows))

      add_membership_sql = """
      INSERT INTO memberships ( role, project_id, project_name, user_id ) VALUES ( 'admin', $1, 'project_1',  $2);
      """

      {:ok, _, _result} =
        TestHelper.sql_do_params(conn, add_membership_sql, [project_id, person_id])

      TestHelper.assert_rows_slice(
        conn,
        "electric.roles",
        [
          [
            "admin",
            UUID.binary_to_string!(person_id),
            "projects",
            "#{UUID.binary_to_string!(project_id)}, project_1"
          ]
        ],
        1..4
      )
    end

    test "dupelicate assignment fails" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)
      set_up_assignment_compound(conn)

      pg_sql = """
      SELECT electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => null,
        role_column_name => 'role',
        if_fn => 'TRUE');
      """

      {:ok, _, _result} = TestHelper.sql_do(conn, pg_sql)

      pg_sql = """
      SELECT electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => null,
        role_column_name => 'role',
        if_fn => 'TRUE');
      """

      {:error,
       %Postgrex.Error{
         message: nil,
         postgres: %{code: :unique_violation, constraint: "unique_assign"}
       }} = TestHelper.sql_do(conn, pg_sql)
    end

    test "role update" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)
      set_up_assignment_compound(conn)

      pg_sql = """
      SELECT electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => null,
        role_column_name => 'role',
        if_fn => 'TRUE');
      """

      {:ok, _, _result} = TestHelper.sql_do(conn, pg_sql)

      ## add a user, project and membership

      add_project_sql = """
      INSERT INTO projects ( name ) VALUES ( 'project_1' ) returning id;
      """

      {:ok, _query, result} = TestHelper.sql_do(conn, add_project_sql)

      project_id = List.first(List.first(result.rows))

      add_user_sql = """
      INSERT INTO users ( name ) VALUES ( 'paul' ) returning id;
      """

      {:ok, _, result} = TestHelper.sql_do(conn, add_user_sql)

      person_id = List.first(List.first(result.rows))

      add_membership_sql = """
      INSERT INTO memberships ( role, project_id, project_name, user_id ) VALUES ( 'admin', $1, 'project_1',  $2) returning id;
      """

      {:ok, _, result} =
        TestHelper.sql_do_params(conn, add_membership_sql, [project_id, person_id])

      membership_id = List.first(List.first(result.rows))

      TestHelper.assert_rows_slice(
        conn,
        "electric.roles",
        [
          [
            "admin",
            UUID.binary_to_string!(person_id),
            "projects",
            "#{UUID.binary_to_string!(project_id)}, project_1"
          ]
        ],
        1..4
      )

      update_membership_sql = """
      UPDATE memberships SET role = 'member' WHERE id = $1;
      """

      {:ok, _, _result} = TestHelper.sql_do_params(conn, update_membership_sql, [membership_id])

      TestHelper.assert_rows_slice(
        conn,
        "electric.roles",
        [
          [
            "member",
            UUID.binary_to_string!(person_id),
            "projects",
            "#{UUID.binary_to_string!(project_id)}, project_1"
          ]
        ],
        1..4
      )
    end

    test "role removed by func" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)
      set_up_assignment_compound(conn)

      pg_sql = """
      SELECT electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => 'admin',
        role_column_name => null,
        if_fn => E'NEW.role = \\'admin\\'');
      """

      {:ok, _, _result} = TestHelper.sql_do(conn, pg_sql)

      ## add a user, project and membership

      add_project_sql = """
      INSERT INTO projects ( name ) VALUES ( 'project_1' ) returning id;
      """

      {:ok, _query, result} = TestHelper.sql_do(conn, add_project_sql)

      project_id = List.first(List.first(result.rows))

      add_user_sql = """
      INSERT INTO users ( name ) VALUES ( 'paul' ) returning id;
      """

      {:ok, _, result} = TestHelper.sql_do(conn, add_user_sql)

      person_id = List.first(List.first(result.rows))

      add_membership_sql = """
      INSERT INTO memberships ( role, project_id, project_name, user_id ) VALUES ( 'admin', $1, 'project_1',  $2) returning id;
      """

      {:ok, _, result} =
        TestHelper.sql_do_params(conn, add_membership_sql, [project_id, person_id])

      membership_id = List.first(List.first(result.rows))

      TestHelper.assert_rows_slice(
        conn,
        "electric.roles",
        [
          [
            "admin",
            UUID.binary_to_string!(person_id),
            "projects",
            "#{UUID.binary_to_string!(project_id)}, project_1"
          ]
        ],
        1..4
      )

      update_membership_sql = """
      UPDATE memberships SET role = 'member' WHERE id = $1;
      """

      {:ok, _, _result} = TestHelper.sql_do_params(conn, update_membership_sql, [membership_id])

      TestHelper.assert_rows_slice(
        conn,
        "electric.roles",
        [],
        1..4
      )
    end

    test "assign with no scope from string and update" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)

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
        user_id uuid NOT NULL,
        CONSTRAINT user_fk
          FOREIGN KEY(user_id)
          REFERENCES users(id)
      );
      """

      TestHelper.sql_do(conn, memberships_sql)

      pg_sql = """
      SELECT * FROM electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => null,
        user_column_name => 'user_id',
        role_name_string => null,
        role_column_name => 'role',
        if_fn => null);
      """

      {:ok, _, result} = TestHelper.sql_do(conn, pg_sql)

      assert result.rows == [[true]]

      TestHelper.assert_rows_slice(
        conn,
        "electric.assignments",
        [["public.memberships", "__none__", "user_id", "__none__", "role", nil]],
        1..6
      )

      add_user_sql = """
      INSERT INTO users ( name ) VALUES ( 'paul' ) returning id;
      """

      {:ok, _, result} = TestHelper.sql_do(conn, add_user_sql)

      person_id = List.first(List.first(result.rows))

      add_membership_sql = """
      INSERT INTO memberships ( role, user_id ) VALUES ( 'admin', $1) returning id;
      """

      {:ok, _, result} = TestHelper.sql_do_params(conn, add_membership_sql, [person_id])

      membership_id = List.first(List.first(result.rows))

      TestHelper.assert_rows_slice(
        conn,
        "electric.roles",
        [["admin", UUID.binary_to_string!(person_id), nil, nil]],
        1..4
      )

      update_membership_sql = """
      UPDATE memberships SET role = 'member' WHERE id = $1;
      """

      {:ok, _, _result} = TestHelper.sql_do_params(conn, update_membership_sql, [membership_id])

      TestHelper.assert_rows_slice(
        conn,
        "electric.roles",
        [["member", UUID.binary_to_string!(person_id), nil, nil]],
        1..4
      )
    end

    test "assign fails with bad scope" do
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
        user_id uuid NOT NULL,
        CONSTRAINT user_fk
          FOREIGN KEY(user_id)
          REFERENCES users(id)
      );
      """

      TestHelper.sql_do(conn, memberships_sql)

      pg_sql = """
      SELECT electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => 'member',
        role_column_name => null,
        if_fn => null);
      """

      {:error, _error} = TestHelper.sql_do(conn, pg_sql)
    end

    test "unassign cleans up" do
      {:ok, conn} = init_helper_db()
      setup_ddlx(conn)
      set_up_assignment_compound(conn)

      pg_sql = """
      SELECT electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => null,
        role_column_name => 'role',
        if_fn => 'hello');
      """

      {:ok, _, result} = TestHelper.sql_do(conn, pg_sql)

      assert result.rows == [[true]]

      {:ok, _, result} = TestHelper.sql_do(conn, "select * from electric.assignments")
      row = List.first(result.rows)

      assert Enum.slice(row, 1..6) == [
               "public.memberships",
               "projects",
               "user_id",
               "__none__",
               "role",
               "hello"
             ]

      ## checking the join table that is created
      assignment_id = List.first(row)
      uuid_string = UUID.binary_to_string!(assignment_id) |> String.replace("-", "_")

      join_table_name = "assignment_#{uuid_string}_join"

      tables = TestHelper.list_tables_in_schema(conn, "electric")

      assert join_table_name in tables

      func_sql = """
      SELECT
          routine_name
      FROM
          information_schema.routines
      WHERE
          routine_type = 'FUNCTION'
      AND
          routine_schema = 'electric';
      """

      {:ok, _, result} = TestHelper.sql_do(conn, func_sql)

      assert ["upsert_role_#{uuid_string}"] in result.rows
      assert ["cleanup_role_#{uuid_string}"] in result.rows

      triggers_sql = """
      SELECT
          trigger_name
      FROM
          information_schema.triggers
      WHERE
          event_object_table = 'memberships';
      """

      {:ok, _, result} = TestHelper.sql_do(conn, triggers_sql)

      assert ["electric_insert_role_#{uuid_string}"] in result.rows
      assert ["electric_update_role_#{uuid_string}"] in result.rows

      pg_sql = """
      SELECT electric.unassign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => null,
        role_column_name => 'role');
      """

      {:ok, _, _result} = TestHelper.sql_do(conn, pg_sql)

      tables = TestHelper.list_tables_in_schema(conn, "electric")

      assert join_table_name not in tables

      func_sql = """
      SELECT
          routine_name
      FROM
          information_schema.routines
      WHERE
          routine_type = 'FUNCTION'
      AND
          routine_schema = 'electric';
      """

      {:ok, _, result} = TestHelper.sql_do(conn, func_sql)

      assert ["upsert_role_#{uuid_string}"] not in result.rows
      assert ["cleanup_role_#{uuid_string}"] not in result.rows

      triggers_sql = """
      SELECT
          trigger_name
      FROM
          information_schema.triggers
      WHERE
          event_object_table = 'memberships';
      """

      {:ok, _, result} = TestHelper.sql_do(conn, triggers_sql)

      assert ["electric_insert_role_#{uuid_string}"] not in result.rows
      assert ["electric_update_role_#{uuid_string}"] not in result.rows
    end
  end
end
