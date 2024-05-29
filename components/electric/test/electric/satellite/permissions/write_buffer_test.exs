defmodule Electric.Satellite.Permissions.WriteBufferTest do
  use ExUnit.Case, async: true

  alias Electric.Satellite.Permissions.WriteBuffer
  alias Electric.Satellite.Permissions.Graph
  alias ElectricTest.PermissionsHelpers.Auth
  alias ElectricTest.PermissionsHelpers.Chgs
  alias ElectricTest.PermissionsHelpers.Schema
  alias ElectricTest.PermissionsHelpers.Tree

  import ElectricTest.PermissionsHelpers

  @workspaces {"public", "workspaces"}
  @projects {"public", "projects"}
  @issues {"public", "issues"}
  @comments {"public", "comments"}
  @tags {"public", "tags"}
  @issue_tags {"public", "issue_tags"}

  def upstream(schema_version) do
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
         ]},
        {@workspaces, "w2", []}
      ],
      schema_version
    )
  end

  setup do
    migrations = [
      {"01",
       [
         "create table users (id uuid primary key)",
         "create table workspaces (id uuid primary key)",
         "create table projects (id uuid primary key, workspace_id uuid not null references workspaces (id))",
         "create table issues (id uuid primary key, project_id uuid not null references projects (id), description text)",
         "create table comments (id uuid primary key, issue_id uuid not null references issues (id), comment text, owner text)",
         "create table reactions (id uuid primary key, comment_id uuid not null references comments (id))",
         "create table tags (id uuid primary key, tag text not null)",
         "create table issue_tags (id uuid primary key, issue_id uuid not null references issues (id), tag_id uuid not null references tags (id))",
         "create table project_memberships (id uuid primary key, user_id uuid references users (id), project_id uuid references projects (id))"
       ]}
    ]

    {:ok, schema_version} = Schema.load(migrations)

    upstream = upstream(schema_version)

    write_buffer = WriteBuffer.with_upstream(WriteBuffer.new(Auth.user()), upstream)

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

    {:ok,
     write_buffer: write_buffer,
     perms: perms,
     structure: perms.structure,
     schema_version: schema_version}
  end

  def apply_updates(cxt, changes) do
    Map.update!(cxt, :write_buffer, fn write_buffer ->
      Enum.reduce(changes, write_buffer, &Graph.apply_change(&2, cxt.structure, &1))
    end)
  end

  def scope_id(cxt, root, relation, record) do
    Graph.scope_id(cxt.write_buffer, cxt.structure, root, relation, record)
  end

  describe "scope_id/3" do
    setup(cxt) do
      changes = [
        Chgs.insert(@projects, %{"id" => "p2", "workspace_id" => "w1"}),
        Chgs.insert(@issues, %{"id" => "i2", "project_id" => "p2"}),
        Chgs.insert(@comments, %{"id" => "c2", "issue_id" => "i2"})
      ]

      %{write_buffer: write_buffer} =
        %{write_buffer: cxt.write_buffer, structure: cxt.structure}
        |> apply_updates(changes)

      {:ok, write_buffer: write_buffer, unmodified_tree: cxt.write_buffer}
    end

    test "resolves mixed local and upstream scopes", cxt do
      # original data
      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @projects, %{"id" => "p1"})

      # updates
      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @projects, %{"id" => "p2"})

      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @issues, %{"id" => "i2"})

      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @comments, %{"id" => "c2"})

      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @comments, ["c2"])

      assert [] =
               scope_id(cxt, @workspaces, @projects, %{
                 "id" => "p3",
                 "workspace_id" => "w1"
               })
    end

    test "with partial scope creation", cxt do
      changes = [
        Chgs.insert(@issues, %{"id" => "i3", "project_id" => "p1"}),
        Chgs.insert(@comments, %{"id" => "c3", "issue_id" => "i3"})
      ]

      cxt = apply_updates(cxt, changes)

      # updates
      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @projects, %{"id" => "p2"})

      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @issues, %{"id" => "i3"})

      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @comments, %{"id" => "c3"})
    end

    test "with in-scope deletion", cxt do
      changes = [
        Chgs.delete(@issues, %{"id" => "i2"}),
        Chgs.delete(@projects, %{"id" => "p2"})
      ]

      cxt = apply_updates(cxt, changes)

      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @projects, %{"id" => "p1"})
      assert [] = scope_id(cxt, @workspaces, @projects, %{"id" => "p2"})
      assert [] = scope_id(cxt, @workspaces, @issues, %{"id" => "i2"})
      assert [] = scope_id(cxt, @workspaces, @comments, %{"id" => "c2"})
    end

    test "with fk changing updates", cxt do
      changes = [
        Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"project_id" => "p2"})
      ]

      cxt2 = apply_updates(cxt, changes)

      assert [{["w1"], _}] = scope_id(cxt2, @workspaces, @issues, ["i1"])
      assert [{["w1"], _}] = scope_id(cxt2, @workspaces, @comments, ["c1"])

      ## double move: move issue i1 to project p2 and move p2 to workspace w2 so anything under
      #               the scope of i1 should now be in scope w2

      changes = [
        Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"project_id" => "p2"}),
        Chgs.update(@projects, %{"id" => "p2", "workspace_id" => "w1"}, %{"workspace_id" => "w2"})
      ]

      cxt2 = apply_updates(cxt, changes)

      assert [{["w2"], _}] = scope_id(cxt2, @workspaces, @issues, ["i1"])
      assert [{["w2"], _}] = scope_id(cxt2, @workspaces, @comments, ["c1"])

      ## triple move:
      ## - move issue i9 to project p1,
      ## - move comment c9 to issue i1,
      ## - move project p1 to workspace w2

      # c9 -> i9 -> p9 -> w1
      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @comments, ["c9"])
      # i1 -> p1 -> w1
      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @issues, ["i1"])
      # c1 -> i1 -> p1 -> w1
      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @comments, ["c1"])

      changes = [
        Chgs.update(@issues, %{"id" => "i9", "project_id" => "p9"}, %{"project_id" => "p1"}),
        Chgs.update(@comments, %{"id" => "c9", "issue_id" => "i9"}, %{"issue_id" => "i1"}),
        Chgs.update(@projects, %{"id" => "p1", "workspace_id" => "w1"}, %{"workspace_id" => "w2"})
      ]

      cxt2 = apply_updates(cxt, changes)

      # c9 -> i1 -> p1 -> w2
      assert [{["w2"], _}] = scope_id(cxt2, @workspaces, @comments, ["c9"])
      # i1 -> p1 -> w2
      assert [{["w2"], _}] = scope_id(cxt2, @workspaces, @issues, ["i1"])
      # c1 -> i1 -> p1 -> w2
      assert [{["w2"], _}] = scope_id(cxt2, @workspaces, @comments, ["c1"])

      ## move locally added items:

      changes = [
        Chgs.update(@issues, %{"id" => "i2", "project_id" => "p2"}, %{"project_id" => "p1"}),
        Chgs.update(@comments, %{"id" => "c2", "issue_id" => "i2"}, %{"issue_id" => "i9"})
      ]

      cxt2 = apply_updates(cxt, changes)

      assert [{["w1"], _}] = scope_id(cxt2, @workspaces, @comments, ["c2"])
      assert [{["w1"], _}] = scope_id(cxt2, @workspaces, @issues, ["i2"])

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

      cxt2 = apply_updates(cxt, changes)

      # c9 not deleted by deletion of i9, now lives under i1, p1 now under w2
      assert [{["w2"], _}] = scope_id(cxt2, @workspaces, @comments, ["c9"])
      # p1 now under w2
      assert [{["w2"], _}] = scope_id(cxt2, @workspaces, @issues, ["i1"])
      # i9 deleted
      assert [] = scope_id(cxt2, @workspaces, @issues, ["i9"])
      # c1 moved under i9 - i9 deleted
      assert [] = scope_id(cxt2, @workspaces, @comments, ["c1"])
      # c10 inserted under i9, i9 deleted
      assert [] = scope_id(cxt2, @workspaces, @comments, ["c10"])
    end

    test "just delete scope", cxt do
      changes = [
        Chgs.delete(@projects, %{"id" => "p1"})
      ]

      cxt = apply_updates(cxt, changes)

      assert [] = scope_id(cxt, @workspaces, @comments, ["c1"])
    end
  end

  describe "join table" do
    setup(cxt) do
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
          cxt.schema_version
        )

      write_buffer = WriteBuffer.with_upstream(WriteBuffer.new(Auth.user()), upstream)

      {:ok, write_buffer: write_buffer}
    end

    test "delete join", cxt do
      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @issue_tags, ["it1"])
      # Although the scopes are identical the paths are not, and that's important in some
      # situations
      assert [{["w1"], p1}, {["w1"], p2}] = scope_id(cxt, @workspaces, @tags, ["t1"])

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

      cxt = apply_updates(cxt, changes)

      assert [] = scope_id(cxt, @workspaces, @issue_tags, ["it1"])
      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @tags, ["t1"])
    end

    test "change to fk in join table", cxt do
      changes = [
        Chgs.update(@issue_tags, %{"id" => "it1", "issue_id" => "i1", "tag_id" => "t1"}, %{
          "tag_id" => "t2"
        })
      ]

      cxt = apply_updates(cxt, changes)

      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @tags, ["t2"])
      assert [{["w1"], _}] = scope_id(cxt, @workspaces, @tags, ["t1"])

      changes = [
        Chgs.update(@issue_tags, %{"id" => "it9", "issue_id" => "i9", "tag_id" => "t1"}, %{
          "tag_id" => "t2"
        })
      ]

      cxt = apply_updates(cxt, changes)

      assert [{["w1"], _}, {["w1"], _}] = scope_id(cxt, @workspaces, @tags, ["t2"])
      assert [] = scope_id(cxt, @workspaces, @tags, ["t1"])
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

      %{write_buffer: write_buffer} = apply_updates(cxt, changes1 ++ changes2 ++ changes3)

      {:ok,
       write_buffer: write_buffer,
       unmodified_tree: cxt.write_buffer,
       tags: tags,
       changes: [changes1, changes2, changes3]}
    end

    def receive_transaction(cxt, txn) do
      WriteBuffer.receive_transaction(cxt.write_buffer, cxt.structure, txn)
    end

    test "tree keeps track of seen client tags", cxt do
      assert MapSet.equal?(WriteBuffer.seen_tags(cxt.write_buffer), MapSet.new(cxt.tags))
      refute WriteBuffer.empty?(cxt.write_buffer)
    end

    test "resets tree to empty when all tags received", cxt do
      %{changes: [changes1, changes2, changes3]} = cxt

      write_buffer = receive_transaction(cxt, Chgs.tx(changes1))

      refute WriteBuffer.empty?(write_buffer)

      write_buffer = receive_transaction(%{cxt | write_buffer: write_buffer}, Chgs.tx(changes2))

      refute WriteBuffer.empty?(write_buffer)

      write_buffer = receive_transaction(%{cxt | write_buffer: write_buffer}, Chgs.tx(changes3))

      assert WriteBuffer.empty?(write_buffer)

      # ensure we can still resolve scopes using the upstream
      assert [{["w1"], _}] =
               scope_id(%{cxt | write_buffer: write_buffer}, @workspaces, @projects, %{
                 "id" => "p1"
               })
    end
  end
end
