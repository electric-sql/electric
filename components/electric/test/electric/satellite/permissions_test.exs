defmodule Electric.Satellite.PermissionsTest do
  use ExUnit.Case, async: true

  alias ElectricTest.PermissionsHelpers.{
    Auth,
    Chgs,
    LSN,
    Perms,
    Roles,
    Tree
  }

  alias Electric.Satellite.{Permissions, Permissions.MoveOut}
  alias Electric.Replication.Changes

  import ElectricTest.PermissionsHelpers

  @regions {"public", "regions"}
  @offices {"public", "offices"}
  @workspaces {"public", "workspaces"}
  @projects {"public", "projects"}
  @issues {"public", "issues"}
  @comments {"public", "comments"}
  @reactions {"public", "reactions"}
  @project_memberships {"public", "project_memberships"}

  setup do
    tree =
      Tree.new(
        [
          {@regions, "r1", [{@offices, "o1"}, {@offices, "o2"}]},
          {@regions, "r2", [{@offices, "o3"}, {@offices, "o4"}]},
          {@workspaces, "w1",
           [
             {@projects, "p1",
              [
                {@issues, "i1",
                 [
                   {@comments, "c1",
                    [{@reactions, "r1"}, {@reactions, "r2"}, {@reactions, "r3"}]},
                   {@comments, "c2", [{@reactions, "r4"}]}
                 ]},
                {@issues, "i2", [{@comments, "c5"}]}
              ]},
             {@projects, "p2",
              [
                {@issues, "i3",
                 [
                   {@comments, "c3",
                    [{@reactions, "r5"}, {@reactions, "r6"}, {@reactions, "r7"}]},
                   {@comments, "c4", [{@reactions, "r8"}]}
                 ]},
                {@issues, "i4"}
              ]},
             {@projects, "p3", [{@issues, "i5", []}]},
             {@projects, "p4", [{@issues, "i6", []}]}
           ]}
        ],
        [
          {@comments, @issues, ["issue_id"]},
          {@issues, @projects, ["project_id"]},
          {@offices, @regions, ["region_id"]},
          {@project_memberships, @projects, ["project_id"]},
          {@projects, @workspaces, ["workspace_id"]},
          {@reactions, @comments, ["comment_id"]}
        ]
      )

    {:ok, _} = start_supervised(Perms.Transient)

    {:ok, tree: tree}
  end

  describe "validate_write/3" do
    test "scoped role, scoped grant", cxt do
      perms =
        perms_build(
          cxt,
          ~s[GRANT ALL ON #{table(@comments)} TO (projects, 'editor')],
          [
            Roles.role("editor", @projects, "p2")
          ]
        )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 # issue i1 belongs to project p1
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
                 ])
               )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 # issue i3 belongs to project p2
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i3"})
                 ])
               )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
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
          ~s[GRANT ALL ON #{table(@comments)} TO (projects, 'editor')],
          [
            Roles.role("editor")
          ]
        )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
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
          ~s[GRANT ALL ON #{table(@comments)} TO 'editor'],
          [
            # we have an editor role within project p2
            Roles.role("editor", @projects, "p2")
          ]
        )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 # issue i1 belongs to project p1
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
                 ])
               )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 # issue i3 belongs to project p2 but the grant is global
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i3"})
                 ])
               )
    end

    test "grant for different table", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT SELECT ON #{table(@comments)} TO 'editor'],
            ~s[GRANT ALL ON #{table(@reactions)} TO 'editor']
          ],
          [
            Roles.role("editor")
          ]
        )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
                 ])
               )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 Chgs.tx([
                   Chgs.insert(@reactions, %{"id" => "r100"})
                 ])
               )
    end

    test "unscoped role, unscoped grant", cxt do
      perms =
        perms_build(
          cxt,
          ~s[GRANT UPDATE ON #{table(@comments)} TO 'editor'],
          [
            Roles.role("editor")
          ]
        )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
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
            ~s[GRANT ALL ON #{table(@regions)} TO 'admin']
          ],
          [
            Roles.role("editor", @projects, "p2"),
            Roles.role("admin")
          ]
        )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 Chgs.tx([
                   Chgs.update(@regions, %{"id" => "r1", "name" => "region"}, %{
                     "name" => "updated region"
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
            ~s[GRANT UPDATE (title) ON #{table(@issues)} TO 'editor']
          ],
          [
            Roles.role("editor", @projects, "p1"),
            Roles.role("editor")
          ]
        )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
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
            ~s[GRANT UPDATE (text) ON #{table(@comments)} TO 'editor']
          ],
          [
            Roles.role("editor")
          ]
        )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c10", "text" => "something"})
                 ])
               )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
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
                 Chgs.tx([
                   Chgs.update(@comments, %{"id" => "c10"}, %{"text" => "updated"})
                 ])
               )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
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
            ~s[GRANT SELECT ON #{table(@issues)} TO 'reader']
          ],
          [
            # update rights on p1 & p3
            Roles.role("editor", @projects, "p1"),
            Roles.role("editor", @projects, "p3"),
            # read-only role on project p2
            Roles.role("reader", @projects, "p2")
          ]
        )

      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
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
            ~s[GRANT ALL ON #{table(@reactions)} TO (#{table(@projects)}, 'editor')]
          ],
          [
            Roles.role("editor", @projects, "p1")
          ]
        )

      # a single tx that builds within a writable permissions scope
      assert {:ok, _perms} =
               Permissions.validate_write(
                 perms,
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
            ~s[ASSIGN (#{table(@projects)}, #{table(@project_memberships)}.role) TO #{table(@project_memberships)}.user_id]
          ],
          [
            # start with the ability to create projects and memberships
            Roles.role("project_admin"),
            Roles.role("manager", @projects, "p1")
          ]
        )

      {:ok, perms: perms}
    end

    test "create and write to scope", cxt do
      assert {:ok, perms} =
               Permissions.validate_write(
                 cxt.perms,
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
                 Chgs.tx([
                   Chgs.insert(@projects, %{"id" => "p100", "workspace_id" => "w1"})
                 ])
               )

      assert {:ok, perms} =
               Permissions.validate_write(
                 perms,
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
                 Chgs.tx([
                   Chgs.delete(@project_memberships, %{
                     "id" => "pm100",
                     "project_id" => "p100"
                   }),
                   Chgs.insert(@issues, %{"id" => "i101", "project_id" => "p100"})
                 ])
               )
    end
  end

  describe "transient permissions" do
    setup(cxt) do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT SELECT ON #{table(@issues)} TO (#{table(@projects)}, 'reader')]
          ],
          [
            Roles.role("editor", @projects, "p1", assign_id: "assign-01"),
            # read-only role on project p2
            Roles.role("reader", @projects, "p2", assign_id: "assign-01"),
            Roles.role("editor", @projects, "p3", assign_id: "assign-01")
          ]
        )

      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 Chgs.tx([
                   Chgs.update(@issues, %{"id" => "i3"}, %{"description" => "changed"})
                 ])
               )

      {:ok, perms: perms}
    end

    test "valid tdp", cxt do
      lsn = 99

      assert {:ok, _perms} =
               cxt.perms
               |> Perms.add_transient(
                 assign_id: "assign-01",
                 target_relation: @issues,
                 target_id: ["i3"],
                 scope_id: ["p1"],
                 valid_to: LSN.new(lsn + 1)
               )
               |> Permissions.validate_write(
                 # i3 belongs to project p2 where we only have read-access, but we have a
                 # transient permission that allows us to update it
                 Chgs.tx([Chgs.update(@issues, %{"id" => "i3"}, %{"description" => "changed"})],
                   lsn: lsn
                 )
               )
    end

    test "tdp out of scope", cxt do
      lsn = 99

      assert {:error, _} =
               cxt.perms
               |> Perms.add_transient(
                 assign_id: "assign-01",
                 target_relation: @issues,
                 target_id: ["i4"],
                 scope_id: ["p1"],
                 valid_to: LSN.new(lsn + 1)
               )
               |> Permissions.validate_write(
                 # i3 belongs to project p2 where we only have read-access and the transient
                 # permission only applies to i4, so not allowed
                 Chgs.tx([Chgs.update(@issues, %{"id" => "i3"}, %{"description" => "changed"})],
                   lsn: lsn
                 )
               )
    end

    test "expired tdp", cxt do
      lsn = 99

      assert {:error, _} =
               cxt.perms
               |> Perms.add_transient(
                 assign_id: "assign-01",
                 target_relation: @issues,
                 target_id: ["i3"],
                 scope_id: ["p1"],
                 valid_to: LSN.new(lsn)
               )
               |> Permissions.validate_write(
                 # i3 belongs to project p2 where we only have read-access, we have a
                 # transient permission that allows us to update it but that tdp has expired
                 Chgs.tx([Chgs.update(@issues, %{"id" => "i3"}, %{"description" => "changed"})],
                   lsn: lsn + 1
                 )
               )
    end
  end

  describe "filter_read/3" do
    test "removes changes we don't have permissions to see", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@comments)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT READ ON #{table(@issues)} TO (#{table(@projects)}, 'reader')],
            ~s[GRANT READ ON #{table(@comments)} TO (#{table(@projects)}, 'reader')],
            ~s[GRANT ALL ON #{table(@workspaces)} TO 'global_admin']
          ],
          [
            Roles.role("editor", @projects, "p1"),
            Roles.role("reader", @projects, "p2"),
            Roles.role("global_admin")
          ]
        )

      changes = [
        Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"text" => "updated"}),
        Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
        Chgs.insert(@issues, %{"id" => "i101", "project_id" => "p2"}),
        # no perms on the p3 project scope
        Chgs.insert(@issues, %{"id" => "i102", "project_id" => "p3"}),
        # can update comments under p1
        Chgs.update(@comments, %{"id" => "c1", "issue_id" => "i1"}, %{"text" => "updated"}),
        # no perms on the reactions table
        Chgs.update(@reactions, %{"id" => "r1", "comment_id" => "c1"}, %{"text" => "updated"}),
        # global_admin allows inserts into workspaces
        Chgs.insert(@workspaces, %{"id" => "w100"})
      ]

      {filtered_tx, []} = Permissions.filter_read(perms, Chgs.tx(changes))

      assert filtered_tx.changes == [
               Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"text" => "updated"}),
               Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
               Chgs.insert(@issues, %{"id" => "i101", "project_id" => "p2"}),
               Chgs.update(@comments, %{"id" => "c1", "issue_id" => "i1"}, %{"text" => "updated"}),
               Chgs.insert(@workspaces, %{"id" => "w100"})
             ]
    end

    test "ignores column limits in grants", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT READ (id, title) ON #{table(@issues)} TO 'editor']
          ],
          [
            Roles.role("editor")
          ]
        )

      # none of these changes would pass a write validation
      changes = [
        Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"text" => "updated"}),
        Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
        Chgs.update(@issues, %{"id" => "i3", "project_id" => "p2"}, %{"colour" => "red"})
      ]

      {filtered_tx, []} = Permissions.filter_read(perms, Chgs.tx(changes))

      assert filtered_tx.changes == changes
    end

    test "incorporates in-tx additions to scope", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@comments)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@reactions)} TO (#{table(@projects)}, 'editor')]
          ],
          [
            Roles.role("editor", @projects, "p1")
          ]
        )

      changes = [
        # move issue into a scope we have permissions on
        Chgs.update(@issues, %{"id" => "i3", "project_id" => "p2"}, %{"project_id" => "p1"}),
        # update a comment on that issue
        Chgs.update(@comments, %{"id" => "c3", "issue_id" => "i3"}, %{"comment" => "what a mover"}),
        # create issue in a scope we have permissions on then add a comment to it
        Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
        Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i100"}),
        Chgs.insert(@reactions, %{"id" => "r100", "comment_id" => "c100", "reaction" => ":ok:"})
      ]

      {filtered_tx, []} = Permissions.filter_read(perms, Chgs.tx(changes))
      assert filtered_tx.changes == changes
    end

    test "incorporates in-tx removals from scope", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@comments)} TO (#{table(@projects)}, 'editor')]
          ],
          [
            Roles.role("editor", @projects, "p1"),
            Roles.role("editor", @projects, "p2")
          ]
        )

      # Some admin removing our rights on a project will generate a role change replication
      # message which is translated into a permissions change process.
      #
      # This perms change will come in the tx, but I think we need a new
      # message struct for that, so we will need to have the ability to swap out our permissions
      # either mid-tx or find some other way to handle a perms change in an eventually consistent
      # way. [VAX-1563](https://linear.app/electric-sql/issue/VAX-1563/handle-permissions-updates-received-in-a-tx)
      #
      # There are basically 3 ways to lose access to a row in a scope:
      #
      # 1. the root of the scope is deleted: in this case the join row will also be deleted
      #    (assuming on delete cascade, what about on delete set null?) which will lead to a perms
      #    change message
      #
      # 2. our scope membership is revoked. this will result in a perms change message
      #
      # 3. the row is moved from a scope we can see to a scope we can't see. this is the only
      #    version that doesn't involve a perms change.
      #
      # (3) is the case we're testing here. (1) and (2) involve a permissions change (losing a role)
      # and will be covered by VAX-1563.
      #
      changes =
        [
          # move issue into a scope we don't have permissions on then do some stuff on that issue
          Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"project_id" => "p3"}),
          Chgs.update(@comments, %{"id" => "c1", "issue_id" => "i1"}, %{
            "comment" => "what a mover"
          }),
          Chgs.insert(@comments, %{
            "id" => "c100",
            "issue_id" => "i1",
            "comment" => "what a mover"
          }),

          # move an issue between projects we can see
          Chgs.update(@issues, %{"id" => "i3", "project_id" => "p2"}, %{"project_id" => "p1"}),

          # delete a comment and an issue that lives under it
          Chgs.delete(@issues, %{"id" => "i2", "project_id" => "p1"}),
          Chgs.delete(@comments, %{"id" => "c5", "issue_id" => "i2"}),

          # move issue we couldn't see into a scope we still can't see
          Chgs.update(@issues, %{"id" => "i5", "project_id" => "p3"}, %{"project_id" => "p4"})
        ]

      {filtered_tx, move_out} = Permissions.filter_read(perms, Chgs.tx(changes))

      assert filtered_tx.changes == [
               Chgs.update(@issues, %{"id" => "i3", "project_id" => "p2"}, %{"project_id" => "p1"})
             ]

      assert [
               %MoveOut{
                 change: %Changes.UpdatedRecord{},
                 relation: @issues,
                 id: ["i1"],
                 scope_path: [_ | _]
               },
               %MoveOut{
                 change: %Changes.DeletedRecord{},
                 relation: @issues,
                 id: ["i2"],
                 scope_path: [_ | _]
               },
               %MoveOut{
                 change: %Changes.DeletedRecord{},
                 relation: @comments,
                 id: ["c5"],
                 scope_path: [_ | _]
               }
             ] = move_out
    end

    test "removal from a scope but with global permissions", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@comments)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@issues)} TO 'admin'],
            ~s[GRANT ALL ON #{table(@comments)} TO 'admin']
          ],
          [
            Roles.role("editor", @projects, "p1"),
            Roles.role("editor", @projects, "p2"),
            Roles.role("admin")
          ]
        )

      expected_changes =
        [
          # move issue into a scope we don't have permissions on
          Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"project_id" => "p3"}),
          Chgs.update(@comments, %{"id" => "c1", "issue_id" => "i1"}, %{
            "comment" => "what a mover"
          }),
          Chgs.insert(@comments, %{
            "id" => "c100",
            "issue_id" => "i1",
            "comment" => "what a mover"
          }),
          # move an issue between projects we can see
          Chgs.update(@issues, %{"id" => "i3", "project_id" => "p2"}, %{"project_id" => "p1"})
        ]

      changes =
        expected_changes ++
          [
            Chgs.update(@workspaces, %{"id" => "w1"}, %{"name" => "changed"})
          ]

      {filtered_tx, []} = Permissions.filter_read(perms, Chgs.tx(changes))

      assert filtered_tx.changes == expected_changes
    end
  end
end
