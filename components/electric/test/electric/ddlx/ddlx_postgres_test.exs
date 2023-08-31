defmodule Electric.DDLX.DDLXPostgresTest do
  use Electric.Extension.Case, async: false

  @moduletag ddlx: true

  def query(conn, query, params \\ []) do
    case :epgsql.equery(conn, query, params) do
      {:ok, _n, cols, rows} ->
        {:ok, cols, map_rows(rows)}

      {:ok, cols, rows} ->
        {:ok, cols, map_rows(rows)}

      {:ok, n} when is_integer(n) ->
        {:ok, [], []}

      {:error, error} ->
        {:error, error}
    end
  end

  defp map_rows(rows) do
    rows |> Enum.map(&Tuple.to_list/1) |> Enum.map(&null_to_nil/1)
  end

  defp null_to_nil(row) do
    Enum.map(row, fn
      :null -> nil
      value -> value
    end)
  end

  def list_tables(conn, schema \\ "public") do
    {:ok, _cols, rows} =
      query(
        conn,
        "select table_name from information_schema.tables WHERE table_schema = $1",
        [schema]
      )

    for [col | _] <- rows, do: col
  end

  def assert_tables(conn, table_names) do
    existing = list_tables(conn)
    assert MapSet.new(existing) == MapSet.new(table_names)
  end

  def assert_table(conn, table_name, desired_columns) do
    existing_columns = list_columns(conn, table_name)

    Enum.each(desired_columns, fn {column_name, assertions} ->
      for {attribute_name, value} <- assertions do
        #        IO.inspect(existing_columns[column_name][attribute_name])
        #        IO.inspect(value)
        assert(
          existing_columns[column_name][attribute_name] == value,
          "Column assertion failed on #{table_name} #{column_name} #{attribute_name}, #{existing_columns[column_name][attribute_name]} != #{value}\n"
        )
      end
    end)
  end

  def list_columns(conn, table_name) do
    {:ok, columns, rows} =
      query(conn, "select * from information_schema.columns WHERE table_name = $1", [table_name])

    column_names = Enum.map(columns, &elem(&1, 1))
    column_name_index = Enum.find_index(column_names, &(&1 == "column_name"))

    for row <- rows, into: %{} do
      column_name = Enum.at(row, column_name_index)

      attrs =
        for {k, v} <- Enum.zip(column_names, row), into: %{} do
          {k, v}
        end

      {column_name, attrs}
    end
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

  def get_foreign_keys(conn, table_name) do
    query_str = """
      SELECT sch.nspname                                           AS "from_schema",
             tbl.relname                                           AS "from_table",
             ARRAY_AGG(col.attname ORDER BY u.attposition)::text[] AS "from_columns",
             f_sch.nspname                                         AS "to_schema",
             f_tbl.relname                                         AS "to_table",
             ARRAY_AGG(f_col.attname ORDER BY f_u.attposition)::text[] AS "to_columns",
             ARRAY_AGG((SELECT data_type FROM information_schema.columns WHERE table_name = $1 and column_name = col.attname) ORDER BY f_u.attposition)::text[] AS "to_types"
          FROM pg_constraint c
                 LEFT JOIN LATERAL UNNEST(c.conkey) WITH ORDINALITY AS u(attnum, attposition) ON TRUE
                 LEFT JOIN LATERAL UNNEST(c.confkey) WITH ORDINALITY AS f_u(attnum, attposition) ON f_u.attposition = u.attposition
                 JOIN pg_class tbl ON tbl.oid = c.conrelid
                 JOIN pg_namespace sch ON sch.oid = tbl.relnamespace
                 LEFT JOIN pg_attribute col ON (col.attrelid = tbl.oid AND col.attnum = u.attnum)
                 LEFT JOIN pg_class f_tbl ON f_tbl.oid = c.confrelid
                 LEFT JOIN pg_namespace f_sch ON f_sch.oid = f_tbl.relnamespace
                 LEFT JOIN pg_attribute f_col ON (f_col.attrelid = f_tbl.oid AND f_col.attnum = f_u.attnum)
          WHERE c.contype = 'f' and tbl.relname = $2
          GROUP BY "from_schema", "from_table", "to_schema", "to_table"
          ORDER BY "from_schema", "from_table";
    """

    {:ok, _cols, rows} = query(conn, query_str, [table_name, table_name])

    rows
  end

  describe "testing creation of table and functions in postgres on init" do
    test_tx "creates grants table", fn conn ->
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

      assert_table(conn, "grants", grants_column_asserts)
    end

    test_tx "creates assignments table", fn conn ->
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

      assert_table(conn, "assignments", assignments_column_asserts)
    end

    test_tx "creates roles table", fn conn ->
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

      assert_table(conn, "roles", roles_column_asserts)
    end

    test_tx "add ddlx functions", fn conn ->
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

      {:ok, _, rows} = query(conn, func_sql)

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

      installed_funcs = List.flatten(rows)

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
  end

  def set_up_assignment_compound(conn) do
    projects_sql = """
    CREATE TABLE public.projects(
      id uuid DEFAULT uuid_generate_v4(),
      name VARCHAR(64) NOT NULL,
      PRIMARY KEY (id, name)
    );
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

    query(conn, memberships_sql)
  end

  def set_up_assignment_compound_membership(conn) do
    projects_sql = """
    CREATE TABLE public.projects(
      id uuid DEFAULT uuid_generate_v4(),
      name VARCHAR(64) NOT NULL,
      PRIMARY KEY (id, name)
    );
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

    query(conn, memberships_sql)
  end

  describe "testing postgres functions" do
    test_tx "adding a grant", fn conn ->
      pg_sql = """
      SELECT electric.grant('update', 'things', 'admin' , ARRAY['one', 'two'], 'project', 'project_id', 'function body')
      """

      query(conn, pg_sql)

      assert_rows(
        conn,
        "electric.grants",
        [
          ["update", "things", "admin", "one", "project", "project_id", "function body"],
          ["update", "things", "admin", "two", "project", "project_id", "function body"]
        ]
      )
    end

    test_tx "removing a grant", fn conn ->
      pg_sql = """
      SELECT electric.grant('update', 'things', 'admin' , ARRAY['one', 'two'], 'project', 'project_id', 'function body')
      """

      query(conn, pg_sql)

      assert_rows(
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

      query(conn, pg_sql2)

      assert_rows(
        conn,
        "electric.grants",
        [["update", "things", "admin", "two", "project", "project_id", "function body"]]
      )
    end

    test_tx "assign creates an assignment", fn conn ->
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

      {:ok, _, rows} = query(conn, pg_sql)

      assert rows == [[true]]

      assert_rows_slice(
        conn,
        "electric.assignments",
        [["public.memberships", "projects", "user_id", "__none__", "role", "hello"]],
        1..6
      )
    end

    test_tx "assign with scope compound key makes join table", fn conn ->
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

      {:ok, _, rows} = query(conn, pg_sql)

      assert rows == [[true]]

      {:ok, _, rows} = query(conn, "select * from electric.assignments")
      row = List.first(rows)

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
      uuid_string = assignment_id |> String.replace("-", "_")
      join_table_name = "assignment_#{uuid_string}_join"

      tables = list_tables(conn, "electric")

      assert join_table_name in tables
      columns = list_columns(conn, join_table_name)

      assert %{
               "assignment_id" => _,
               "id" => _,
               "project_id" => _,
               "project_name" => _,
               "memberships_id" => _,
               "user_id" => _
             } = columns

      fks = get_foreign_keys(conn, join_table_name)

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

    test_tx "assign makes functions and triggers", fn conn ->
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

      {:ok, _, _rows} = query(conn, pg_sql)
      {:ok, _, rows} = query(conn, "select * from electric.assignments")

      row = List.first(rows)

      assignment_id = List.first(row)
      uuid_string = assignment_id |> String.replace("-", "_")

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

      {:ok, _, rows} = query(conn, func_sql)

      assert ["upsert_role_#{uuid_string}"] in rows
      assert ["cleanup_role_#{uuid_string}"] in rows

      triggers_sql = """
      SELECT
          trigger_name
      FROM
          information_schema.triggers
      WHERE
          event_object_table = 'memberships';
      """

      {:ok, _, rows} = query(conn, triggers_sql)

      assert ["electric_insert_role_#{uuid_string}"] in rows
      assert ["electric_update_role_#{uuid_string}"] in rows

      triggers_sql = """
      SELECT
          trigger_name
      FROM
          information_schema.triggers
      WHERE
          event_object_table = 'assignment_#{uuid_string}_join';
      """

      {:ok, _, rows} = query(conn, triggers_sql)
      assert ["electric_cleanup_role_#{uuid_string}"] in rows
    end

    test_tx "role assignment", fn conn ->
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

      {:ok, _, _rows} = query(conn, pg_sql)

      ## add a user, project and membership

      add_project_sql = """
      INSERT INTO projects ( name ) VALUES ( 'project_1' ) returning id;
      """

      {:ok, _query, rows} = query(conn, add_project_sql)

      project_id = List.first(List.first(rows))

      add_user_sql = """
      INSERT INTO users ( name ) VALUES ( 'paul' ) returning id;
      """

      {:ok, _, rows} = query(conn, add_user_sql)

      person_id = List.first(List.first(rows))

      add_membership_sql = """
      INSERT INTO memberships ( role, project_id, project_name, user_id ) VALUES ( 'admin', $1, 'project_1',  $2);
      """

      {:ok, _, _rows} =
        query(conn, add_membership_sql, [project_id, person_id])

      assert_rows_slice(
        conn,
        "electric.roles",
        [
          [
            "admin",
            person_id,
            "projects",
            "#{project_id}, project_1"
          ]
        ],
        1..4
      )
    end

    test_tx "role assignment with compound membership pk", fn conn ->
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

      {:ok, _, _rows} = query(conn, pg_sql)

      ## add a user, project and membership

      add_project_sql = """
      INSERT INTO projects ( name ) VALUES ( 'project_1' ) returning id;
      """

      {:ok, _query, rows} = query(conn, add_project_sql)

      project_id = List.first(List.first(rows))

      add_user_sql = """
      INSERT INTO users ( name ) VALUES ( 'paul' ) returning id;
      """

      {:ok, _, rows} = query(conn, add_user_sql)

      person_id = List.first(List.first(rows))

      add_membership_sql = """
      INSERT INTO memberships ( role, project_id, project_name, user_id ) VALUES ( 'admin', $1, 'project_1',  $2);
      """

      {:ok, _, _rows} =
        query(conn, add_membership_sql, [project_id, person_id])

      assert_rows_slice(
        conn,
        "electric.roles",
        [
          [
            "admin",
            person_id,
            "projects",
            "#{project_id}, project_1"
          ]
        ],
        1..4
      )
    end

    test_tx "dupelicate assignment fails", fn conn ->
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

      {:ok, _, _rows} = query(conn, pg_sql)

      pg_sql = """
      SELECT electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => null,
        role_column_name => 'role',
        if_fn => 'TRUE');
      """

      {:error, {:error, :error, _code, :unique_violation, _message, params}} = query(conn, pg_sql)
      assert params[:constraint_name] == "unique_assign"
    end

    test_tx "role update", fn conn ->
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

      {:ok, _, _rows} = query(conn, pg_sql)

      ## add a user, project and membership

      add_project_sql = """
      INSERT INTO projects ( name ) VALUES ( 'project_1' ) returning id;
      """

      {:ok, _query, rows} = query(conn, add_project_sql)

      project_id = List.first(List.first(rows))

      add_user_sql = """
      INSERT INTO users ( name ) VALUES ( 'paul' ) returning id;
      """

      {:ok, _, rows} = query(conn, add_user_sql)

      person_id = List.first(List.first(rows))

      add_membership_sql = """
      INSERT INTO memberships ( role, project_id, project_name, user_id ) VALUES ( 'admin', $1, 'project_1',  $2) returning id;
      """

      {:ok, _, rows} =
        query(conn, add_membership_sql, [project_id, person_id])

      membership_id = List.first(List.first(rows))

      assert_rows_slice(
        conn,
        "electric.roles",
        [
          [
            "admin",
            person_id,
            "projects",
            "#{project_id}, project_1"
          ]
        ],
        1..4
      )

      update_membership_sql = """
      UPDATE memberships SET role = 'member' WHERE id = $1;
      """

      {:ok, _, _rows} = query(conn, update_membership_sql, [membership_id])

      assert_rows_slice(
        conn,
        "electric.roles",
        [
          [
            "member",
            person_id,
            "projects",
            "#{project_id}, project_1"
          ]
        ],
        1..4
      )
    end

    test_tx "role removed by func", fn conn ->
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

      {:ok, _, _rows} = query(conn, pg_sql)

      ## add a user, project and membership

      add_project_sql = """
      INSERT INTO projects ( name ) VALUES ( 'project_1' ) returning id;
      """

      {:ok, _query, rows} = query(conn, add_project_sql)

      project_id = List.first(List.first(rows))

      add_user_sql = """
      INSERT INTO users ( name ) VALUES ( 'paul' ) returning id;
      """

      {:ok, _, rows} = query(conn, add_user_sql)

      person_id = List.first(List.first(rows))

      add_membership_sql = """
      INSERT INTO memberships ( role, project_id, project_name, user_id ) VALUES ( 'admin', $1, 'project_1',  $2) returning id;
      """

      {:ok, _, rows} =
        query(conn, add_membership_sql, [project_id, person_id])

      membership_id = List.first(List.first(rows))

      assert_rows_slice(
        conn,
        "electric.roles",
        [
          [
            "admin",
            person_id,
            "projects",
            "#{project_id}, project_1"
          ]
        ],
        1..4
      )

      update_membership_sql = """
      UPDATE memberships SET role = 'member' WHERE id = $1;
      """

      {:ok, _, _rows} = query(conn, update_membership_sql, [membership_id])

      assert_rows_slice(
        conn,
        "electric.roles",
        [],
        1..4
      )
    end

    test_tx "assign with no scope from string and update", fn conn ->
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
        user_id uuid NOT NULL,
        CONSTRAINT user_fk
          FOREIGN KEY(user_id)
          REFERENCES users(id)
      );
      """

      query(conn, memberships_sql)

      pg_sql = """
      SELECT * FROM electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => null,
        user_column_name => 'user_id',
        role_name_string => null,
        role_column_name => 'role',
        if_fn => null);
      """

      {:ok, _, rows} = query(conn, pg_sql)

      assert rows == [[true]]

      assert_rows_slice(
        conn,
        "electric.assignments",
        [["public.memberships", "__none__", "user_id", "__none__", "role", nil]],
        1..6
      )

      add_user_sql = """
      INSERT INTO users ( name ) VALUES ( 'paul' ) returning id;
      """

      {:ok, _cols, rows} = query(conn, add_user_sql)

      [[person_id | _] | _] = rows

      add_membership_sql = """
      INSERT INTO memberships ( role, user_id ) VALUES ( 'admin', $1) returning id;
      """

      {:ok, _, rows} = query(conn, add_membership_sql, [person_id])

      [[membership_id | _] | _] = rows

      assert_rows_slice(
        conn,
        "electric.roles",
        [["admin", person_id, nil, nil]],
        1..4
      )

      update_membership_sql = """
      UPDATE memberships SET role = 'member' WHERE id = $1;
      """

      {:ok, _, _rows} = query(conn, update_membership_sql, [membership_id])

      assert_rows_slice(
        conn,
        "electric.roles",
        [["member", person_id, nil, nil]],
        1..4
      )
    end

    test_tx "assign fails with bad scope", fn conn ->
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
        user_id uuid NOT NULL,
        CONSTRAINT user_fk
          FOREIGN KEY(user_id)
          REFERENCES users(id)
      );
      """

      query(conn, memberships_sql)

      pg_sql = """
      SELECT electric.assign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => 'member',
        role_column_name => null,
        if_fn => null);
      """

      {:error, _error} = query(conn, pg_sql)
    end

    test_tx "unassign cleans up", fn conn ->
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

      {:ok, _, rows} = query(conn, pg_sql)

      assert rows == [[true]]

      {:ok, _, rows} = query(conn, "select * from electric.assignments")
      row = List.first(rows)

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
      uuid_string = assignment_id |> String.replace("-", "_")

      join_table_name = "assignment_#{uuid_string}_join"

      tables = list_tables(conn, "electric")

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

      {:ok, _, rows} = query(conn, func_sql)

      assert ["upsert_role_#{uuid_string}"] in rows
      assert ["cleanup_role_#{uuid_string}"] in rows

      triggers_sql = """
      SELECT
          trigger_name
      FROM
          information_schema.triggers
      WHERE
          event_object_table = 'memberships';
      """

      {:ok, _, rows} = query(conn, triggers_sql)

      assert ["electric_insert_role_#{uuid_string}"] in rows
      assert ["electric_update_role_#{uuid_string}"] in rows

      pg_sql = """
      SELECT electric.unassign(assign_schema => 'public',
        assign_table => 'memberships',
        scope => 'projects',
        user_column_name => 'user_id',
        role_name_string => null,
        role_column_name => 'role');
      """

      {:ok, _, _rows} = query(conn, pg_sql)

      tables = list_tables(conn, "electric")

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

      {:ok, _, rows} = query(conn, func_sql)

      assert ["upsert_role_#{uuid_string}"] not in rows
      assert ["cleanup_role_#{uuid_string}"] not in rows

      triggers_sql = """
      SELECT
          trigger_name
      FROM
          information_schema.triggers
      WHERE
          event_object_table = 'memberships';
      """

      {:ok, _, rows} = query(conn, triggers_sql)

      assert ["electric_insert_role_#{uuid_string}"] not in rows
      assert ["electric_update_role_#{uuid_string}"] not in rows
    end
  end
end
