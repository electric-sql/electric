defmodule Electric.Satellite.Permissions.HelperTest do
  use ExUnit.Case, async: true

  alias ElectricTest.PermissionsHelpers.{
    Chgs,
    Schema,
    Tree
  }

  alias Electric.Satellite.Permissions.{Graph, Structure}
  alias Electric.Replication.Changes

  import ElectricTest.PermissionsHelpers

  @regions {"public", "regions"}
  @offices {"public", "offices"}
  @workspaces {"public", "workspaces"}
  @projects {"public", "projects"}
  @issues {"public", "issues"}
  @comments {"public", "comments"}
  @reactions {"public", "reactions"}
  @tags {"public", "tags"}
  @issue_tags {"public", "issue_tags"}

  setup do
    {:ok, schema_version} = Schema.load()

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
        schema_version
      )

    perms =
      perms_build(
        schema_version,
        [
          ~s[GRANT READ ON projects TO (projects, 'reader')],
          ~s[GRANT READ ON issues TO (projects, 'reader')],
          ~s[GRANT READ ON comments TO (projects, 'reader')],
          ~s[GRANT READ ON issue_tags TO (projects, 'reader')],
          ~s[GRANT READ ON tags TO (projects, 'reader')],
          ~s[ASSIGN (projects, project_memberships.role) TO project_memberships.user_id]
        ],
        []
      )

    {:ok, tree: tree, perms: perms, structure: perms.structure}
  end

  def scope_path(cxt, root, relation, id) do
    Graph.scope_path(cxt.tree, cxt.structure, root, relation, id)
  end

  def scope_id(cxt, root, change) do
    Graph.scope_id(cxt.tree, cxt.structure, root, change)
  end

  def scope_id(cxt, root, relation, id) do
    Graph.scope_id(cxt.tree, cxt.structure, root, relation, id)
  end

  def parent_scope_id(cxt, root, relation, record) do
    Graph.parent_scope_id(cxt.tree, cxt.structure, root, relation, record)
  end

  def modified_fks(cxt, root, change) do
    Structure.modified_fks(cxt.structure, root, change)
  end

  def parent(cxt, root, relation, record) do
    Structure.parent(cxt.structure, root, relation, record)
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
             ] = scope_path(cxt, @projects, @reactions, ["r2"])

      assert [] = scope_path(cxt, @projects, @regions, ["r2"])
    end

    test "scope_path/3 many-to-many", cxt do
      assert [
               [
                 {@projects, ["p1"], _},
                 {@issues, ["i1"], _},
                 {@issue_tags, ["it1"], _}
               ]
             ] = scope_path(cxt, @projects, @issue_tags, ["it1"])

      assert [] = scope_path(cxt, @projects, @tags, ["t2"])
    end

    test "scope_id/3", cxt do
      assert [{["p1"], [_ | _]}] =
               scope_id(cxt, @projects, %Changes.NewRecord{
                 relation: @reactions,
                 record: %{"id" => "r100", "comment_id" => "c2"}
               })

      assert [{["p1"], [_ | _]}] =
               scope_id(cxt, @projects, %Changes.UpdatedRecord{
                 relation: @reactions,
                 record: %{"id" => "r4"}
               })

      assert [{["p2"], [_ | _]}] =
               scope_id(cxt, @projects, %Changes.DeletedRecord{
                 relation: @comments,
                 old_record: %{"id" => "c4"}
               })
    end

    test "scope_id/3 for many-to-many", cxt do
      assert [{["p1"], _}] = scope_id(cxt, @projects, @issue_tags, ["it1"])

      # assert [] = scope_id(cxt, @projects, @issue_tags, ["it2"])
    end

    test "scope_id/3 with invalid records", cxt do
      assert [] =
               scope_id(cxt, @projects, %Changes.NewRecord{
                 relation: @reactions,
                 # invalid fk
                 record: %{"id" => "r100", "comment_id" => "c100"}
               })

      assert [] =
               scope_id(cxt, @projects, %Changes.NewRecord{
                 relation: @reactions,
                 # no fk
                 record: %{"id" => "r100"}
               })
    end

    test "scope_id/3 with record out of scope", cxt do
      assert [] =
               scope_id(cxt, @projects, %Changes.NewRecord{
                 relation: @offices,
                 record: %{"id" => "o100", "region_id" => "r1"}
               })

      assert [] =
               scope_id(cxt, @projects, %Changes.NewRecord{
                 relation: @regions,
                 record: %{"id" => "r100"}
               })
    end

    test "scope_id/3 at root of scope", cxt do
      assert [{["p1"], [{@projects, ["p1"]}]}] =
               scope_id(cxt, @projects, %Changes.NewRecord{
                 relation: @issues,
                 record: %{"id" => "i100", "project_id" => "p1"}
               })
    end

    test "parent_scope_id/4", cxt do
      assert [{["p1"], [{@projects, ["p1"]}]}] =
               parent_scope_id(cxt, @projects, @issues, %{
                 "id" => "i100",
                 "project_id" => "p1"
               })

      assert [{["p1"], _}] =
               parent_scope_id(cxt, @projects, @reactions, %{
                 "id" => "r100",
                 "comment_id" => "c5"
               })

      assert [] =
               parent_scope_id(cxt, @projects, @reactions, %{
                 "id" => "r100",
                 "comment_id" => "c99"
               })
    end

    test "modified_fks/2", cxt do
      assert [{@issues, ["1"], ["2"]}] =
               modified_fks(
                 cxt,
                 @projects,
                 Chgs.update(@issues, %{"id" => "1", "project_id" => "1"}, %{"project_id" => "2"})
               )

      assert [] =
               modified_fks(
                 cxt,
                 @projects,
                 Chgs.update(@issues, %{"id" => "1", "project_id" => "1"}, %{
                   "comment" => "something"
                 })
               )

      assert [{@reactions, ["1"], ["2"]}] =
               modified_fks(
                 cxt,
                 @comments,
                 Chgs.update(@reactions, %{"id" => "9", "comment_id" => "1"}, %{
                   "comment_id" => "2"
                 })
               )

      assert [] =
               modified_fks(
                 cxt,
                 @comments,
                 Chgs.update(@reactions, %{"comment_id" => "1"}, %{"comment" => "changed"})
               )

      assert [] =
               modified_fks(
                 cxt,
                 @regions,
                 Chgs.update(@reactions, %{"comment_id" => "1"}, %{"comment_id" => "2"})
               )
    end

    test "modified_fks/2 many-to-many", cxt do
      assert [{@issue_tags, ["i1"], ["i2"]}, {@tags, ["t1"], ["t2"]}] =
               modified_fks(
                 cxt,
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

      tree = Graph.transaction_context(cxt.tree, cxt.structure, Chgs.tx(changes))
      cxt = %{cxt | tree: tree}

      assert [{["p1"], [_ | _]}] =
               scope_id(cxt, @projects, %Changes.UpdatedRecord{
                 relation: @reactions,
                 record: %{"id" => "r100"}
               })

      assert [{["p1"], [_ | _]}] =
               scope_id(cxt, @projects, %Changes.DeletedRecord{
                 relation: @comments,
                 old_record: %{"id" => "c4"}
               })

      assert [] =
               scope_id(
                 cxt,
                 @projects,
                 Chgs.update(@comments, %{"id" => "c5", "issue_id" => "i2"}, %{
                   "comment" => "changed"
                 })
               )

      assert [{["p1"], [_ | _]}] =
               scope_id(cxt, @projects, %Changes.NewRecord{
                 relation: @reactions,
                 record: %{"id" => "r100", "comment_id" => "c3"}
               })

      assert [{["p1"], [_ | _]}] =
               scope_id(
                 cxt,
                 @projects,
                 Chgs.update(@reactions, %{"id" => "r100"}, %{
                   "reaction" => ":sad:"
                 })
               )
    end

    test "parent/4", cxt do
      assert [{@projects, ["p1"]}] =
               parent(cxt, @projects, @issues, %{"project_id" => "p1"})

      assert [{@issues, ["i1"]}] = parent(cxt, @projects, @comments, %{"issue_id" => "i1"})

      assert [{@workspaces, ["w1"]}] =
               parent(cxt, @workspaces, @projects, %{"workspace_id" => "w1"})

      assert [] = parent(cxt, @workspaces, @workspaces, %{"id" => "w1"})

      assert [] = parent(cxt, @projects, @offices, %{"id" => "o1", "region_id" => "r1"})
    end
  end
end
