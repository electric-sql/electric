defmodule Electric.Satellite.PermissionsTest do
  use ExUnit.Case, async: true

  alias ElectricTest.PermissionsHelpers

  alias ElectricTest.PermissionsHelpers.{
    Auth,
    Chgs,
    XID,
    Perms,
    Roles,
    Tree
  }

  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Satellite.Permissions

  import ElectricTest.PermissionsHelpers

  @addresses {"public", "addresses"}
  @comments {"public", "comments"}
  @issues {"public", "issues"}
  @users {"public", "users"}
  @regions {"public", "regions"}
  @offices {"public", "offices"}
  @workspaces {"public", "workspaces"}
  @projects {"public", "projects"}
  @issues {"public", "issues"}
  @comments {"public", "comments"}
  @reactions {"public", "reactions"}
  @site_admins {"public", "site_admins"}
  @project_memberships {"public", "project_memberships"}

  @compound_root {"public", "compound_root"}
  @compound_level1 {"public", "compound_level1"}
  @compound_level2 {"public", "compound_level2"}

  @projects_assign ~s[ELECTRIC ASSIGN (#{table(@projects)}, #{table(@project_memberships)}.role) TO #{table(@project_memberships)}.user_id]
  @global_assign ~s[ELECTRIC ASSIGN #{table(@users)}.role TO #{table(@users)}.id]

  defmacrop assert_write_rejected(test) do
    # permissions failure messages are prefixed with `"permissions:"` so we're double checking
    # that the error is caused by the permissions checks themselves, not by some other data error
    # this is particularly important for the sqlite backed tests
    quote do
      assert {:error, "permissions:" <> _} = unquote(test)
    end
  end

  setup do
    {:ok, loader} = PermissionsHelpers.Schema.loader()
    {:ok, schema_version} = SchemaLoader.load(loader)

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
      {@users, [Auth.user_id()]},
      {@users, [Auth.not_user_id()]},
      {@site_admins, ["sa1"], %{"role" => "site.admin", "user_id" => Auth.user_id()}, []}
    ]

    tree = Tree.new(data, schema_version)

    {:ok, _} = start_supervised(Perms.Transient)

    {:ok,
     tree: tree,
     loader: loader,
     schema_version: schema_version,
     data: data,
     migrations: PermissionsHelpers.Schema.migrations()}
  end

  describe "validate_write/3" do
    test "scoped role, scoped grant", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@comments)} TO (projects, 'editor')],
            ~s[GRANT ALL ON #{table(@issues)} TO (projects, 'editor')],
            @projects_assign
          ],
          [
            Roles.role("editor", @projects, "p2", "assign-1")
          ]
        )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 # issue i1 belongs to project p1
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
                 ])
               )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 # issue i3 belongs to project p2
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i3"})
                 ])
               )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 # issue i3 belongs to project p2
                 Chgs.tx([
                   Chgs.update(@comments, %{"id" => "c4", "issue_id" => "i3"}, %{
                     "comment" => "changed"
                   })
                 ])
               )
    end

    test "unscoped role, scoped grant", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@comments)} TO (projects, 'editor')],
            ~s[GRANT ALL ON #{table(@issues)} TO (projects, 'editor')],
            @global_assign
          ],
          [
            Roles.role("editor", "assign-1")
          ]
        )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 # issue i1 belongs to project p1
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
                 ])
               )
    end

    test "scoped role, unscoped grant", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@comments)} TO 'editor'],
            @projects_assign
          ],
          [
            # we have an editor role within project p2
            Roles.role("editor", @projects, "p2", "assign-1")
          ]
        )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 # issue i1 belongs to project p1
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
                 ])
               )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 # issue i3 belongs to project p2 but the grant is global
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i3"})
                 ])
               )
    end

    test "scoped on user table", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@addresses)} TO (#{table(@users)}, 'self')],
            ~s[GRANT SELECT ON #{table(@users)} TO (#{table(@users)}, 'self')],
            ~s[GRANT UPDATE ON #{table(@users)} TO (#{table(@users)}, 'self')],
            ~s[ASSIGN (#{table(@users)}, 'self') TO #{table(@users)}.id]
          ],
          [
            # assign ourselves the 'self' role
            Roles.role("self", @users, Auth.user_id(), "assign-1")
          ]
        )

      assert {:ok, perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(@users, %{"id" => Auth.user_id(), "name" => "Me"}, %{
                     "name" => "You"
                   })
                 ])
               )

      assert {:ok, perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@addresses, %{
                     "id" => "ad200",
                     "user_id" => Auth.user_id(),
                     "address" => "Here"
                   })
                 ])
               )

      assert {:ok, perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(
                     @addresses,
                     %{
                       "id" => "ad200",
                       "user_id" => Auth.user_id(),
                       "address" => "Here"
                     },
                     %{"address" => "There"}
                   )
                 ])
               )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(
                     @users,
                     %{"id" => Auth.not_user_id(), "name" => "You"},
                     %{"name" => "Me"}
                   )
                 ])
               )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(
                     @addresses,
                     %{
                       "id" => "ad200",
                       "user_id" => Auth.user_id(),
                       "address" => "Here"
                     },
                     %{"user_id" => Auth.not_user_id()}
                   )
                 ])
               )
    end

    test "grant for different table", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT SELECT ON #{table(@comments)} TO 'editor'],
            ~s[GRANT ALL ON #{table(@reactions)} TO 'editor'],
            @global_assign
          ],
          [
            Roles.role("editor", "assign-1")
          ]
        )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
                 ])
               )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@reactions, %{"id" => "r100"})
                 ])
               )
    end

    test "unscoped role, unscoped grant", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT UPDATE ON #{table(@comments)} TO 'editor'],
            @global_assign
          ],
          [
            Roles.role("editor", "assign-1")
          ]
        )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(
                     @comments,
                     %{"id" => "c100", "issue_id" => "i1", "text" => "old"},
                     %{
                       "text" => "changed"
                     }
                   )
                 ])
               )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
                 ])
               )
    end

    test "scoped role, change outside of scope", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT UPDATE ON #{table(@comments)} TO 'editor'],
            ~s[GRANT ALL ON #{table(@regions)} TO 'admin'],
            @projects_assign,
            @global_assign
          ],
          [
            Roles.role("editor", @projects, "p2", "assign-1"),
            Roles.role("admin", "assign-2")
          ]
        )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(@regions, %{"id" => "r1", "name" => "region"}, %{
                     "name" => "updated region"
                   })
                 ])
               )
    end

    test "role with no matching assign", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT UPDATE ON #{table(@comments)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT READ ON #{table(@issues)} TO (#{table(@projects)}, 'editor')]
          ],
          [
            Roles.role("editor", @projects, "p1", "non-existant")
          ]
        )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(@comments, %{"id" => "c1", "comment" => "old comment"}, %{
                     "comment" => "new comment"
                   })
                 ])
               )
    end

    test "overlapping global and scoped perms", cxt do
      # Test that even though the global perm doesn't grant
      # the required permissions, the scoped perms are checked
      # as well. The rule is that if *any* grant gives the perm
      # then we have it, so we need to check every applicable grant
      # until we run out of get permission.
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT UPDATE (description) ON #{table(@issues)} TO (projects, 'editor')],
            ~s[GRANT UPDATE (title) ON #{table(@issues)} TO 'editor'],
            @projects_assign,
            @global_assign
          ],
          [
            Roles.role("editor", @projects, "p1", "assign-1"),
            Roles.role("editor", "assign-2")
          ]
        )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(@issues, %{"id" => "i1"}, %{
                     "description" => "updated"
                   })
                 ])
               )
    end

    test "AUTHENTICATED w/user_id", cxt do
      perms =
        perms_build(
          cxt,
          ~s[GRANT ALL ON #{table(@comments)} TO AUTHENTICATED],
          []
        )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c10"})
                 ])
               )
    end

    test "AUTHENTICATED w/o permission", cxt do
      perms =
        perms_build(
          cxt,
          ~s[GRANT SELECT ON #{table(@comments)} TO AUTHENTICATED],
          []
        )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c10"})
                 ])
               )
    end

    test "AUTHENTICATED w/o user_id", cxt do
      perms =
        perms_build(
          cxt,
          ~s[GRANT ALL ON #{table(@comments)} TO AUTHENTICATED],
          [],
          auth: Auth.nobody()
        )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c10"})
                 ])
               )
    end

    test "ANYONE w/o user_id", cxt do
      perms =
        perms_build(
          cxt,
          ~s[GRANT ALL ON #{table(@comments)} TO ANYONE],
          [],
          auth: Auth.nobody()
        )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c10"})
                 ])
               )
    end

    test "protected columns", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT INSERT (id, text) ON #{table(@comments)} TO 'editor'],
            ~s[GRANT UPDATE (text) ON #{table(@comments)} TO 'editor'],
            @global_assign
          ],
          [
            Roles.role("editor", "assign-1")
          ]
        )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c10", "text" => "something"})
                 ])
               )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@comments, %{
                     "id" => "c10",
                     "text" => "something",
                     "owner" => "invalid"
                   })
                 ])
               )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(@comments, %{"id" => "c10"}, %{"text" => "updated"})
                 ])
               )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(@comments, %{"id" => "c10"}, %{
                     "text" => "updated",
                     "owner" => "changed"
                   })
                 ])
               )
    end

    test "moves between auth scopes", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT UPDATE ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT SELECT ON #{table(@issues)} TO 'reader'],
            @projects_assign
          ],
          [
            # update rights on p1 & p3
            Roles.role("editor", @projects, "p1", "assign-1"),
            Roles.role("editor", @projects, "p3", "assign-1"),
            # read-only role on project p2
            Roles.role("reader", @projects, "p2", "assign-1")
          ]
        )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{
                     "project_id" => "p3"
                   })
                 ])
               )

      # attempt to move an issue into a project we don't have write access to
      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{
                     "project_id" => "p2"
                   })
                 ])
               )
    end

    test "write in scope tree", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@comments)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@reactions)} TO (#{table(@projects)}, 'editor')],
            @projects_assign
          ],
          [
            Roles.role("editor", @projects, "p1", "assign-1")
          ]
        )

      # a single tx that builds within a writable permissions scope
      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i100"}),
                   Chgs.insert(@reactions, %{"id" => "r100", "comment_id" => "c100"})
                 ])
               )

      # any failure should abort the tx
      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
                   # this insert lives outside our perms
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i3"}),
                   Chgs.insert(@reactions, %{"id" => "r100", "comment_id" => "c100"})
                 ])
               )
    end
  end

  describe "intermediate roles" do
    # roles that are created on the client and then used within the same tx before triggers have
    # run on pg
    setup(cxt) do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'manager')],
            ~s[GRANT ALL ON #{table(@comments)} TO (#{table(@projects)}, 'manager')],
            # read only to viewer
            ~s[GRANT READ ON #{table(@issues)} TO (#{table(@projects)}, 'viewer')],
            ~s[GRANT READ ON #{table(@comments)} TO (#{table(@projects)}, 'viewer')],
            # global roles allowing create project and assign members
            ~s[GRANT ALL ON #{table(@projects)} TO 'project_admin'],
            ~s[GRANT ALL ON #{table(@project_memberships)} TO 'project_admin'],
            # the assign rule for the 'manager' role
            @projects_assign,
            @global_assign
          ],
          [
            # start with the ability to create projects and memberships
            Roles.role("manager", @projects, "p1", "assign-1", row_id: ["pm1"]),
            Roles.role("project_admin", "assign-2")
          ]
        )

      {:ok, perms: perms}
    end

    test "create and write to scope", cxt do
      assert {:ok, perms} =
               Permissions.validate_write(
                 cxt.perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@projects, %{"id" => "p100", "workspace_id" => "w1"}),
                   Chgs.insert(@project_memberships, %{
                     "id" => "pm100",
                     "project_id" => "p100",
                     "user_id" => Auth.user_id(),
                     "role" => "manager"
                   }),
                   Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p100"}),
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i100"})
                 ])
               )

      # the generated role persists accross txs
      assert {:ok, perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@issues, %{"id" => "i101", "project_id" => "p100"}),
                   Chgs.insert(@comments, %{"id" => "c101", "issue_id" => "i101"}),
                   Chgs.insert(@comments, %{"id" => "c200", "issue_id" => "i1"}),
                   Chgs.insert(@issues, %{"id" => "i200", "project_id" => "p1"})
                 ])
               )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c102", "issue_id" => "i101"}),
                   Chgs.insert(@comments, %{"id" => "c102", "issue_id" => "i100"})
                 ])
               )
    end

    test "create then write to scope across txns", cxt do
      assert {:ok, perms} =
               Permissions.validate_write(
                 cxt.perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@projects, %{"id" => "p100", "workspace_id" => "w1"})
                 ])
               )

      assert {:ok, perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@project_memberships, %{
                     "id" => "pm100",
                     "project_id" => "p100",
                     "user_id" => Auth.user_id(),
                     "role" => "manager"
                   })
                 ])
               )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p100"}),
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i100"})
                 ])
               )
    end

    test "update intermediate role", cxt do
      assert {:ok, perms} =
               Permissions.validate_write(
                 cxt.perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@projects, %{"id" => "p100", "workspace_id" => "w1"}),
                   Chgs.insert(@project_memberships, %{
                     "id" => "pm100",
                     "project_id" => "p100",
                     "user_id" => Auth.user_id(),
                     "role" => "manager"
                   })
                 ])
               )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(
                     @project_memberships,
                     %{
                       "id" => "pm100",
                       "project_id" => "p100",
                       "user_id" => Auth.user_id(),
                       "role" => "manager"
                     },
                     %{"role" => "viewer"}
                   ),
                   Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p100"}),
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i100"})
                 ])
               )
    end

    test "removal of role via delete to memberships", cxt do
      assert {:ok, perms} =
               Permissions.validate_write(
                 cxt.perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@projects, %{"id" => "p100", "workspace_id" => "w1"}),
                   Chgs.insert(@project_memberships, %{
                     "id" => "pm100",
                     "project_id" => "p100",
                     "user_id" => Auth.user_id(),
                     "role" => "manager"
                   }),
                   Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p100"}),
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i100"})
                 ])
               )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.delete(@project_memberships, %{
                     "id" => "pm100",
                     "project_id" => "p100",
                     "user_id" => Auth.user_id(),
                     "role" => "manager"
                   }),
                   Chgs.insert(@issues, %{"id" => "i101", "project_id" => "p100"})
                 ])
               )
    end

    test "delete to existing memberships", cxt do
      assert {:ok, perms} =
               Permissions.validate_write(
                 cxt.perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.delete(@project_memberships, %{
                     "id" => "pm1",
                     "project_id" => "p1",
                     "user_id" => Auth.user_id(),
                     "role" => "manager"
                   })
                 ])
               )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"})
                 ])
               )
    end

    test "delete to existing memberships, then re-add", cxt do
      assert {:ok, perms} =
               Permissions.validate_write(
                 cxt.perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.delete(@project_memberships, %{
                     "id" => "pm1",
                     "project_id" => "p1",
                     "user_id" => Auth.user_id(),
                     "role" => "manager"
                   }),
                   Chgs.insert(@project_memberships, %{
                     "id" => "pm100",
                     "project_id" => "p1",
                     "user_id" => Auth.user_id(),
                     "role" => "manager"
                   })
                 ])
               )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"})
                 ])
               )
    end

    test "add and delete local role", cxt do
      assert {:ok, perms} =
               Permissions.validate_write(
                 cxt.perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@projects, %{"id" => "p100", "workspace_id" => "w1"}),
                   Chgs.insert(@project_memberships, %{
                     "id" => "pm100",
                     "project_id" => "p100",
                     "user_id" => Auth.user_id(),
                     "role" => "manager"
                   }),
                   Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p100"}),
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i100"}),
                   Chgs.delete(@project_memberships, %{
                     "id" => "pm100",
                     "project_id" => "p100",
                     "user_id" => Auth.user_id(),
                     "role" => "manager"
                   })
                 ])
               )

      # the generated role persists accross txs
      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.insert(@issues, %{"id" => "i101", "project_id" => "p100"})
                 ])
               )
    end
  end

  # TODO: implement where clauses on client side
  for module <- [PermissionsHelpers.Server] do
    describe "#{module.name()}: where clauses" do
      setup(cxt) do
        {:ok, cxt} = unquote(module).setup(cxt)
        {:ok, Map.put(Map.new(cxt), :module, unquote(module))}
      end

      test "simple user_id", cxt do
        perms =
          cxt.module.perms(
            cxt,
            [
              ~s[GRANT ALL ON #{table(@comments)} TO AUTHENTICATED WHERE (row.author_id::text = auth.user_id)]
            ],
            []
          )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.insert(@comments, %{
                "id" => "c100",
                "issue_id" => "i3",
                "author_id" => "78c4d92e-a0a7-4c6a-b25a-44e26eb33e4c"
              })
            ])
          )
        )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@comments, %{
                       "id" => "c100",
                       "issue_id" => "i3",
                       "author_id" => Auth.user_id()
                     })
                   ])
                 )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   # issue i3 belongs to project p2
                   Chgs.tx([
                     Chgs.update(
                       @comments,
                       %{"id" => "c4", "issue_id" => "i3", "author_id" => Auth.user_id()},
                       %{
                         "comment" => "changed"
                       }
                     )
                   ])
                 )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            # issue i3 belongs to project p2
            Chgs.tx([
              Chgs.update(
                @comments,
                %{"id" => "c4", "issue_id" => "i3", "author_id" => Auth.user_id()},
                %{
                  "author_id" => "a5158d97-8e45-408d-81c9-f28e2fe4f54c"
                }
              )
            ])
          )
        )
      end

      test "local role granting", cxt do
        # if an assign has a where clause then local roles should honour that
        # and only grant the role if the where clause passes
        # reset the db because we're repeating the permissions setup
        cxt = cxt.module.reset(cxt)

        perms =
          cxt.module.perms(
            cxt,
            [
              # project level perms
              ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'manager')],
              ~s[GRANT ALL ON #{table(@comments)} TO (#{table(@projects)}, 'manager')],
              # read only to viewer
              ~s[GRANT READ ON #{table(@issues)} TO (#{table(@projects)}, 'viewer')],
              ~s[GRANT READ ON #{table(@comments)} TO (#{table(@projects)}, 'viewer')],
              # global roles allowing create project and assign members
              ~s[GRANT ALL ON #{table(@projects)} TO 'admin'],
              ~s[GRANT ALL ON #{table(@project_memberships)} TO 'admin'],
              ~s[GRANT ALL ON site_admins TO 'admin'],

              # global roles with a join table
              ~s[GRANT ALL ON #{table(@regions)} TO 'site.admin'],
              ~s[GRANT ALL ON #{table(@offices)} TO 'site.admin'],
              ~s[ELECTRIC ASSIGN (#{table(@projects)}, #{table(@project_memberships)}.role) TO #{table(@project_memberships)}.user_id IF (ROW.valid)],
              ~s[ELECTRIC ASSIGN 'site.admin' TO #{table(@project_memberships)}.user_id IF (ROW.role = 'site.admin')],
              @global_assign,
              ~s[ASSIGN site_admins.role TO site_admins.user_id]
            ],
            [
              Roles.role("admin", "assign-2")
            ]
          )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.insert(@issues, %{
                "id" => "i100",
                "project_id" => "p1"
              })
            ])
          )
        )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.insert(@project_memberships, %{
                "id" => "pm100",
                "user_id" => Auth.user_id(),
                "project_id" => "p1",
                "role" => "manager",
                "valid" => "false"
              }),
              Chgs.insert(@issues, %{
                "id" => "i100",
                "project_id" => "p1"
              })
            ])
          )
        )

        assert {:ok, perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@project_memberships, %{
                       "id" => "pm100",
                       "user_id" => Auth.user_id(),
                       "project_id" => "p1",
                       "role" => "manager",
                       "valid" => "true"
                     }),
                     Chgs.insert(@issues, %{
                       "id" => "i100",
                       "project_id" => "p1"
                     })
                   ])
                 )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.delete(@project_memberships, %{
                "id" => "pm100",
                "user_id" => Auth.user_id(),
                "project_id" => "p1",
                "role" => "manager",
                "valid" => "true"
              }),
              Chgs.insert(@issues, %{
                "id" => "i101",
                "project_id" => "p1"
              })
            ])
          )
        )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.insert(@regions, %{
                "id" => "rg200"
              })
            ])
          )
        )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     # insert a special 'site.admin' role
                     Chgs.insert(@project_memberships, %{
                       "id" => "pm100",
                       "user_id" => Auth.user_id(),
                       "project_id" => "p1",
                       "role" => "site.admin",
                       "valid" => "false"
                     }),
                     Chgs.insert(@regions, %{
                       "id" => "rg200"
                     })
                   ])
                 )
      end
    end
  end

  describe "transient permissions" do
    setup(cxt) do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT SELECT ON #{table(@issues)} TO (#{table(@projects)}, 'reader')],
            @projects_assign
          ],
          [
            Roles.role("editor", @projects, "p1", "assign-1"),
            # read-only role on project p2
            Roles.role("reader", @projects, "p2", "assign-1"),
            Roles.role("editor", @projects, "p3", "assign-1")
          ]
        )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 cxt.tree,
                 Chgs.tx([
                   Chgs.update(@issues, %{"id" => "i3"}, %{"description" => "changed"})
                 ])
               )

      {:ok, perms: perms}
    end

    test "valid tdp", cxt do
      xid = 99

      assert {:ok, _perms} =
               cxt.perms
               |> Perms.add_transient(
                 assign_id: "assign-1",
                 target_relation: @issues,
                 target_id: ["i3"],
                 scope_id: ["p1"],
                 valid_to: XID.new(xid + 1)
               )
               |> Permissions.validate_write(
                 cxt.tree,
                 # i3 belongs to project p2 where we only have read-access, but we have a
                 # transient permission that allows us to update it
                 Chgs.tx([Chgs.update(@issues, %{"id" => "i3"}, %{"description" => "changed"})],
                   xid: xid
                 )
               )
    end

    test "tdp out of scope", cxt do
      xid = 99

      assert {:error, _} =
               cxt.perms
               |> Perms.add_transient(
                 assign_id: "assign-1",
                 target_relation: @issues,
                 target_id: ["i4"],
                 scope_id: ["p1"],
                 valid_to: XID.new(xid + 1)
               )
               |> Permissions.validate_write(
                 cxt.tree,
                 # i3 belongs to project p2 where we only have read-access and the transient
                 # permission only applies to i4, so not allowed
                 Chgs.tx([Chgs.update(@issues, %{"id" => "i3"}, %{"description" => "changed"})],
                   xid: xid
                 )
               )
    end

    test "expired tdp", cxt do
      xid = 99

      assert {:error, _} =
               cxt.perms
               |> Perms.add_transient(
                 assign_id: "assign-1",
                 target_relation: @issues,
                 target_id: ["i3"],
                 scope_id: ["p1"],
                 valid_to: XID.new(xid)
               )
               |> Permissions.validate_write(
                 cxt.tree,
                 # i3 belongs to project p2 where we only have read-access, we have a
                 # transient permission that allows us to update it but that tdp has expired
                 Chgs.tx([Chgs.update(@issues, %{"id" => "i3"}, %{"description" => "changed"})],
                   xid: xid + 1
                 )
               )
    end
  end
end
