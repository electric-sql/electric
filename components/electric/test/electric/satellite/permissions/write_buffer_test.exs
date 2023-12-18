defmodule Electric.Satellite.Permissions.WriteBufferTest do
  use ExUnit.Case, async: true

  alias Electric.Satellite.Permissions.WriteBuffer
  alias Electric.Satellite.Permissions.Graph
  alias ElectricTest.PermissionsHelpers.Chgs
  alias ElectricTest.PermissionsHelpers.Tree
  alias ElectricTest.PermissionsHelpers.Auth

  @workspaces {"public", "workspaces"}
  @projects {"public", "projects"}
  @issues {"public", "issues"}
  @comments {"public", "comments"}
  @tags {"public", "tags"}
  @issue_tags {"public", "issue_tags"}

  def tree(fks) do
    upstream =
      Tree.new(
        [
          {@workspaces, "w1",
           [
             {@projects, "p1",
              [
                {@issues, "i1", [{@comments, "c1", []}]},
                {@projects, "p1",
                 [
                   {@issues, "i1", [{@comments, "c1", []}]}
                 ]}
              ]},
             {@projects, "p9",
              [
                {@issues, "i9", [{@comments, "c9", []}]}
              ]}
           ]}
        ],
        fks
      )

    WriteBuffer.new(upstream, Auth.user())
  end

  setup do
    tree =
      tree([
        {@comments, @issues, ["issue_id"]},
        {@issues, @projects, ["project_id"]},
        {@projects, @workspaces, ["workspace_id"]}
      ])

    {:ok, tree: tree}
  end

  def apply_updates(tree, changes) do
    Enum.reduce(changes, tree, &Graph.apply_change(&2, [@workspaces], &1))
  end

  describe "scope_id/3" do
    setup(cxt) do
      changes = [
        Chgs.insert(@projects, %{"id" => "p2", "workspace_id" => "w1"}),
        Chgs.insert(@issues, %{"id" => "i2", "project_id" => "p2"}),
        Chgs.insert(@comments, %{"id" => "c2", "issue_id" => "i2"})
      ]

      tree = apply_updates(cxt.tree, changes)

      {:ok, tree: tree, unmodified_tree: cxt.tree}
    end

    test "resolves mixed local and upstream scopes", cxt do
      # original data
      assert [{["w1"], _}] =
               Graph.scope_id(cxt.tree, @workspaces, @projects, %{"id" => "p1"})

      # updates
      assert [{["w1"], _}] =
               Graph.scope_id(cxt.tree, @workspaces, @projects, %{"id" => "p2"})

      assert [{["w1"], _}] =
               Graph.scope_id(cxt.tree, @workspaces, @issues, %{"id" => "i2"})

      assert [{["w1"], _}] =
               Graph.scope_id(cxt.tree, @workspaces, @comments, %{"id" => "c2"})

      assert [{["w1"], _}] =
               Graph.scope_id(cxt.tree, @workspaces, @comments, ["c2"])

      assert [] =
               Graph.scope_id(cxt.tree, @workspaces, @projects, %{
                 "id" => "p3",
                 "workspace_id" => "w1"
               })
    end

    test "with partial scope creation", cxt do
      changes = [
        Chgs.insert(@issues, %{"id" => "i3", "project_id" => "p1"}),
        Chgs.insert(@comments, %{"id" => "c3", "issue_id" => "i3"})
      ]

      tree = apply_updates(cxt.tree, changes)

      # updates
      assert [{["w1"], _}] =
               Graph.scope_id(tree, @workspaces, @projects, %{"id" => "p2"})

      assert [{["w1"], _}] =
               Graph.scope_id(tree, @workspaces, @issues, %{"id" => "i3"})

      assert [{["w1"], _}] =
               Graph.scope_id(tree, @workspaces, @comments, %{"id" => "c3"})
    end

    test "with in-scope deletion", cxt do
      changes = [
        Chgs.delete(@issues, %{"id" => "i2"}),
        Chgs.delete(@projects, %{"id" => "p2"})
      ]

      tree = apply_updates(cxt.tree, changes)

      assert [{["w1"], _}] = Graph.scope_id(tree, @workspaces, @projects, %{"id" => "p1"})
      assert [] = Graph.scope_id(tree, @workspaces, @projects, %{"id" => "p2"})
      assert [] = Graph.scope_id(tree, @workspaces, @issues, %{"id" => "i2"})
      assert [] = Graph.scope_id(tree, @workspaces, @comments, %{"id" => "c2"})
    end

    test "adding with fk to deleted parent", cxt do
      changes = [
        Chgs.delete(@issues, %{"id" => "i2"})
      ]

      tree = apply_updates(cxt.tree, changes)

      assert_raise WriteBuffer.Error, fn ->
        changes = [
          Chgs.insert(@comments, %{"id" => "c3", "issue_id" => "i2"})
        ]

        _tree = apply_updates(tree, changes)
      end

      assert_raise WriteBuffer.Error, fn ->
        changes = [
          Chgs.delete(@issues, %{"id" => "i2"}),
          Chgs.insert(@comments, %{"id" => "c3", "issue_id" => "i2"})
        ]

        _tree = apply_updates(cxt.tree, changes)
      end
    end

    test "with non-fk changing updates", cxt do
      changes = [
        Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"description" => "changed"})
      ]

      tree = apply_updates(cxt.unmodified_tree, changes)

      refute WriteBuffer.pending_changes(tree)
    end

    test "with fk changing updates", cxt do
      changes = [
        Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"project_id" => "p2"})
      ]

      tree = apply_updates(cxt.tree, changes)

      assert [{["w1"], _}] = Graph.scope_id(tree, @workspaces, @issues, ["i1"])
      assert [{["w1"], _}] = Graph.scope_id(tree, @workspaces, @comments, ["c1"])

      ## double move: move issue i1 to project p2 and move p2 to workspace w2 so anything under
      #               the scope of i1 should now be in scope w2

      changes = [
        Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"project_id" => "p2"}),
        Chgs.update(@projects, %{"id" => "p2", "workspace_id" => "w1"}, %{"workspace_id" => "w2"})
      ]

      tree = apply_updates(cxt.tree, changes)

      assert [{["w2"], _}] = Graph.scope_id(tree, @workspaces, @issues, ["i1"])
      assert [{["w2"], _}] = Graph.scope_id(tree, @workspaces, @comments, ["c1"])

      ## triple move:
      ## - move issue i9 to project p1,
      ## - move comment c9 to issue i1,
      ## - move project p1 to workspace w2

      # c9 -> i9 -> p9 -> w1
      assert [{["w1"], _}] = Graph.scope_id(cxt.tree, @workspaces, @comments, ["c9"])
      # i1 -> p1 -> w1
      assert [{["w1"], _}] = Graph.scope_id(cxt.tree, @workspaces, @issues, ["i1"])
      # c1 -> i1 -> p1 -> w1
      assert [{["w1"], _}] = Graph.scope_id(cxt.tree, @workspaces, @comments, ["c1"])

      changes = [
        Chgs.update(@issues, %{"id" => "i9", "project_id" => "p9"}, %{"project_id" => "p1"}),
        Chgs.update(@comments, %{"id" => "c9", "issue_id" => "i9"}, %{"issue_id" => "i1"}),
        Chgs.update(@projects, %{"id" => "p1", "workspace_id" => "w1"}, %{"workspace_id" => "w2"})
      ]

      tree = apply_updates(cxt.tree, changes)

      # c9 -> i1 -> p1 -> w2
      assert [{["w2"], _}] = Graph.scope_id(tree, @workspaces, @comments, ["c9"])
      # i1 -> p1 -> w2
      assert [{["w2"], _}] = Graph.scope_id(tree, @workspaces, @issues, ["i1"])
      # c1 -> i1 -> p1 -> w2
      assert [{["w2"], _}] = Graph.scope_id(tree, @workspaces, @comments, ["c1"])

      ## move locally added items:

      changes = [
        Chgs.update(@issues, %{"id" => "i2", "project_id" => "p2"}, %{"project_id" => "p1"}),
        Chgs.update(@comments, %{"id" => "c2", "issue_id" => "i2"}, %{"issue_id" => "i9"})
      ]

      tree = apply_updates(cxt.tree, changes)

      assert [{["w1"], _}] = Graph.scope_id(tree, @workspaces, @comments, ["c2"])
      assert [{["w1"], _}] = Graph.scope_id(tree, @workspaces, @issues, ["i2"])

      ## move then delete

      changes = [
        Chgs.insert(@comments, %{"id" => "c10", "issue_id" => "i9"}),
        # move i9 to p1
        Chgs.update(@issues, %{"id" => "i9", "project_id" => "p9"}, %{"project_id" => "p1"}),
        # move c9 to i1
        Chgs.update(@comments, %{"id" => "c9", "issue_id" => "i9"}, %{"issue_id" => "i1"}),
        # move c1 into issue i9
        Chgs.update(@comments, %{"id" => "c1", "issue_id" => "i1"}, %{"issue_id" => "i9"}),
        # move p1 to w1
        Chgs.update(@projects, %{"id" => "p1", "workspace_id" => "w1"}, %{"workspace_id" => "w2"}),
        # delete i9
        Chgs.delete(@issues, %{"id" => "i9", "project_id" => "p9"})
      ]

      tree = apply_updates(cxt.tree, changes)

      # c9 not deleted by deletion of i9, now lives under i1, p1 now under w2
      assert [{["w2"], _}] = Graph.scope_id(tree, @workspaces, @comments, ["c9"])
      # p1 now under w2
      assert [{["w2"], _}] = Graph.scope_id(tree, @workspaces, @issues, ["i1"])
      # i9 deleted
      assert [] = Graph.scope_id(tree, @workspaces, @issues, ["i9"])
      # c1 moved under i9 - i9 deleted
      assert [] = Graph.scope_id(tree, @workspaces, @comments, ["c1"])
      # c10 inserted under i9, i9 deleted
      assert [] = Graph.scope_id(tree, @workspaces, @comments, ["c10"])
    end

    test "change to invalid fk", cxt do
      changes = [
        Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"project_id" => "p3"})
      ]

      assert_raise WriteBuffer.Error, fn ->
        _tree = apply_updates(cxt.tree, changes)
      end
    end

    test "just delete scope", cxt do
      changes = [
        Chgs.delete(@projects, %{"id" => "p1"})
      ]

      tree = apply_updates(cxt.tree, changes)

      assert [] = Graph.scope_id(tree, @workspaces, @comments, ["c1"])
    end
  end

  describe "join table" do
    setup do
      upstream =
        Tree.new(
          [
            {@workspaces, "w1",
             [
               {@projects, "p1",
                [
                  {@issues, "i1", [{@comments, "c1", []}]},
                  {@projects, "p1",
                   [
                     {@issues, "i1",
                      [
                        {@comments, "c1", []},
                        {@issue_tags, "it1", []}
                      ]}
                   ]}
                ]},
               {@projects, "p9",
                [
                  {@issues, "i9",
                   [
                     {@comments, "c9", []},
                     {@issue_tags, "it9", []}
                   ]}
                ]}
             ]},
            {@tags, "t1", [{@issue_tags, "it1", []}, {@issue_tags, "it9", []}]},
            {@tags, "t2", []}
          ],
          [
            {@issue_tags, @tags, ["tag_id"]},
            {@issue_tags, @issues, ["issue_id"]},
            {@comments, @issues, ["issue_id"]},
            {@issues, @projects, ["project_id"]},
            {@projects, @workspaces, ["workspace_id"]}
          ]
        )

      tree = WriteBuffer.new(upstream, Auth.user())

      {:ok, tree: tree}
    end

    test "delete join", cxt do
      assert [{["w1"], _}] = Graph.scope_id(cxt.tree, @workspaces, @issue_tags, ["it1"])
      # Although the scopes are identical the paths are not, and that's important in some
      # situations
      assert [{["w1"], p1}, {["w1"], p2}] = Graph.scope_id(cxt.tree, @workspaces, @tags, ["t1"])

      assert p1 == [
               {@workspaces, ["w1"], []},
               {@projects, ["p1"], []},
               {@issues, ["i1"], []},
               {@issue_tags, ["it1"], []},
               {@tags, ["t1"], []}
             ]

      assert p2 == [
               {@workspaces, ["w1"], []},
               {@projects, ["p9"], []},
               {@issues, ["i9"], []},
               {@issue_tags, ["it9"], []},
               {@tags, ["t1"], []}
             ]

      changes = [
        Chgs.delete(@issue_tags, %{"id" => "it1"})
      ]

      tree = apply_updates(cxt.tree, changes)

      assert [] = Graph.scope_id(tree, @workspaces, @issue_tags, ["it1"])
      assert [{["w1"], _}] = Graph.scope_id(tree, @workspaces, @tags, ["t1"])
    end

    test "change to fk in join table", cxt do
      changes = [
        Chgs.update(@issue_tags, %{"id" => "it1", "issue_id" => "i1", "tag_id" => "t1"}, %{
          "tag_id" => "t2"
        })
      ]

      tree = apply_updates(cxt.tree, changes)

      assert [{["w1"], _}] = Graph.scope_id(tree, @workspaces, @tags, ["t2"])
      assert [{["w1"], _}] = Graph.scope_id(tree, @workspaces, @tags, ["t1"])

      changes = [
        Chgs.update(@issue_tags, %{"id" => "it9", "issue_id" => "i9", "tag_id" => "t1"}, %{
          "tag_id" => "t2"
        })
      ]

      tree = apply_updates(tree, changes)

      assert [{["w1"], _}, {["w1"], _}] = Graph.scope_id(tree, @workspaces, @tags, ["t2"])
      assert [] = Graph.scope_id(tree, @workspaces, @tags, ["t1"])
    end
  end

  describe "garbage collection" do
    setup(cxt) do
      changes1 = [
        Chgs.insert(@projects, %{"id" => "p2", "workspace_id" => "w1"}, tags: ["id1@t1"]),
        Chgs.insert(@projects, %{"id" => "p3", "workspace_id" => "w1"}, tags: ["id1@t1"])
      ]

      changes2 = [
        Chgs.insert(@issues, %{"id" => "i2", "project_id" => "p2"}, tags: ["id1@t2"]),
        Chgs.insert(@comments, %{"id" => "c2", "issue_id" => "i2"}, tags: ["id1@t2"])
      ]

      changes3 = [
        Chgs.insert(@issues, %{"id" => "i2", "project_id" => "p2"}, tags: ["id1@t3"]),
        Chgs.insert(@comments, %{"id" => "c2", "issue_id" => "i2"}, tags: ["id1@t3"])
      ]

      tags = ["id1@t1", "id1@t2", "id1@t3"]

      tree = apply_updates(cxt.tree, changes1 ++ changes2 ++ changes3)

      {:ok,
       tree: tree, unmodified_tree: cxt.tree, tags: tags, changes: [changes1, changes2, changes3]}
    end

    test "tree keeps track of seen client tags", cxt do
      assert MapSet.equal?(WriteBuffer.seen_tags(cxt.tree), MapSet.new(cxt.tags))
      refute WriteBuffer.empty?(cxt.tree)
    end

    test "resets tree to empty when all tags received", cxt do
      %{changes: [changes1, changes2, changes3], tree: tree} = cxt
      tree = WriteBuffer.receive_transaction(tree, Chgs.tx(changes1))
      refute WriteBuffer.empty?(tree)

      tree = WriteBuffer.receive_transaction(tree, Chgs.tx(changes2))
      refute WriteBuffer.empty?(tree)

      tree = WriteBuffer.receive_transaction(tree, Chgs.tx(changes3))
      assert WriteBuffer.empty?(tree)

      # ensure we can still resolve scopes using the upstream
      assert [{["w1"], _}] = Graph.scope_id(tree, @workspaces, @projects, %{"id" => "p1"})
    end
  end
end
