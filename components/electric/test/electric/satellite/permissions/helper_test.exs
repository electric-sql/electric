defmodule Electric.Satellite.Permissions.HelperTest do
  use ExUnit.Case, async: true

  alias ElectricTest.PermissionsHelpers.{
    Chgs,
    Tree
  }

  alias Electric.Satellite.{Permissions.Graph}
  alias Electric.Replication.Changes

  @regions {"public", "regions"}
  @offices {"public", "offices"}
  @workspaces {"public", "workspaces"}
  @projects {"public", "projects"}
  @issues {"public", "issues"}
  @comments {"public", "comments"}
  @reactions {"public", "reactions"}
  @project_memberships {"public", "project_memberships"}
  @tags {"public", "tags"}
  @issue_tags {"public", "issue_tags"}

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
                   {@comments, "c2", [{@reactions, "r4"}]},
                   {@issue_tags, "it1", []}
                 ]},
                {@issues, "i2", [{@comments, "c5"}, {@issue_tags, "it2", []}]}
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
           ]},
          {@tags, "t1", [{@issue_tags, "it1", []}, {@issue_tags, "it2", []}]},
          {@tags, "t2", []}
        ],
        [
          {@comments, @issues, ["issue_id"]},
          {@issues, @projects, ["project_id"]},
          {@offices, @regions, ["region_id"]},
          {@project_memberships, @projects, ["project_id"]},
          {@projects, @workspaces, ["workspace_id"]},
          {@reactions, @comments, ["comment_id"]},
          # tasty join table
          {@issue_tags, @tags, ["tag_id"]},
          {@issue_tags, @issues, ["issue_id"]}
        ]
      )

    {:ok, tree: tree}
  end

  describe "PermissionsHelpers.Tree" do
    test "scope_path/3", cxt do
      assert [
               [
                 {@projects, ["p1"], _},
                 {@issues, ["i1"], _},
                 {@comments, ["c1"], _},
                 {@reactions, ["r2"], _}
               ]
             ] = Graph.scope_path(cxt.tree, @projects, @reactions, ["r2"])

      assert [] = Graph.scope_path(cxt.tree, @projects, @regions, ["r2"])
    end

    test "scope_path/3 many-to-many", cxt do
      assert [
               [
                 {@projects, ["p1"], _},
                 {@issues, ["i1"], _},
                 {@issue_tags, ["it1"], _},
                 {@tags, ["t1"], _}
               ],
               [
                 {@projects, ["p1"], _},
                 {@issues, ["i2"], _},
                 {@issue_tags, ["it2"], _},
                 {@tags, ["t1"], _}
               ]
             ] = Graph.scope_path(cxt.tree, @projects, @tags, ["t1"])

      assert [] = Graph.scope_path(cxt.tree, @projects, @tags, ["t2"])
    end

    test "scope_id/3", cxt do
      assert [{["p1"], [_ | _]}] =
               Graph.scope_id(cxt.tree, @projects, %Changes.NewRecord{
                 relation: @reactions,
                 record: %{"id" => "r100", "comment_id" => "c2"}
               })

      assert [{["p1"], [_ | _]}] =
               Graph.scope_id(cxt.tree, @projects, %Changes.UpdatedRecord{
                 relation: @reactions,
                 record: %{"id" => "r4"}
               })

      assert [{["p2"], [_ | _]}] =
               Graph.scope_id(cxt.tree, @projects, %Changes.DeletedRecord{
                 relation: @comments,
                 old_record: %{"id" => "c4"}
               })
    end

    test "scope_id/3 for many-to-many", cxt do
      assert [{["p1"], _}, {["p1"], _}] = Graph.scope_id(cxt.tree, @projects, @tags, ["t1"])
      assert [] = Graph.scope_id(cxt.tree, @projects, @tags, ["t2"])
    end

    test "scope_id/3 with invalid records", cxt do
      assert [] =
               Graph.scope_id(cxt.tree, @projects, %Changes.NewRecord{
                 relation: @reactions,
                 # invalid fk
                 record: %{"id" => "r100", "comment_id" => "c100"}
               })

      assert [] =
               Graph.scope_id(cxt.tree, @projects, %Changes.NewRecord{
                 relation: @reactions,
                 # no fk
                 record: %{"id" => "r100"}
               })
    end

    test "scope_id/3 with record out of scope", cxt do
      assert [] =
               Graph.scope_id(cxt.tree, @projects, %Changes.NewRecord{
                 relation: @offices,
                 record: %{"id" => "o100", "region_id" => "r1"}
               })

      assert [] =
               Graph.scope_id(cxt.tree, @projects, %Changes.NewRecord{
                 relation: @regions,
                 record: %{"id" => "r100"}
               })
    end

    test "scope_id/3 at root of scope", cxt do
      assert [{["p1"], [{@projects, ["p1"]}]}] =
               Graph.scope_id(cxt.tree, @projects, %Changes.NewRecord{
                 relation: @issues,
                 record: %{"id" => "i100", "project_id" => "p1"}
               })
    end

    test "parent_scope_id/4", cxt do
      assert [{["p1"], [{@projects, ["p1"]}]}] =
               Graph.parent_scope_id(cxt.tree, @projects, @issues, %{
                 "id" => "i100",
                 "project_id" => "p1"
               })

      assert [{["p1"], _}] =
               Graph.parent_scope_id(cxt.tree, @projects, @reactions, %{
                 "id" => "r100",
                 "comment_id" => "c5"
               })

      assert [] =
               Graph.parent_scope_id(cxt.tree, @projects, @reactions, %{
                 "id" => "r100",
                 "comment_id" => "c99"
               })
    end

    test "modified_fks/2", cxt do
      assert [{@issues, ["1"], ["1"]}] =
               Graph.modified_fks(
                 cxt.tree,
                 @projects,
                 Chgs.update(@issues, %{"id" => "1", "project_id" => "1"}, %{"project_id" => "2"})
               )

      assert [] =
               Graph.modified_fks(
                 cxt.tree,
                 @projects,
                 Chgs.update(@issues, %{"id" => "1", "project_id" => "1"}, %{
                   "comment" => "something"
                 })
               )

      assert [{@reactions, ["9"], ["9"]}] =
               Graph.modified_fks(
                 cxt.tree,
                 @comments,
                 Chgs.update(@reactions, %{"id" => "9", "comment_id" => "1"}, %{
                   "comment_id" => "2"
                 })
               )

      assert [] =
               Graph.modified_fks(
                 cxt.tree,
                 @comments,
                 Chgs.update(@reactions, %{"comment_id" => "1"}, %{"comment" => "changed"})
               )

      assert [] =
               Graph.modified_fks(
                 cxt.tree,
                 @regions,
                 Chgs.update(@reactions, %{"comment_id" => "1"}, %{"comment_id" => "2"})
               )
    end

    test "modified_fks/2 many-to-many", cxt do
      assert [{@issue_tags, ["it1"], ["it1"]}, {@tags, ["t1"], ["t2"]}] =
               Graph.modified_fks(
                 cxt.tree,
                 @projects,
                 Chgs.update(
                   @issue_tags,
                   %{"id" => "it1", "issue_id" => "i1", "tag_id" => "t1"},
                   %{"issue_id" => "i2", "tag_id" => "t2"}
                 )
               )
    end

    test "transaction_context/3", cxt do
      changes = [
        Chgs.update(@issues, %{"id" => "i3", "project_id" => "p2"}, %{"project_id" => "p1"}),
        Chgs.update(@comments, %{"id" => "c3", "issue_id" => "i3"}, %{"comment" => "what a mover"}),
        #
        Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
        Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i100"}),
        Chgs.insert(@reactions, %{"id" => "r100", "comment_id" => "c100", "reaction" => ":ok:"}),
        #
        Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"project_id" => "p3"}),
        Chgs.update(@comments, %{"id" => "c1", "issue_id" => "i1"}, %{"comment" => "what a mover"}),
        Chgs.delete(@issues, %{"id" => "i2"})
      ]

      tree = Graph.transaction_context(cxt.tree, [@projects], Chgs.tx(changes))

      assert [{["p1"], [_ | _]}] =
               Graph.scope_id(tree, @projects, %Changes.UpdatedRecord{
                 relation: @reactions,
                 record: %{"id" => "r100"}
               })

      assert [{["p1"], [_ | _]}] =
               Graph.scope_id(tree, @projects, %Changes.DeletedRecord{
                 relation: @comments,
                 old_record: %{"id" => "c4"}
               })

      assert [] =
               Graph.scope_id(
                 tree,
                 @projects,
                 Chgs.update(@comments, %{"id" => "c5", "issue_id" => "i2"}, %{
                   "comment" => "changed"
                 })
               )

      assert [{["p1"], [_ | _]}] =
               Graph.scope_id(tree, @projects, %Changes.NewRecord{
                 relation: @reactions,
                 record: %{"id" => "r100", "comment_id" => "c3"}
               })

      assert [{["p1"], [_ | _]}] =
               Graph.scope_id(
                 tree,
                 @projects,
                 Chgs.update(@reactions, %{"id" => "r100"}, %{
                   "reaction" => ":sad:"
                 })
               )
    end

    test "parent/4", cxt do
      assert {@projects, ["p1"]} =
               Graph.parent(cxt.tree, @projects, @issues, %{"project_id" => "p1"})

      assert {@issues, ["i1"]} =
               Graph.parent(cxt.tree, @projects, @comments, %{"issue_id" => "i1"})

      assert {@workspaces, ["w1"]} =
               Graph.parent(cxt.tree, @workspaces, @projects, %{"workspace_id" => "w1"})

      refute Graph.parent(cxt.tree, @workspaces, @workspaces, %{"id" => "w1"})
      refute Graph.parent(cxt.tree, @projects, @offices, %{"id" => "o1", "region_id" => "r1"})
    end
  end
end
