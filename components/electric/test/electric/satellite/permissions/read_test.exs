defmodule Electric.Satellite.Permissions.ReadTest do
  use ExUnit.Case, async: true

  alias ElectricTest.PermissionsHelpers

  alias ElectricTest.PermissionsHelpers.{
    Auth,
    Chgs,
    Perms,
    Roles,
    Tree
  }

  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Satellite.{Permissions, Permissions.MoveOut}
  alias Electric.Replication.Changes

  import ElectricTest.PermissionsHelpers

  @comments {"public", "comments"}
  @issues {"public", "issues"}
  @offices {"public", "offices"}
  @project_memberships {"public", "project_memberships"}
  @projects {"public", "projects"}
  @reactions {"public", "reactions"}
  @regions {"public", "regions"}
  @site_admins {"public", "site_admins"}
  @users {"public", "users"}
  @workspaces {"public", "workspaces"}

  @compound_root {"public", "compound_root"}
  @compound_level1 {"public", "compound_level1"}
  @compound_level2 {"public", "compound_level2"}

  @projects_assign ~s[ELECTRIC ASSIGN (#{table(@projects)}, #{table(@project_memberships)}.role) TO #{table(@project_memberships)}.user_id]
  @global_assign ~s[ELECTRIC ASSIGN #{table(@users)}.role TO #{table(@users)}.id]

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
            ~s[GRANT ALL ON #{table(@workspaces)} TO 'global_admin'],
            @projects_assign,
            @global_assign
          ],
          [
            Roles.role("editor", @projects, "p1", "assign-1"),
            Roles.role("reader", @projects, "p2", "assign-1"),
            Roles.role("global_admin", "assign-2")
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

      {filtered_tx, rejected_changes, []} =
        Permissions.filter_read(perms, cxt.tree, Chgs.tx(changes))

      assert filtered_tx.changes == [
               Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"text" => "updated"}),
               Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
               Chgs.insert(@issues, %{"id" => "i101", "project_id" => "p2"}),
               Chgs.update(@comments, %{"id" => "c1", "issue_id" => "i1"}, %{"text" => "updated"}),
               Chgs.insert(@workspaces, %{"id" => "w100"})
             ]

      assert rejected_changes == [
               Chgs.insert(@issues, %{"id" => "i102", "project_id" => "p3"}),
               Chgs.update(@reactions, %{"id" => "r1", "comment_id" => "c1"}, %{
                 "text" => "updated"
               })
             ]
    end

    test "ignores column limits in grants", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT READ (id, title) ON #{table(@issues)} TO 'editor'],
            @global_assign
          ],
          [
            Roles.role("editor", "assign-1")
          ]
        )

      # none of these changes would pass a write validation
      changes = [
        Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"text" => "updated"}),
        Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
        Chgs.update(@issues, %{"id" => "i3", "project_id" => "p2"}, %{"colour" => "red"})
      ]

      {filtered_tx, [], []} = Permissions.filter_read(perms, cxt.tree, Chgs.tx(changes))

      assert filtered_tx.changes == changes
    end

    test "incorporates in-tx additions to scope", cxt do
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

      {filtered_tx, [], []} = Permissions.filter_read(perms, cxt.tree, Chgs.tx(changes))
      assert filtered_tx.changes == changes
    end

    test "incorporates in-tx removals from scope", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@comments)} TO (#{table(@projects)}, 'editor')],
            @projects_assign
          ],
          [
            Roles.role("editor", @projects, "p1", "assign-1"),
            Roles.role("editor", @projects, "p2", "assign-1")
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

      {filtered_tx, rejected, move_out} =
        Permissions.filter_read(perms, cxt.tree, Chgs.tx(changes))

      assert filtered_tx.changes == [
               Chgs.update(@issues, %{"id" => "i3", "project_id" => "p2"}, %{"project_id" => "p1"})
             ]

      assert rejected == [
               Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"project_id" => "p3"}),
               Chgs.update(@comments, %{"id" => "c1", "issue_id" => "i1"}, %{
                 "comment" => "what a mover"
               }),
               Chgs.insert(@comments, %{
                 "id" => "c100",
                 "issue_id" => "i1",
                 "comment" => "what a mover"
               }),
               Chgs.delete(@issues, %{"id" => "i2", "project_id" => "p1"}),
               Chgs.delete(@comments, %{"id" => "c5", "issue_id" => "i2"}),
               Chgs.update(@issues, %{"id" => "i5", "project_id" => "p3"}, %{"project_id" => "p4"})
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
            ~s[GRANT ALL ON #{table(@comments)} TO 'admin'],
            @projects_assign,
            @global_assign
          ],
          [
            Roles.role("editor", @projects, "p1", "assign-1"),
            Roles.role("editor", @projects, "p2", "assign-1"),
            Roles.role("admin", "assign-2")
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

      rejected_changes =
        [
          Chgs.update(@workspaces, %{"id" => "w1"}, %{"name" => "changed"})
        ]

      changes =
        expected_changes ++ rejected_changes

      {filtered_tx, ^rejected_changes, []} =
        Permissions.filter_read(perms, cxt.tree, Chgs.tx(changes))

      assert filtered_tx.changes == expected_changes
    end

    test "where clauses on grant", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor') ],
            ~s[GRANT ALL ON #{table(@comments)} TO (#{table(@projects)}, 'editor') WHERE (ROW.author_id = auth.user_id)],
            ~s[GRANT ALL ON #{table(@reactions)} TO (#{table(@projects)}, 'editor') WHERE (ROW.is_public)],
            @projects_assign
          ],
          [
            Roles.role("editor", @projects, "p1", "assign-1"),
            Roles.role("editor", @projects, "p2", "assign-1")
          ]
        )

      changes = [
        Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"text" => "updated"}),
        Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
        Chgs.insert(@issues, %{"id" => "i101", "project_id" => "p2"}),
        # author_id is us
        Chgs.update(
          @comments,
          %{"id" => "c1", "issue_id" => "i1", "author_id" => Auth.user_id()},
          %{"text" => "updated"}
        ),
        # author is not us, so should be filtered
        Chgs.update(
          @comments,
          %{"id" => "c2", "issue_id" => "i1", "author_id" => Auth.not_user_id()},
          %{"text" => "updated"}
        ),
        # matches the is_public clause
        Chgs.update(@reactions, %{"id" => "r1", "comment_id" => "c1", "is_public" => true}, %{
          "text" => "updated"
        }),
        # change of is_public fails ROW.is_public test which tests old and new values
        Chgs.update(@reactions, %{"id" => "r2", "comment_id" => "c1", "is_public" => true}, %{
          "text" => "updated",
          "is_public" => false
        }),
        Chgs.insert(@reactions, %{"id" => "r200", "comment_id" => "c1", "is_public" => true})
      ]

      {filtered_tx, _rejected, [_move]} =
        Permissions.filter_read(perms, cxt.tree, Chgs.tx(changes))

      assert filtered_tx.changes == [
               Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"text" => "updated"}),
               Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
               Chgs.insert(@issues, %{"id" => "i101", "project_id" => "p2"}),
               # author_id is us
               Chgs.update(
                 @comments,
                 %{"id" => "c1", "issue_id" => "i1", "author_id" => Auth.user_id()},
                 %{"text" => "updated"}
               ),
               # matches the is_public clause
               Chgs.update(
                 @reactions,
                 %{"id" => "r1", "comment_id" => "c1", "is_public" => true},
                 %{
                   "text" => "updated"
                 }
               ),
               Chgs.insert(@reactions, %{
                 "id" => "r200",
                 "comment_id" => "c1",
                 "is_public" => true
               })
             ]
    end

    test "changes in where clause result generate move-out messages", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor') ],
            ~s[GRANT ALL ON #{table(@comments)} TO (#{table(@projects)}, 'editor') WHERE (ROW.author_id = auth.user_id)],
            ~s[GRANT ALL ON #{table(@reactions)} TO (#{table(@projects)}, 'editor') WHERE (ROW.is_public)],
            @projects_assign
          ],
          [
            Roles.role("editor", @projects, "p1", "assign-1"),
            Roles.role("editor", @projects, "p2", "assign-1")
          ]
        )

      changes = [
        Chgs.update(@reactions, %{"id" => "r1", "comment_id" => "c1", "is_public" => true}, %{
          "is_public" => false
        })
      ]

      {filtered_tx, [_rejected], [move]} =
        Permissions.filter_read(perms, cxt.tree, Chgs.tx(changes))

      assert filtered_tx.changes == []

      assert %MoveOut{
               relation: @reactions,
               id: ["r1"]
             } = move
    end

    test "migration messages", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@comments)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@issues)} TO 'admin'],
            ~s[GRANT ALL ON #{table(@comments)} TO 'admin'],
            @projects_assign,
            @global_assign
          ],
          [
            Roles.role("editor", @projects, "p1", "assign-1"),
            Roles.role("editor", @projects, "p2", "assign-1"),
            Roles.role("admin", "assign-2")
          ]
        )

      expected_changes =
        [
          Chgs.update(@comments, %{"id" => "c1", "issue_id" => "i1"}, %{
            "comment" => "what a mover"
          }),
          Chgs.migration()
        ]

      {filtered_tx, [], []} =
        Permissions.filter_read(perms, cxt.tree, Chgs.tx(expected_changes))

      assert filtered_tx.changes == expected_changes
    end

    test "incremental build up of scope tree", cxt do
      # start with an empty tree
      tree = Tree.new([], cxt.schema_version)

      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT READ ON #{table(@projects)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@comments)} TO (#{table(@projects)}, 'editor')],
            @projects_assign
          ],
          [
            Roles.role("editor", @projects, "p1", "assign-1"),
            Roles.role("editor", @projects, "p2", "assign-1")
          ]
        )

      expected_changes = [
        Chgs.insert(@projects, %{"id" => "p1"}),
        Chgs.insert(@projects, %{"id" => "p2"})
      ]

      rejected_changes = [Chgs.insert(@projects, %{"id" => "p3"})]

      changes = expected_changes ++ rejected_changes

      {filtered_tx, ^rejected_changes, []} =
        Permissions.filter_read(perms, tree, Chgs.tx(changes))

      assert filtered_tx.changes == expected_changes

      ###

      tree = Permissions.Graph.transaction_context(tree, perms.structure, filtered_tx)

      expected_changes = [
        Chgs.insert(@issues, %{"id" => "i1", "project_id" => "p2"}),
        Chgs.insert(@issues, %{"id" => "i2", "project_id" => "p2"})
      ]

      rejected_changes = [Chgs.insert(@issues, %{"id" => "i3", "project_id" => "p3"})]
      changes = expected_changes ++ rejected_changes

      {filtered_tx, ^rejected_changes, []} =
        Permissions.filter_read(perms, tree, Chgs.tx(changes))

      assert filtered_tx.changes == expected_changes

      ###

      tree = Permissions.Graph.transaction_context(tree, perms.structure, filtered_tx)

      expected_changes = [
        Chgs.insert(@comments, %{"id" => "c1", "issue_id" => "i1"}),
        Chgs.insert(@comments, %{"id" => "c2", "issue_id" => "i2"})
      ]

      rejected_changes = [Chgs.insert(@comments, %{"id" => "c3", "issue_id" => "i3"})]
      changes = expected_changes ++ rejected_changes

      {filtered_tx, ^rejected_changes, []} =
        Permissions.filter_read(perms, tree, Chgs.tx(changes))

      assert filtered_tx.changes == expected_changes
    end

    test "scope information provided by referenced records", cxt do
      # start with an empty tree
      tree = Tree.new([], cxt.schema_version)

      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT READ ON #{table(@projects)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@comments)} TO (#{table(@projects)}, 'editor')],
            @projects_assign
          ],
          [
            Roles.role("editor", @projects, "p1", "assign-1"),
            Roles.role("editor", @projects, "p2", "assign-1")
          ]
        )

      expected_changes = [
        Chgs.insert(@comments, %{"id" => "c2", "issue_id" => "i2"})
      ]

      referenced_records = [
        {@projects, %{"id" => "p2"}},
        {@issues, %{"id" => "i2", "project_id" => "p2"}}
      ]

      rejected_changes = []

      changes = expected_changes ++ rejected_changes

      tx = Chgs.tx(changes, referenced_records: referenced_records)

      {filtered_tx, ^rejected_changes, []} = Permissions.filter_read(perms, tree, tx)

      assert filtered_tx.changes == expected_changes
      assert filtered_tx.referenced_records == tx.referenced_records
    end

    test "transaction referenced_records are filtered", cxt do
      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT ALL ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@comments)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT ALL ON #{table(@projects)} TO (#{table(@projects)}, 'editor')],
            ~s[GRANT READ ON #{table(@issues)} TO (#{table(@projects)}, 'reader')],
            ~s[GRANT READ ON #{table(@comments)} TO (#{table(@projects)}, 'reader')],
            ~s[GRANT ALL ON #{table(@workspaces)} TO 'global_admin'],
            @projects_assign,
            @global_assign
          ],
          [
            Roles.role("editor", @projects, "p1", "assign-1"),
            Roles.role("reader", @projects, "p2", "assign-1"),
            Roles.role("global_admin", "assign-2")
          ]
        )

      changes = [
        Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{"text" => "updated"}),
        Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
        Chgs.insert(@issues, %{"id" => "i101", "project_id" => "p2"}),
        # no perms on the p3 project scope
        Chgs.insert(@issues, %{"id" => "i102", "project_id" => "p3"})
      ]

      referenced_records = [
        {@projects, ["p1"]},
        # the insert to issues (let's say) brings in the project as a referenced record in the tx
        {@projects, ["p3"]}
      ]

      {filtered_tx, _rejected_changes, []} =
        Permissions.filter_read(
          perms,
          cxt.tree,
          Chgs.tx(changes, referenced_records: referenced_records)
        )

      assert filtered_tx.referenced_records ==
               %{
                 @projects => %{
                   ["p1"] => %Changes.ReferencedRecord{
                     pk: ["p1"],
                     record: %{"id" => "p1"},
                     relation: {"public", "projects"},
                     tags: []
                   }
                 }
               }
    end
  end
end
