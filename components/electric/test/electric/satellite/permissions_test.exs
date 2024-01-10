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

  alias Electric.Satellite.{Permissions, Permissions.Scope}
  alias Electric.Replication.Changes

  @regions {"public", "regions"}
  @offices {"public", "offices"}
  @workspaces {"public", "workspaces"}
  @projects {"public", "projects"}
  @issues {"public", "issues"}
  @comments {"public", "comments"}
  @reactions {"public", "reactions"}

  def table(relation) do
    Electric.Utils.inspect_relation(relation)
  end

  def perms_build(cxt, grants, roles, attrs \\ []) do
    Perms.new(cxt.tree, attrs)
    |> Perms.update(grants, roles)
  end

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
                {@issues, "i2"}
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
             {@projects, "p3", []}
           ]}
        ],
        [
          {@regions, nil, [{@offices, "region_id", []}]},
          {@workspaces, nil,
           [
             {@projects, "workspace_id",
              [
                {@issues, "project_id",
                 [{@comments, "issue_id", [{@reactions, "comment_id", []}]}]}
              ]}
           ]}
        ]
      )

    {:ok, _} = start_supervised(Perms.Transient)

    {:ok, tree: tree}
  end

  describe "PermissionsHelpers.Tree" do
    test "scope_id!/3", cxt do
      {:ok, "p1"} =
        Scope.scope_id!(cxt.tree, @projects, %Changes.NewRecord{
          relation: @reactions,
          record: %{"id" => "r100", "comment_id" => "c2"}
        })

      {:ok, "p1"} =
        Scope.scope_id!(cxt.tree, @projects, %Changes.UpdatedRecord{
          relation: @reactions,
          record: %{"id" => "r4"}
        })

      {:ok, "p2"} =
        Scope.scope_id!(cxt.tree, @projects, %Changes.DeletedRecord{
          relation: @comments,
          old_record: %{"id" => "c4"}
        })
    end

    test "scope_id!/3 with invalid records", cxt do
      {:error, _} =
        Scope.scope_id!(cxt.tree, @projects, %Changes.NewRecord{
          relation: @reactions,
          # invalid fk
          record: %{"id" => "r100", "comment_id" => "c100"}
        })

      {:error, _} =
        Scope.scope_id!(cxt.tree, @projects, %Changes.NewRecord{
          relation: @reactions,
          # no fk
          record: %{"id" => "r100"}
        })
    end

    test "scope_id!/3 with record out of scope", cxt do
      {:error, _} =
        Scope.scope_id!(cxt.tree, @projects, %Changes.NewRecord{
          relation: @offices,
          record: %{"id" => "o100", "region_id" => "r1"}
        })

      {:error, _} =
        Scope.scope_id!(cxt.tree, @projects, %Changes.NewRecord{
          relation: @regions,
          record: %{"id" => "r100"}
        })
    end

    test "scope_id!/3 at root of scope", cxt do
      {:ok, "p1"} =
        Scope.scope_id!(cxt.tree, @projects, %Changes.NewRecord{
          relation: @issues,
          record: %{"id" => "i100", "project_id" => "p1"}
        })
    end

    test "modifies_fk?/2", cxt do
      assert Scope.modifies_fk?(
               cxt.tree,
               @projects,
               Chgs.update(@issues, %{"project_id" => "1"}, %{"project_id" => "2"})
             )

      refute Scope.modifies_fk?(
               cxt.tree,
               @projects,
               Chgs.update(@issues, %{"project_id" => "1"}, %{"comment" => "something"})
             )

      assert Scope.modifies_fk?(
               cxt.tree,
               @comments,
               Chgs.update(@reactions, %{"comment_id" => "1"}, %{"comment_id" => "2"})
             )

      refute Scope.modifies_fk?(
               cxt.tree,
               @comments,
               Chgs.update(@reactions, %{"comment_id" => "1"}, %{"comment" => "changed"})
             )

      refute Scope.modifies_fk?(
               cxt.tree,
               @regions,
               Chgs.update(@reactions, %{"comment_id" => "1"}, %{"comment_id" => "2"})
             )
    end
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

      assert :ok =
               Permissions.validate_write(
                 perms,
                 # issue i3 belongs to project p2
                 Chgs.tx([
                   Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i3"})
                 ])
               )

      assert :ok =
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

      assert :ok =
               Permissions.validate_write(
                 perms,
                 # issue i3 belongs to project p2
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

      assert :ok =
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

      assert :ok =
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

      assert :ok =
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

      assert :ok =
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

      assert :ok =
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

      assert :ok =
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

      assert :ok =
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

      assert :ok =
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
            ~s[GRANT ALL ON #{table(@issues)} TO 'editor'],
            ~s[GRANT UPDATE, SELECT ON #{table(@issues)} TO 'reader']
          ],
          [
            Roles.role("editor", @projects, "p1"),
            # read-only role on project p2
            Roles.role("reader", @projects, "p2"),
            Roles.role("editor", @projects, "p3")
          ]
        )

      assert :ok =
               Permissions.validate_write(
                 perms,
                 Chgs.tx([
                   Chgs.update(@issues, %{"id" => "i1"}, %{"project_id" => "p3"})
                 ])
               )

      # attempt to move an issue into a project we don't have write access to
      assert {:error, _} =
               Permissions.validate_write(
                 perms,
                 Chgs.tx([
                   Chgs.update(@issues, %{"id" => "i1"}, %{"project_id" => "p2"})
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
            ~s[GRANT ALL ON #{table(@issues)} TO 'editor'],
            ~s[GRANT SELECT ON #{table(@issues)} TO 'reader']
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

      assert :ok =
               cxt.perms
               |> Perms.add_transient(
                 assign_id: "assign-01",
                 target_relation: @issues,
                 target_id: "i3",
                 scope_id: "p1",
                 valid_to: LSN.new(lsn + 1)
               )
               |> Permissions.validate_write(
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
                 target_id: "i4",
                 scope_id: "p1",
                 valid_to: LSN.new(lsn + 1)
               )
               |> Permissions.validate_write(
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
                 target_id: "i3",
                 scope_id: "p1",
                 valid_to: LSN.new(lsn)
               )
               |> Permissions.validate_write(
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
            ~s[GRANT ALL ON #{table(@issues)} TO 'editor'],
            ~s[GRANT ALL ON #{table(@comments)} TO 'editor'],
            ~s[GRANT READ ON #{table(@issues)} TO 'reader'],
            ~s[GRANT READ ON #{table(@comments)} TO 'reader'],
            ~s[GRANT ALL ON #{table(@workspaces)} TO 'global_admin']
          ],
          [
            Roles.role("editor", @projects, "p1"),
            Roles.role("reader", @projects, "p2"),
            Roles.role("global_admin")
          ]
        )

      changes = [
        Chgs.update(@issues, %{"id" => "i1"}, %{"text" => "updated"}),
        Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
        Chgs.insert(@issues, %{"id" => "i101", "project_id" => "p2"}),
        # no perms on the p3 project scope
        Chgs.insert(@issues, %{"id" => "i102", "project_id" => "p3"}),
        Chgs.update(@comments, %{"id" => "c1"}, %{"text" => "updated"}),
        # no perms on the reactions table
        Chgs.update(@reactions, %{"id" => "r1"}, %{"text" => "updated"}),
        Chgs.insert(@workspaces, %{"id" => "w100"})
      ]

      filtered_tx = Permissions.filter_read(perms, Chgs.tx(changes))

      assert filtered_tx.changes == [
               Chgs.update(@issues, %{"id" => "i1"}, %{"text" => "updated"}),
               Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
               Chgs.insert(@issues, %{"id" => "i101", "project_id" => "p2"}),
               Chgs.update(@comments, %{"id" => "c1"}, %{"text" => "updated"}),
               Chgs.insert(@workspaces, %{"id" => "w100"})
             ]
    end
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
      Chgs.update(@issues, %{"id" => "i1"}, %{"text" => "updated"}),
      Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
      Chgs.update(@issues, %{"id" => "i3"}, %{"colour" => "red"})
    ]

    filtered_tx = Permissions.filter_read(perms, Chgs.tx(changes))

    assert filtered_tx.changes == changes
  end
end
