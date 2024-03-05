defmodule Electric.Satellite.Permissions.ClientTest do
  use ExUnit.Case, async: true
  use Electric.Postgres.MockSchemaLoader

  alias Electric.Satellite.Permissions

  alias ElectricTest.PermissionsHelpers
  alias ElectricTest.PermissionsHelpers.Auth
  alias ElectricTest.PermissionsHelpers.Chgs
  alias ElectricTest.PermissionsHelpers.Client
  alias ElectricTest.PermissionsHelpers.Roles
  alias ElectricTest.PermissionsHelpers.Sqlite

  import ElectricTest.PermissionsHelpers

  @comments {"public", "comments"}
  @issues {"public", "issues"}
  @offices {"public", "offices"}
  @project_memberships {"public", "project_memberships"}
  @projects {"public", "projects"}
  @reactions {"public", "reactions"}
  @regions {"public", "regions"}
  @users {"public", "users"}
  @addresses {"public", "addresses"}
  @workspaces {"public", "workspaces"}

  @compound_root {"public", "compound_root"}
  @compound_level1 {"public", "compound_level1"}
  @compound_level2 {"public", "compound_level2"}
  # @compound_memberships {"public", "compound_memberships"}

  setup do
    {:ok, loader} = PermissionsHelpers.Schema.loader()
    {:ok, schema_version} = SchemaLoader.load(loader)
    {:ok, conn} = Exqlite.Sqlite3.open(":memory:")

    conn =
      Enum.reduce(PermissionsHelpers.Schema.migrations(), conn, fn {_version, stmts}, conn ->
        for stmt <- stmts do
          :ok = Exqlite.Sqlite3.execute(conn, stmt)
        end

        conn
      end)

    data = [
      {@regions, "rg1", [{@offices, "o1"}, {@offices, "o2"}]},
      {@regions, "rg2", [{@offices, "o3"}, {@offices, "o4"}]},
      {@workspaces, "w1",
       [
         {@projects, "p1",
          [
            {@issues, "i1",
             [
               {@comments, "c1", [{@reactions, "r1"}, {@reactions, "r2"}, {@reactions, "r3"}]},
               {@comments, "c2", [{@reactions, "r4"}]}
             ]},
            {@issues, "i2", [{@comments, "c5"}]},
            {@project_memberships, "pm1", %{"user_id" => Auth.user_id(), "role" => "member"}, []}
          ]},
         {@projects, "p2",
          [
            {@issues, "i3",
             [
               {@comments, "c3", [{@reactions, "r5"}, {@reactions, "r6"}, {@reactions, "r7"}]},
               {@comments, "c4", [{@reactions, "r8"}]}
             ]},
            {@issues, "i4"}
          ]},
         {@projects, "p3", [{@issues, "i5", [{@comments, "c6"}]}]},
         {@projects, "p4", [{@issues, "i6", []}]}
       ]},
      {@compound_root, ["cmr1_1", "cmr2_1"],
       [
         {
           @compound_level1,
           ["cml1_1", "cml2_1"],
           [{@compound_level2, ["cmll1_1", "cmll2_1"], []}]
         }
       ]},
      {@users, [Auth.user_id()], [{@addresses, ["ad1"]}]}
    ]

    conn = Sqlite.build_tree(conn, data, schema_version)

    {:ok,
     conn: conn,
     schema_version: schema_version,
     loader: loader,
     data: data,
     migrations: PermissionsHelpers.Schema.migrations()}
  end

  test "scope_query/3", cxt do
    # the use of the fk in the map here is because in the triggers, you would be looking up from
    # the trigger row, with e.g. `NEW`, so the final clause would be e.g. `NEW.region_id` for the
    # first test case here.
    tests = [
      {@regions, @offices, %{"region_id" => "rg1"}, ["rg1"]},
      {@workspaces, @reactions, %{"comment_id" => "c4"}, ["w1"]},
      {@projects, @reactions, %{"comment_id" => "c4"}, ["p2"]},
      {@issues, @reactions, %{"comment_id" => "c3"}, ["i3"]},
      {@projects, @project_memberships, %{"project_id" => "p1"}, ["p1"]},
      {@projects, @projects, %{"id" => "p1"}, ["p1"]},
      {@compound_root, @compound_level1, %{"root_id1" => "cmr1_1", "root_id2" => "cmr2_1"},
       ["cmr1_1", "cmr2_1"]},
      {@compound_root, @compound_level2, %{"level1_id1" => "cml1_1", "level1_id2" => "cml2_1"},
       ["cmr1_1", "cmr2_1"]},
      {@projects, @users, %{"user_id" => Auth.user_id()}, ["p1"]},
      {@projects, @addresses, %{"user_id" => Auth.user_id()}, ["p1"]}
    ]

    for {root, table, id, scope_id} <- tests do
      query =
        Permissions.Client.scope_query(
          cxt.schema_version,
          root,
          table,
          fn col -> ["'", Map.fetch!(id, col), "'"] end
        )

      {:ok, stmt} = Exqlite.Sqlite3.prepare(cxt.conn, query)

      assert {:row, ^scope_id} = Exqlite.Sqlite3.step(cxt.conn, stmt)
    end
  end

  describe "permissions triggers" do
    setup(cxt) do
      Client.setup(cxt)
    end

    test "rejects updates to primary keys", cxt do
      perms =
        Client.perms(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@issues)} TO 'editor'],
            ~s[ASSIGN #{table(@users)}.role TO #{table(@users)}.id]
          ],
          [
            Roles.role("editor", "assign-1")
          ]
        )

      assert {:error, _} =
               Client.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(@issues, %{"id" => "i1"}, %{"id" => "i100"})
                 ])
               )
    end
  end

  describe "local roles cleanup" do
    setup(cxt) do
      Client.setup(cxt)
    end

    defp cleanup_sql(query) do
      query
      |> IO.iodata_to_binary()
      |> String.split("\n")
      |> Enum.drop_while(fn
        "-- @permissions_cleanup BEGIN" -> false
        _ -> true
      end)
      |> Enum.take_while(fn
        "-- @permissions_cleanup END" -> false
        _ -> true
      end)
      |> Enum.reject(fn
        "--" <> _ -> true
        _ -> false
      end)
    end

    test "deletes tombstone entries for removed global roles", cxt do
      ddlx =
        [
          ~s[GRANT ALL ON #{table(@issues)} TO 'editor'],
          ~s[ASSIGN #{table(@users)}.role TO #{table(@users)}.id]
        ]

      old_perms =
        perms_build(
          cxt,
          ddlx,
          [
            Roles.role("editor", "assign-1", row_id: ["user-1"])
          ]
        )

      # we lost a global role
      perms = perms_build(cxt, ddlx, [])

      cleanup =
        old_perms
        |> Permissions.Client.permissions_triggers(perms, cxt.schema_version)
        |> cleanup_sql()

      assert Enum.find(cleanup, fn query ->
               query ==
                 ~s|DELETE FROM "__electric_local_roles_tombstone" WHERE (assign_id = 'assign-1') AND (row_id = '["user-1"]');|
             end)
    end

    test "deletes tombstone entries for removed scoped roles", cxt do
      ddlx =
        [
          ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
          ~s[ASSIGN (#{table(@projects)}, #{table(@project_memberships)}.role) TO #{table(@project_memberships)}.user_id]
        ]

      old_perms =
        perms_build(
          cxt,
          ddlx,
          [
            Roles.role("editor", @projects, "p1", "assign-1", row_id: ["pm-1"]),
            Roles.role("editor", @projects, "p2", "assign-1", row_id: ["pm-2"])
          ]
        )

      # we lost a scoped role in project.p2
      perms =
        perms_build(
          cxt,
          ddlx,
          [
            Roles.role("editor", @projects, "p1", "assign-1")
          ]
        )

      cleanup =
        old_perms
        |> Permissions.Client.permissions_triggers(perms, cxt.schema_version)
        |> cleanup_sql()

      assert Enum.find(cleanup, fn query ->
               query ==
                 ~s|DELETE FROM "__electric_local_roles_tombstone" WHERE (assign_id = 'assign-1') AND (row_id = '["pm-2"]');|
             end)
    end

    test "deletes local versions of added global roles", cxt do
      ddlx =
        [
          ~s[GRANT ALL ON #{table(@issues)} TO 'editor'],
          ~s[ASSIGN #{table(@users)}.role TO #{table(@users)}.id]
        ]

      old_perms = perms_build(cxt, ddlx, [])

      # we gained a global role
      perms =
        perms_build(cxt, ddlx, [
          Roles.role("editor", "assign-1", row_id: ["user-1"])
        ])

      cleanup =
        old_perms
        |> Permissions.Client.permissions_triggers(perms, cxt.schema_version)
        |> cleanup_sql()

      assert Enum.find(cleanup, fn query ->
               query ==
                 ~s|DELETE FROM "__electric_local_roles" WHERE (assign_id = 'assign-1') AND (row_id = '["user-1"]');|
             end)
    end

    test "deletes local versions of added scoped roles", cxt do
      ddlx =
        [
          ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
          ~s[ASSIGN (#{table(@projects)}, #{table(@project_memberships)}.role) TO #{table(@project_memberships)}.user_id]
        ]

      old_perms =
        perms_build(
          cxt,
          ddlx,
          [
            Roles.role("editor", @projects, "p1", "assign-1", row_id: ["pm-1"])
          ]
        )

      # we gained a scoped role in project.p2
      perms =
        perms_build(
          cxt,
          ddlx,
          [
            Roles.role("editor", @projects, "p1", "assign-1", row_id: ["pm-1"]),
            Roles.role("editor", @projects, "p2", "assign-1", row_id: ["pm-2"])
          ]
        )

      cleanup =
        old_perms
        |> Permissions.Client.permissions_triggers(perms, cxt.schema_version)
        |> cleanup_sql()

      assert Enum.find(cleanup, fn query ->
               query ==
                 ~s|DELETE FROM "__electric_local_roles" WHERE (assign_id = 'assign-1') AND (row_id = '["pm-2"]');|
             end)
    end
  end
end
