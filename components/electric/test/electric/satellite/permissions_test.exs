defmodule Electric.Satellite.PermissionsTest do
  use ExUnit.Case, async: true

  alias ElectricTest.PermissionsHelpers.{
    Auth,
    Chgs,
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
      assert {:ok, true} =
               Scope.modifies_fk?(
                 cxt.tree,
                 Chgs.update(@issues, %{"project_id" => "1"}, %{"project_id" => "2"})
               )

      assert {:ok, false} =
               Scope.modifies_fk?(
                 cxt.tree,
                 Chgs.update(@issues, %{"project_id" => "1"}, %{"comment" => "something"})
               )
    end
  end

  describe "write_allowed/3" do
    test "scoped role, change out of scope", cxt do
      perms =
        Perms.build(
          ~s[GRANT ALL ON #{table(@comments)} TO (projects, 'editor')],
          [
            Roles.role("editor", @projects, "p2")
          ]
        )

      assert {:error, _} =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 # issue i1 belongs to project p1
                 Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
               )

      assert :ok =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 # issue i3 belongs to project p2
                 Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i3"})
               )
    end

    test "unscoped role, scoped grant", cxt do
      perms =
        Perms.build(
          ~s[GRANT ALL ON #{table(@comments)} TO (projects, 'editor')],
          [
            Roles.role("editor")
          ]
        )

      assert {:error, _} =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 # issue i1 belongs to project p1
                 Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
               )
    end

    test "scoped role, unscoped grant", cxt do
      perms =
        Perms.build(
          ~s[GRANT ALL ON #{table(@comments)} TO 'editor'],
          [
            # we have an editor role within project p2
            Roles.role("editor", @projects, "p2")
          ]
        )

      assert {:error, _} =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 # issue i1 belongs to project p1
                 Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
               )

      assert :ok =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 # issue i3 belongs to project p2
                 Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i3"})
               )
    end

    test "grant for different table", cxt do
      perms =
        Perms.build(
          [
            ~s[GRANT SELECT ON #{table(@comments)} TO 'editor'],
            ~s[GRANT ALL ON #{table(@reactions)} TO 'editor']
          ],
          [
            Roles.role("editor")
          ]
        )

      assert {:error, _} =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
               )

      assert :ok =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.insert(@reactions, %{"id" => "r100"})
               )
    end

    test "unscoped role, unscoped grant", cxt do
      perms =
        Perms.build(
          ~s[GRANT UPDATE ON #{table(@comments)} TO 'editor'],
          [
            Roles.role("editor")
          ]
        )

      assert :ok =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.update(@comments, %{"id" => "c100", "issue_id" => "i1", "text" => "old"}, %{
                   "text" => "changed"
                 })
               )

      assert {:error, _} =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
               )
    end

    test "scoped role, change outside of scope", cxt do
      perms =
        Perms.build(
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
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.update(@regions, %{"id" => "r1", "name" => "region"}, %{
                   "name" => "updated region"
                 })
               )
    end

    test "AUTHENTICATED w/user_id", cxt do
      perms =
        Perms.build(
          ~s[GRANT ALL ON #{table(@comments)} TO AUTHENTICATED],
          []
        )

      assert :ok =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.insert(@comments, %{"id" => "c10"})
               )
    end

    test "AUTHENTICATED w/o permission", cxt do
      perms =
        Perms.build(
          ~s[GRANT SELECT ON #{table(@comments)} TO AUTHENTICATED],
          []
        )

      assert {:error, _} =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.insert(@comments, %{"id" => "c10"})
               )
    end

    test "AUTHENTICATED w/o user_id", cxt do
      perms =
        Perms.build(~s[GRANT ALL ON #{table(@comments)} TO AUTHENTICATED], [], Auth.nobody())

      assert {:error, _} =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.insert(@comments, %{"id" => "c10"})
               )
    end

    test "ANYONE w/o user_id", cxt do
      perms =
        Perms.build(
          ~s[GRANT ALL ON #{table(@comments)} TO ANYONE],
          [],
          Auth.nobody()
        )

      assert :ok =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.insert(@comments, %{"id" => "c10"})
               )
    end

    test "protected columns", cxt do
      perms =
        Perms.build(
          [
            ~s[GRANT INSERT (id, text) ON #{table(@comments)} TO 'editor'],
            ~s[GRANT UPDATE (text) ON #{table(@comments)} TO 'editor']
          ],
          [
            Roles.role("editor")
          ]
        )

      assert :ok =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.insert(@comments, %{"id" => "c10", "text" => "something"})
               )

      assert {:error, _} =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.insert(@comments, %{
                   "id" => "c10",
                   "text" => "something",
                   "owner" => "invalid"
                 })
               )

      assert :ok =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.update(@comments, %{"id" => "c10"}, %{"text" => "updated"})
               )

      assert {:error, _} =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.update(@comments, %{"id" => "c10"}, %{
                   "text" => "updated",
                   "owner" => "changed"
                 })
               )
    end

    test "moves between auth scopes", cxt do
      perms =
        Perms.build(
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
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.update(@issues, %{"id" => "i1"}, %{"project_id" => "p3"})
               )

      # attempt to move an issue into a project we don't have write access to
      assert {:error, _} =
               Permissions.write_allowed(
                 perms,
                 cxt.tree,
                 Chgs.update(@issues, %{"id" => "i1"}, %{"project_id" => "p2"})
               )
    end
  end

  describe "filter_read/3" do
    test "removes changes we don't have permissions to see", cxt do
      perms =
        Perms.build(
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

      assert Permissions.filter_read(perms, cxt.tree, changes) == [
               Chgs.update(@issues, %{"id" => "i1"}, %{"text" => "updated"}),
               Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
               Chgs.insert(@issues, %{"id" => "i101", "project_id" => "p2"}),
               Chgs.update(@comments, %{"id" => "c1"}, %{"text" => "updated"}),
               Chgs.insert(@workspaces, %{"id" => "w100"})
             ]
    end
  end
end
