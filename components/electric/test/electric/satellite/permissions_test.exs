defmodule Electric.Satellite.PermissionsTest do
  use ExUnit.Case, async: true

  alias ElectricTest.PermissionsHelpers

  alias ElectricTest.PermissionsHelpers.{
    Auth,
    Chgs,
    LSN,
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
  @compound_memberships {"public", "compound_memberships"}

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

  for module <- [PermissionsHelpers.Server, PermissionsHelpers.Client] do
    describe "#{module.name()}:" do
      setup(cxt) do
        {:ok, cxt} = unquote(module).setup(cxt)
        {:ok, Map.put(Map.new(cxt), :module, unquote(module))}
      end

      test "scoped role, scoped grant", cxt do
        perms =
          cxt.module.perms(
            cxt,
            [
              ~s[GRANT ALL ON #{table(@comments)} TO (projects, 'editor')],
              @projects_assign
            ],
            [
              Roles.role("editor", @projects, "p2", "assign-1")
            ]
          )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            # issue i1 belongs to project p1
            Chgs.tx([
              Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
            ])
          )
        )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   # issue i3 belongs to project p2
                   Chgs.tx([
                     Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i3"})
                   ])
                 )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
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
          cxt.module.perms(
            cxt,
            [
              ~s[GRANT ALL ON #{table(@comments)} TO (projects, 'editor')],
              @global_assign
            ],
            [
              Roles.role("editor", "assign-1")
            ]
          )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            # issue i1 belongs to project p1
            Chgs.tx([
              Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
            ])
          )
        )
      end

      test "scoped role, unscoped grant", cxt do
        perms =
          cxt.module.perms(
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

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            # issue i1 belongs to project p1
            Chgs.tx([
              Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
            ])
          )
        )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            # issue i3 belongs to project p2 but the grant is global
            Chgs.tx([
              Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i3"})
            ])
          )
        )
      end

      test "grant for different table", cxt do
        perms =
          cxt.module.perms(
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

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
            ])
          )
        )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@reactions, %{"id" => "r100", "comment_id" => "c1"})
                   ])
                 )
      end

      test "unscoped role, unscoped grant", cxt do
        perms =
          cxt.module.perms(
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
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.update(
                       @comments,
                       %{"id" => "c100", "issue_id" => "i1", "comment" => "old"},
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
            Chgs.tx([
              Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i1"})
            ])
          )
        )
      end

      test "scoped role, change outside of scope", cxt do
        perms =
          cxt.module.perms(
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
                 cxt.module.validate_write(
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
          cxt.module.perms(
            cxt,
            [
              ~s[GRANT UPDATE ON #{table(@comments)} TO (#{table(@projects)}, 'editor')]
            ],
            [
              Roles.role("editor", @projects, "p1", "non-existant")
            ]
          )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.update(@comments, %{"id" => "c1", "comment" => "old comment"}, %{
                "comment" => "new comment"
              })
            ])
          )
        )
      end

      test "overlapping global and scoped perms", cxt do
        # Test that even though the global perm doesn't grant
        # the required permissions, the scoped perms are checked
        # as well. The rule is that if *any* grant gives the perm
        # then we have it, so we need to check every applicable grant
        # until we run out of get permission.
        perms =
          cxt.module.perms(
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
                 cxt.module.validate_write(
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
          cxt.module.perms(
            cxt,
            ~s[GRANT ALL ON #{table(@comments)} TO AUTHENTICATED],
            []
          )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@comments, %{"id" => "c10", "issue_id" => "i1"})
                   ])
                 )
      end

      test "AUTHENTICATED w/o permission", cxt do
        perms =
          cxt.module.perms(
            cxt,
            ~s[GRANT UPDATE ON #{table(@comments)} TO AUTHENTICATED],
            []
          )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.insert(@comments, %{"id" => "c10", "issue_id" => "i1"})
            ])
          )
        )
      end

      test "AUTHENTICATED w/o user_id", cxt do
        perms =
          cxt.module.perms(
            cxt,
            ~s[GRANT ALL ON #{table(@comments)} TO AUTHENTICATED],
            [],
            auth: Auth.nobody()
          )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.insert(@comments, %{"id" => "c10", "issue_id" => "i1"})
            ])
          )
        )
      end

      test "ANYONE w/o user_id", cxt do
        perms =
          cxt.module.perms(
            cxt,
            ~s[GRANT ALL ON #{table(@comments)} TO ANYONE],
            [],
            auth: Auth.nobody()
          )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@comments, %{"id" => "c10", "issue_id" => "i1"})
                   ])
                 )
      end

      test "unscoped protected columns", cxt do
        perms =
          cxt.module.perms(
            cxt,
            [
              ~s[GRANT INSERT (id, comment, issue_id) ON #{table(@comments)} TO 'editor'],
              ~s[GRANT UPDATE (comment) ON #{table(@comments)} TO 'editor'],
              @global_assign
            ],
            [
              Roles.role("editor", "assign-1")
            ]
          )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@comments, %{
                       "id" => "c10",
                       "issue_id" => "i1",
                       "comment" => "something"
                     })
                   ])
                 )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.insert(@comments, %{
                "id" => "c11",
                "issue_id" => "i1",
                "comment" => "something",
                "owner" => "invalid"
              })
            ])
          )
        )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.update(@comments, %{"id" => "c10"}, %{"comment" => "updated"})
                   ])
                 )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.update(@comments, %{"id" => "c10"}, %{
                "comment" => "updated",
                "owner" => "changed"
              })
            ])
          )
        )
      end

      test "scoped protected columns", cxt do
        perms =
          cxt.module.perms(
            cxt,
            [
              ~s[GRANT INSERT (id, comment, issue_id) ON #{table(@comments)} TO (projects, 'editor')],
              ~s[GRANT UPDATE (comment) ON #{table(@comments)} TO (projects, 'editor')],
              @projects_assign
            ],
            [
              Roles.role("editor", @projects, "p1", "assign-1")
            ]
          )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@comments, %{
                       "id" => "c10",
                       "issue_id" => "i1",
                       "comment" => "something"
                     })
                   ])
                 )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.insert(@comments, %{
                "id" => "c11",
                "issue_id" => "i1",
                "comment" => "something",
                "owner" => "invalid"
              })
            ])
          )
        )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.update(@comments, %{"id" => "c2"}, %{"comment" => "updated"})
                   ])
                 )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.update(@comments, %{"id" => "c10"}, %{
                "comment" => "updated",
                "owner" => "changed"
              })
            ])
          )
        )
      end

      test "moves between auth scopes", cxt do
        perms =
          cxt.module.perms(
            cxt,
            [
              ~s[GRANT UPDATE ON #{table(@issues)} TO (#{table(@projects)}, 'editor')],
              ~s[GRANT UPDATE ON #{table(@reactions)} TO (#{table(@projects)}, 'editor')],
              ~s[GRANT SELECT ON #{table(@issues)} TO 'reader'],
              ~s[GRANT SELECT ON #{table(@reactions)} TO 'reader'],
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
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{
                       "project_id" => "p3"
                     })
                   ])
                 )

        # attempt to move an issue into a project we don't have write access to
        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.update(@issues, %{"id" => "i1", "project_id" => "p1"}, %{
                "project_id" => "p2"
              })
            ])
          )
        )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.update(@reactions, %{"id" => "r1", "comment_id" => "c1"}, %{
                       "comment_id" => "c6"
                     })
                   ])
                 )

        # attempt to move an issue into a project we don't have write access to
        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.update(@reactions, %{"id" => "r1", "comment_id" => "c1"}, %{
                "comment_id" => "c3"
              })
            ])
          )
        )
      end

      test "write in scope tree", cxt do
        perms =
          cxt.module.perms(
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
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"}),
                     Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i100"}),
                     Chgs.insert(@reactions, %{"id" => "r100", "comment_id" => "c100"})
                   ])
                 )

        # any failure should abort the tx
        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.insert(@issues, %{"id" => "i200", "project_id" => "p1"}),
              # this insert lives outside our perms
              Chgs.insert(@comments, %{"id" => "c100", "issue_id" => "i3"}),
              Chgs.insert(@reactions, %{"id" => "r100", "comment_id" => "c100"})
            ])
          )
        )
      end

      test "compound keys", cxt do
        perms =
          cxt.module.perms(
            cxt,
            [
              ~s[GRANT ALL ON #{table(@compound_level2)} TO (#{table(@compound_root)}, 'editor')],
              ~s[GRANT ALL ON #{table(@compound_level1)} TO (#{table(@compound_root)}, 'editor')],
              ~s[ASSIGN (#{table(@compound_root)}, #{table(@compound_memberships)}.role) TO #{table(@compound_memberships)}.user_id]
            ],
            [
              Roles.role("editor", @compound_root, ["cmr1_1", "cmr2_1"], "assign-1")
            ]
          )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@compound_level1, %{
                       "id1" => "cml1_100",
                       "id2" => "cml2_100",
                       "root_id1" => "cmr1_1",
                       "root_id2" => "cmr2_1"
                     })
                   ])
                 )
      end
    end

    # roles that are created on the client and then used within the same tx before triggers have
    # run on pg
    describe "#{module.name()}: intermediate roles" do
      setup(cxt) do
        {:ok, cxt} = unquote(module).setup(cxt)
        {:ok, Map.put(Map.new(cxt), :module, unquote(module))}
      end

      setup(cxt) do
        rules = [
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

          # the assign rule for the 'manager' role
          @projects_assign,
          @global_assign,
          ~s[ASSIGN site_admins.role TO site_admins.user_id]
        ]

        roles = [
          # start with the ability to create projects and memberships
          Roles.role("manager", @projects, "p1", "assign-1", row_id: ["pm1"]),
          Roles.role("admin", "assign-2")
        ]

        perms =
          cxt.module.perms(
            cxt,
            rules,
            roles
          )

        {:ok, rules: rules, roles: roles, perms: perms}
      end

      test "create and write to scope", cxt do
        assert {:ok, perms} =
                 cxt.module.validate_write(
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
                 cxt.module.validate_write(
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
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@comments, %{"id" => "c102", "issue_id" => "i101"}),
                     Chgs.insert(@comments, %{"id" => "c103", "issue_id" => "i100"})
                   ])
                 )
      end

      test "create then write to scope across txns", cxt do
        assert {:ok, perms} =
                 cxt.module.validate_write(
                   cxt.perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@projects, %{"id" => "p100", "workspace_id" => "w1"})
                   ])
                 )

        assert {:ok, perms} =
                 cxt.module.validate_write(
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
                 cxt.module.validate_write(
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
                 cxt.module.validate_write(
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

        assert_write_rejected(
          cxt.module.validate_write(
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
        )
      end

      test "removal of role via delete to memberships", cxt do
        assert {:ok, perms} =
                 cxt.module.validate_write(
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

        assert_write_rejected(
          cxt.module.validate_write(
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
        )
      end

      test "delete to existing memberships", cxt do
        assert {:ok, perms} =
                 cxt.module.validate_write(
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

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"})
            ])
          )
        )
      end

      test "delete to existing global memberships", cxt do
        # reset the db because we're repeating the permissions setup
        cxt = cxt.module.reset(cxt)

        perms =
          cxt.module.perms(
            cxt,
            cxt.rules,
            cxt.roles ++
              [
                Roles.role("site.admin", "assign-3", row_id: ["sa1"])
              ]
          )

        assert {:ok, perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@offices, %{
                       "id" => "off100",
                       "region_id" => "rg1"
                     })
                   ])
                 )

        assert {:ok, perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.delete(@site_admins, %{
                       "id" => "sa1",
                       "user_id" => Auth.user_id(),
                       "role" => "site.admin"
                     })
                   ])
                 )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.insert(@offices, %{
                "id" => "off200",
                "region_id" => "rg1"
              })
            ])
          )
        )
      end

      test "delete to existing memberships, then re-add", cxt do
        assert {:ok, perms} =
                 cxt.module.validate_write(
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
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@issues, %{"id" => "i100", "project_id" => "p1"})
                   ])
                 )
      end

      test "add and delete local role", cxt do
        assert {:ok, perms} =
                 cxt.module.validate_write(
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
        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.insert(@issues, %{"id" => "i101", "project_id" => "p100"})
            ])
          )
        )
      end

      test "local unscoped roles", cxt do
        assert_write_rejected(
          cxt.module.validate_write(
            cxt.perms,
            cxt.tree,
            Chgs.tx([
              Chgs.insert(@offices, %{
                "id" => "o100",
                "region_id" => "rg1"
              })
            ])
          )
        )

        assert {:ok, perms} =
                 cxt.module.validate_write(
                   cxt.perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@site_admins, %{
                       "id" => "sa100",
                       "user_id" => Auth.user_id(),
                       "role" => "site.admin"
                     }),
                     Chgs.insert(@offices, %{
                       "id" => "o100",
                       "region_id" => "rg1"
                     })
                   ])
                 )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.delete(@site_admins, %{
                "id" => "sa100",
                "user_id" => Auth.user_id(),
                "role" => "site.admin"
              }),
              Chgs.insert(@offices, %{
                "id" => "o101",
                "region_id" => "rg1"
              })
            ])
          )
        )
      end

      test "local scoped roles", cxt do
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

              # the assign rule for the 'manager' role
              @projects_assign,
              @global_assign,
              ~s[ASSIGN site_admins.role TO site_admins.user_id]
            ],
            [
              # don't start with the ability to create projects and memberships
              # Roles.role("manager", @projects, "p1", "assign-1", row_id: ["pm1"]),
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

        assert {:ok, perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@project_memberships, %{
                       "id" => "pm100",
                       "user_id" => Auth.user_id(),
                       "project_id" => "p1",
                       "role" => "manager"
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
                "role" => "manager"
              }),
              Chgs.insert(@issues, %{
                "id" => "i101",
                "project_id" => "p1"
              })
            ])
          )
        )
      end

      test "scope moves", cxt do
        assert_write_rejected(
          cxt.module.validate_write(
            cxt.perms,
            cxt.tree,
            Chgs.tx([
              Chgs.update(
                @issues,
                %{"id" => "i1", "project_id" => "p1"},
                %{"project_id" => "p3"}
              )
            ])
          )
        )

        assert_write_rejected(
          cxt.module.validate_write(
            cxt.perms,
            cxt.tree,
            Chgs.tx([
              Chgs.update(
                @comments,
                %{"id" => "c2", "issue_id" => "i1"},
                %{"issue_id" => "i3"}
              )
            ])
          )
        )

        assert {:ok, perms} =
                 cxt.module.validate_write(
                   cxt.perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@project_memberships, %{
                       "id" => "pm100",
                       "user_id" => Auth.user_id(),
                       "project_id" => "p3",
                       "role" => "manager"
                     })
                   ])
                 )

        assert {:ok, perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.update(
                       @comments,
                       %{"id" => "c2", "issue_id" => "i1"},
                       %{"issue_id" => "i5"}
                     )
                   ])
                 )

        assert {:ok, _perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.update(
                       @issues,
                       %{"id" => "i1", "project_id" => "p1"},
                       %{"project_id" => "p3"}
                     )
                   ])
                 )
      end

      test "scope move after removing existing role", cxt do
        assert {:ok, perms} =
                 cxt.module.validate_write(
                   cxt.perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.insert(@project_memberships, %{
                       "id" => "pm100",
                       "user_id" => Auth.user_id(),
                       "project_id" => "p3",
                       "role" => "manager"
                     })
                   ])
                 )

        assert {:ok, perms} =
                 cxt.module.validate_write(
                   perms,
                   cxt.tree,
                   Chgs.tx([
                     Chgs.delete(@project_memberships, %{
                       "id" => "pm1",
                       "user_id" => Auth.user_id(),
                       "project_id" => "p1",
                       "role" => "manager"
                     })
                   ])
                 )

        assert_write_rejected(
          cxt.module.validate_write(
            perms,
            cxt.tree,
            Chgs.tx([
              Chgs.update(
                @comments,
                %{"id" => "c6", "issue_id" => "i5"},
                %{"issue_id" => "i1"}
              )
            ])
          )
        )
      end
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
                "valid" => false
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
                       "valid" => true
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
                "valid" => true
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
                       "valid" => false
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

      assert_write_rejected(
        Permissions.validate_write(
          perms,
          cxt.tree,
          Chgs.tx([
            Chgs.update(@issues, %{"id" => "i3"}, %{"description" => "changed"})
          ])
        )
      )

      {:ok, perms: perms}
    end

    test "valid tdp", cxt do
      lsn = 99

      assert {:ok, _perms} =
               cxt.perms
               |> Perms.add_transient(
                 assign_id: "assign-1",
                 target_relation: @issues,
                 target_id: ["i3"],
                 scope_id: ["p1"],
                 valid_to: LSN.new(lsn + 1)
               )
               |> Permissions.validate_write(
                 cxt.tree,
                 # i3 belongs to project p2 where we only have read-access, but we have a
                 # transient permission that allows us to update it
                 Chgs.tx([Chgs.update(@issues, %{"id" => "i3"}, %{"description" => "changed"})],
                   lsn: lsn
                 )
               )
    end

    test "tdp out of scope", cxt do
      lsn = 99

      assert_write_rejected(
        cxt.perms
        |> Perms.add_transient(
          assign_id: "assign-1",
          target_relation: @issues,
          target_id: ["i4"],
          scope_id: ["p1"],
          valid_to: LSN.new(lsn + 1)
        )
        |> Permissions.validate_write(
          cxt.tree,
          # i3 belongs to project p2 where we only have read-access and the transient
          # permission only applies to i4, so not allowed
          Chgs.tx([Chgs.update(@issues, %{"id" => "i3"}, %{"description" => "changed"})],
            lsn: lsn
          )
        )
      )
    end

    test "expired tdp", cxt do
      lsn = 99

      assert_write_rejected(
        cxt.perms
        |> Perms.add_transient(
          assign_id: "assign-1",
          target_relation: @issues,
          target_id: ["i3"],
          scope_id: ["p1"],
          valid_to: LSN.new(lsn)
        )
        |> Permissions.validate_write(
          cxt.tree,
          # i3 belongs to project p2 where we only have read-access, we have a
          # transient permission that allows us to update it but that tdp has expired
          Chgs.tx([Chgs.update(@issues, %{"id" => "i3"}, %{"description" => "changed"})],
            lsn: lsn + 1
          )
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

      {filtered_tx, []} = Permissions.filter_read(perms, cxt.tree, Chgs.tx(changes))

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

      {filtered_tx, []} = Permissions.filter_read(perms, cxt.tree, Chgs.tx(changes))

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

      {filtered_tx, []} = Permissions.filter_read(perms, cxt.tree, Chgs.tx(changes))
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

      {filtered_tx, move_out} = Permissions.filter_read(perms, cxt.tree, Chgs.tx(changes))

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

      changes =
        expected_changes ++
          [
            Chgs.update(@workspaces, %{"id" => "w1"}, %{"name" => "changed"})
          ]

      {filtered_tx, []} = Permissions.filter_read(perms, cxt.tree, Chgs.tx(changes))

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

      {filtered_tx, []} = Permissions.filter_read(perms, cxt.tree, Chgs.tx(changes))

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
  end
end
