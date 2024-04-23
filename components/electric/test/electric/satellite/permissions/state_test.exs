defmodule Electric.Satellite.Permissions.StateTest do
  use ExUnit.Case, async: true
  use Electric.Postgres.MockSchemaLoader

  alias Electric.DDLX
  alias Electric.DDLX.Command
  alias Electric.Replication.Changes
  alias Electric.Satellite.Permissions.State
  alias Electric.Satellite.SatPerms
  alias ElectricTest.PermissionsHelpers.{Chgs, Proto}

  def apply_ddlx(rules \\ %SatPerms.Rules{}, cmds) do
    State.apply_ddlx(rules, Command.ddlx(cmds))
  end

  def new(cmds) do
    apply_ddlx(cmds)
  end

  def parse_ddlx(ddlx) do
    ddlx
    |> Enum.map(&DDLX.Parser.parse/1)
    |> Enum.map(&elem(&1, 1))
    |> Enum.map(fn %{action: %SatPerms.DDLX{} = action} -> action end)
  end

  @scoped_assign_relation {"public", "project_memberships"}
  @unscoped_assign_relation {"public", "site_admins"}

  describe "apply_ddlx/2" do
    test "ASSIGN" do
      assign =
        Proto.assign(
          table: Proto.table("my_default", "admin_users"),
          user_column: "user_id",
          role_name: "admin"
        )

      assert %SatPerms.Rules{id: 1, parent_id: 0} = rules = apply_ddlx(assigns: [assign])

      assert [^assign] = rules.assigns
    end

    test "ASSIGN, UNASSIGN" do
      rules =
        new(
          assigns: [
            Proto.assign(
              table: Proto.table("my_default", "admin_users"),
              user_column: "user_id",
              role_name: "admin"
            )
          ]
        )

      updated =
        apply_ddlx(
          rules,
          unassigns: [
            Proto.unassign(
              table: Proto.table("my_default", "admin_users"),
              user_column: "user_id",
              role_name: "admin"
            )
          ]
        )

      assert updated.id == 2
      assert updated.assigns == []
    end

    test "ASSIGN ... IF, UNASSIGN" do
      rules =
        new(
          assigns: [
            Proto.assign(
              table: Proto.table("my_default", "admin_users"),
              user_column: "user_id",
              role_name: "admin",
              if: "something()"
            )
          ]
        )

      updated =
        apply_ddlx(
          rules,
          unassigns: [
            Proto.unassign(
              table: Proto.table("my_default", "admin_users"),
              user_column: "user_id",
              role_name: "admin"
            )
          ]
        )

      assert updated.id == 2
      assert updated.assigns == []
    end

    test "ASSIGN, ASSIGN, UNASSIGN" do
      assign1 =
        Proto.assign(
          table: Proto.table("my_default", "admin_users"),
          user_column: "user_id",
          role_name: "admin",
          scope: Proto.scope("projects")
        )

      assign2 =
        Proto.assign(
          table: Proto.table("my_default", "admin_users"),
          user_column: "user_id",
          role_column: "role_name"
        )

      rules = new(assigns: [assign1, assign2])

      rules =
        apply_ddlx(rules,
          unassigns: [
            Proto.unassign(
              table: Proto.table("my_default", "admin_users"),
              user_column: "user_id",
              role_name: "admin",
              scope: Proto.scope("projects")
            )
          ]
        )

      assert rules.id == 2
      assert [^assign2] = rules.assigns
    end

    test "ASSIGN, re-ASSIGN" do
      assign1 =
        Proto.assign(
          table: Proto.table("my_default", "admin_users"),
          user_column: "user_id",
          role_name: "admin",
          scope: Proto.scope("projects")
        )

      assign2 =
        Proto.assign(
          table: Proto.table("my_default", "admin_users"),
          user_column: "user_id",
          role_name: "admin",
          scope: Proto.scope("projects"),
          if: "some_test()"
        )

      rules = new(assigns: [assign1])

      rules = apply_ddlx(rules, assigns: [assign2])

      assert rules.id == 2
      assert [^assign2] = rules.assigns
    end

    test "GRANT" do
      grant =
        Proto.grant(
          table: Proto.table("issues"),
          role: Proto.role("editor"),
          privilege: :INSERT,
          scope: Proto.scope("projects")
        )

      rules = apply_ddlx(grants: [grant])

      assert rules.id == 1
      assert [^grant] = rules.grants
    end

    test "GRANT, REVOKE" do
      grant =
        Proto.grant(
          table: Proto.table("issues"),
          role: Proto.role("editor"),
          privilege: :INSERT,
          scope: Proto.scope("projects")
        )

      rules = new(grants: [grant])

      updated =
        apply_ddlx(
          rules,
          revokes: [
            Proto.revoke(
              table: Proto.table("issues"),
              role: Proto.role("editor"),
              privilege: :INSERT,
              scope: Proto.scope("projects")
            )
          ]
        )

      assert updated.grants == []
    end

    test "GRANT ... CHECK, REVOKE" do
      grant =
        Proto.grant(
          table: Proto.table("issues"),
          role: Proto.role("editor"),
          privilege: :INSERT,
          scope: Proto.scope("projects"),
          check: "something()"
        )

      rules = new(grants: [grant])

      updated =
        apply_ddlx(
          rules,
          revokes: [
            Proto.revoke(
              table: Proto.table("issues"),
              role: Proto.role("editor"),
              privilege: :INSERT,
              scope: Proto.scope("projects")
            )
          ]
        )

      assert updated.grants == []
    end

    test "GRANT, GRANT, REVOKE" do
      grant1 =
        Proto.grant(
          table: Proto.table("issues"),
          role: Proto.role("editor"),
          privilege: :INSERT,
          scope: Proto.scope("projects")
        )

      grant2 =
        Proto.grant(
          table: Proto.table("issues"),
          role: Proto.role("editor"),
          privilege: :UPDATE,
          scope: Proto.scope("projects")
        )

      rules = new(grants: [grant1, grant2])

      updated =
        apply_ddlx(
          rules,
          revokes: [
            Proto.revoke(
              table: Proto.table("issues"),
              role: Proto.role("editor"),
              privilege: :INSERT,
              scope: Proto.scope("projects")
            )
          ]
        )

      assert updated.grants == [grant2]
    end

    test "GRANT, re-GRANT" do
      grant1 =
        Proto.grant(
          table: Proto.table("issues"),
          role: Proto.role("editor"),
          privilege: :INSERT,
          scope: Proto.scope("projects")
        )

      grant2 =
        Proto.grant(
          table: Proto.table("issues"),
          role: Proto.role("editor"),
          privilege: :INSERT,
          scope: Proto.scope("projects"),
          check: "some_check()"
        )

      rules = new(grants: [grant1])

      updated = apply_ddlx(rules, grants: [grant2])

      assert updated.grants == [grant2]
    end

    test "update with DDLX" do
      ddlx = [
        ~S[ELECTRIC ASSIGN (projects, members.role_name) TO members.user_id],
        ~S[ELECTRIC ASSIGN (projects, members.role_name) TO members.user_id IF (some_check_passes())],
        ~S[ELECTRIC GRANT ALL ON issues TO (projects, 'editor')],
        ~S[ELECTRIC GRANT READ ON issues TO (projects, 'editor') WHERE ((ROW.user_id = AUTH.user_id) AND (ROW.value > 3))],
        ~S[ELECTRIC REVOKE DELETE ON issues FROM (projects, 'editor')]
      ]

      rules =
        ddlx
        |> parse_ddlx()
        |> Enum.reduce(%SatPerms.Rules{}, &State.apply_ddlx(&2, &1))

      assert rules == %SatPerms.Rules{
               id: 5,
               parent_id: 4,
               assigns: [
                 Proto.assign(
                   scope: Proto.scope("projects"),
                   table: Proto.table("members"),
                   user_column: "user_id",
                   role_column: "role_name",
                   if: "some_check_passes()"
                 )
               ],
               grants: [
                 Proto.grant(
                   privilege: :UPDATE,
                   scope: Proto.scope("projects"),
                   table: Proto.table("issues"),
                   role: Proto.role("editor")
                 ),
                 Proto.grant(
                   privilege: :SELECT,
                   scope: Proto.scope("projects"),
                   table: Proto.table("issues"),
                   role: Proto.role("editor"),
                   check: "(ROW.user_id = AUTH.user_id) AND (ROW.value > 3)"
                 ),
                 Proto.grant(
                   privilege: :INSERT,
                   scope: Proto.scope("projects"),
                   table: Proto.table("issues"),
                   role: Proto.role("editor")
                 )
               ]
             }

      ddlx = [
        ~S[ELECTRIC UNASSIGN (projects, members.role_name) FROM members.user_id],
        ~S[ELECTRIC REVOKE UPDATE ON issues FROM (projects, 'editor')],
        ~S[ELECTRIC REVOKE READ ON issues FROM (projects, 'editor')],
        ~S[ELECTRIC REVOKE INSERT ON issues FROM (projects, 'editor')]
      ]

      rules =
        ddlx
        |> parse_ddlx()
        |> Enum.reduce(rules, &State.apply_ddlx(&2, &1))

      assert rules == %SatPerms.Rules{
               id: 9,
               parent_id: 8,
               assigns: [],
               grants: []
             }
    end
  end

  def loader_with_global_perms(cxt, ddlx \\ default_ddlx()) do
    loader = loader(cxt)

    ddlx = Command.ddlx(ddlx)

    assert {:ok, _, loader, rules} = State.update_global(ddlx, loader)

    {loader, rules}
  end

  defp default_ddlx do
    [
      grants: [
        Proto.grant(
          privilege: :INSERT,
          table: Proto.table("issues"),
          role: Proto.role("editor"),
          scope: Proto.scope("projects")
        )
      ],
      assigns: [
        Proto.assign(
          table: Proto.table("project_memberships"),
          scope: Proto.scope("projects"),
          user_column: "user_id",
          role_column: "project_role"
        ),
        Proto.assign(
          table: Proto.table("site_admins"),
          user_column: "user_id",
          role_column: "site_role"
        )
      ]
    ]
  end

  def loader(_cxt) do
    loader_spec =
      MockSchemaLoader.backend_spec(
        migrations: [
          {"01",
           [
             """
             create table projects (id uuid primary key)
             """,
             """
             create table users (id uuid primary key)
             """,
             """
             create table teams (id uuid primary key)
             """,
             """
             create table project_memberships (
                id uuid primary key,
                user_id uuid not null references users (id),
                project_id uuid not null references projects (id),
                project_role text not null,
                is_enabled bool
             )
             """,
             """
             create table team_memberships (
                id uuid primary key,
                user_id uuid not null references users (id),
                team_id uuid not null references teams (id),
                team_role text not null
             )
             """,
             """
             create table site_admins (
                id uuid primary key,
                user_id uuid not null references users (id),
                site_role text not null,
                is_superuser bool default false
             )
             """,
             """
             create table my_default.admin_users (
                id uuid primary key,
                user_id uuid not null references users (id)
             )
             """
           ]}
        ]
      )

    {:ok, loader} = SchemaLoader.connect(loader_spec, [])
    loader
  end

  describe "global rules serialisation" do
    test "is initialised with empty state", cxt do
      loader = loader(cxt)

      assert {:ok, %SatPerms.Rules{id: 1, assigns: [], grants: []}} =
               SchemaLoader.global_permissions(loader)
    end

    test "can update its state", cxt do
      loader = loader(cxt)
      assert {:ok, consumer} = State.new(loader)

      assign1 =
        Proto.assign(
          table: Proto.table("my_default", "admin_users"),
          user_column: "user_id",
          role_name: "admin"
        )

      ddlx = Command.ddlx(assigns: [assign1])

      tx =
        Chgs.tx([
          Chgs.insert({"public", "kittens"}, %{"size" => "cute"}),
          Chgs.ddlx(ddlx)
        ])

      assert {:ok, tx, consumer, loader} = State.update(tx, consumer, loader)

      assert tx.changes == [
               Chgs.insert({"public", "kittens"}, %{"size" => "cute"}),
               %Changes.UpdatedPermissions{
                 type: :global,
                 permissions: %Changes.UpdatedPermissions.GlobalPermissions{
                   permissions_id: 2
                 }
               }
             ]

      assert {:ok, rules} = SchemaLoader.global_permissions(loader)
      assert %SatPerms.Rules{id: 2, parent_id: 1, assigns: [^assign1]} = rules

      assign2 =
        Proto.assign(
          table: Proto.table("my_default", "admin_users"),
          user_column: "user_id",
          role_name: "admin2"
        )

      ddlx = Command.ddlx(assigns: [assign2])

      tx =
        Chgs.tx([
          Chgs.ddlx(ddlx),
          Chgs.insert({"public", "kittens"}, %{"size" => "cute"})
        ])

      assert {:ok, tx, _consumer, loader} = State.update(tx, consumer, loader)

      assert tx.changes == [
               %Changes.UpdatedPermissions{
                 type: :global,
                 permissions: %Changes.UpdatedPermissions.GlobalPermissions{
                   permissions_id: 3
                 }
               },
               Chgs.insert({"public", "kittens"}, %{"size" => "cute"})
             ]

      assert {:ok, rules} = SchemaLoader.global_permissions(loader)
      assert %SatPerms.Rules{id: 3, parent_id: 2, assigns: [^assign1, ^assign2]} = rules
    end

    test "sequential updates are coalesced", cxt do
      # we want to minimize permissions churn when possible
      loader = loader(cxt)
      assert {:ok, consumer} = State.new(loader)

      assign1 =
        Proto.assign(
          table: Proto.table("my_default", "admin_users"),
          user_column: "user_id",
          role_name: "admin"
        )

      ddlx1 = Command.ddlx(assigns: [assign1])

      assign2 =
        Proto.assign(
          table: Proto.table("project_memberships"),
          user_column: "user_id",
          scope: Proto.scope("projects"),
          role_column: "role"
        )

      ddlx2 = Command.ddlx(assigns: [assign2])

      assign3 =
        Proto.assign(
          table: Proto.table("team_memberships"),
          user_column: "user_id",
          scope: Proto.scope("teams"),
          role_column: "role"
        )

      ddlx3 = Command.ddlx(assigns: [assign3])

      tx =
        Chgs.tx([
          Chgs.ddlx(ddlx1),
          Chgs.ddlx(ddlx2),
          Chgs.insert({"public", "kittens"}, %{"size" => "cute"}),
          Chgs.insert({"public", "kittens"}, %{"fur" => "furry"}),
          Chgs.ddlx(ddlx3)
        ])

      assert {:ok, tx, _consumer, _loader} = State.update(tx, consumer, loader)

      assert tx.changes == [
               %Changes.UpdatedPermissions{
                 type: :global,
                 permissions: %Changes.UpdatedPermissions.GlobalPermissions{
                   permissions_id: 2
                 }
               },
               Chgs.insert({"public", "kittens"}, %{"size" => "cute"}),
               Chgs.insert({"public", "kittens"}, %{"fur" => "furry"}),
               %Changes.UpdatedPermissions{
                 type: :global,
                 permissions: %Changes.UpdatedPermissions.GlobalPermissions{
                   permissions_id: 3
                 }
               }
             ]
    end
  end

  @user_id "7a81b0d0-97bf-466d-9053-4612146c2b67"

  describe "user roles state" do
    test "starts with empty state", cxt do
      {loader, rules} = loader_with_global_perms(cxt)

      assert {:ok, _loader,
              %SatPerms{
                id: 1,
                user_id: @user_id,
                rules: ^rules,
                roles: []
              } = perms} =
               SchemaLoader.user_permissions(loader, @user_id)

      assert {:ok, _loader, ^perms} =
               SchemaLoader.user_permissions(loader, @user_id)
    end

    test "can load a specific version", cxt do
      {loader, _rules} = loader_with_global_perms(cxt)

      assert {:ok, loader, perms} =
               SchemaLoader.user_permissions(loader, @user_id)

      assert {:ok, ^perms} =
               SchemaLoader.user_permissions(loader, @user_id, perms.id)

      assert {:ok, _loader, other_perms} =
               SchemaLoader.user_permissions(loader, "7c9fe38c-895b-48f5-9b31-bb6ca992bf2b")

      refute other_perms.id == perms.id

      # attempting to load another user's perms by id
      assert {:error, _} =
               SchemaLoader.user_permissions(loader, @user_id, other_perms.id)
    end

    test "scoped user roles are added via an insert to roles table", cxt do
      {loader, rules} = loader_with_global_perms(cxt)
      {:ok, consumer} = State.new(loader)

      %{assigns: [%{id: assign_id1}, %{id: assign_id2}]} = rules

      # table: Proto.table("project_memberships"),
      # scope: Proto.scope("projects"),
      # user_column: "user_id",
      # role_name: "editor"
      tx =
        Chgs.tx([
          Chgs.insert({"public", "kittens"}, %{"size" => "cute"}),
          Chgs.insert(
            @scoped_assign_relation,
            %{
              "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
              "project_role" => "editor",
              "user_id" => @user_id,
              "project_id" => "123"
            }
          )
        ])

      assert {:ok, tx, consumer, loader} = State.update(tx, consumer, loader)

      assert {:ok, loader, perms} =
               SchemaLoader.user_permissions(loader, @user_id)

      assert %{id: 2, user_id: @user_id, rules: %{id: 2}} = perms

      assert tx.changes == [
               Chgs.insert({"public", "kittens"}, %{"size" => "cute"}),
               Chgs.insert(
                 @scoped_assign_relation,
                 %{
                   "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
                   "project_role" => "editor",
                   "user_id" => @user_id,
                   "project_id" => "123"
                 }
               ),
               %Changes.UpdatedPermissions{
                 type: :user,
                 permissions: %Changes.UpdatedPermissions.UserPermissions{
                   user_id: @user_id,
                   permissions: perms
                 }
               }
             ]

      assert perms.roles == [
               %SatPerms.Role{
                 row_id: ["db87f03f-89e1-48b4-a5c3-6cdbafb2837d"],
                 assign_id: assign_id2,
                 role: "editor",
                 user_id: @user_id,
                 scope: %SatPerms.Scope{table: Proto.table("projects"), id: ["123"]}
               }
             ]

      tx =
        Chgs.tx([
          Chgs.insert(
            @unscoped_assign_relation,
            %{
              "id" => "5c0fd272-3fc2-4ae8-8574-92823c814096",
              "site_role" => "site_admin",
              "user_id" => @user_id
            }
          )
        ])

      assert {:ok, tx, _consumer, loader} = State.update(tx, consumer, loader)

      assert {:ok, _loader, perms} =
               SchemaLoader.user_permissions(loader, @user_id)

      assert %{id: 3, user_id: @user_id, rules: %{id: 2}} = perms

      assert tx.changes == [
               Chgs.insert(
                 @unscoped_assign_relation,
                 %{
                   "id" => "5c0fd272-3fc2-4ae8-8574-92823c814096",
                   "site_role" => "site_admin",
                   "user_id" => @user_id
                 }
               ),
               %Changes.UpdatedPermissions{
                 type: :user,
                 permissions: %Changes.UpdatedPermissions.UserPermissions{
                   user_id: @user_id,
                   permissions: perms
                 }
               }
             ]

      assert perms.roles == [
               %SatPerms.Role{
                 row_id: ["5c0fd272-3fc2-4ae8-8574-92823c814096"],
                 assign_id: assign_id1,
                 role: "site_admin",
                 user_id: @user_id,
                 scope: nil
               },
               %SatPerms.Role{
                 row_id: ["db87f03f-89e1-48b4-a5c3-6cdbafb2837d"],
                 assign_id: assign_id2,
                 role: "editor",
                 user_id: @user_id,
                 scope: %SatPerms.Scope{table: Proto.table("projects"), id: ["123"]}
               }
             ]
    end

    test "new assign rules are used on changes in tx", cxt do
      {loader, _rules} = loader_with_global_perms(cxt)
      assert {:ok, consumer} = State.new(loader)

      assign =
        Proto.assign(
          table: Proto.table("team_memberships"),
          scope: Proto.scope("teams"),
          user_column: "user_id",
          role_column: "team_role"
        )

      ddlx = Command.ddlx(assigns: [assign])

      tx =
        Chgs.tx([
          Chgs.ddlx(ddlx),
          Chgs.insert(
            {"public", "team_memberships"},
            %{
              "id" => "b72c24b5-20b5-4eea-ab12-ec38d6adcab7",
              "team_role" => "team_owner",
              "user_id" => @user_id,
              "team_id" => "7dde618b-0cb2-44b5-8b12-b98c59338116"
            }
          )
        ])

      assert {:ok, _tx, _consumer, loader} = State.update(tx, consumer, loader)

      assert {:ok, _loader, perms} =
               SchemaLoader.user_permissions(loader, @user_id)

      assert Enum.filter(perms.roles, &(&1.assign_id == assign.id)) == [
               %SatPerms.Role{
                 row_id: ["b72c24b5-20b5-4eea-ab12-ec38d6adcab7"],
                 assign_id: assign.id,
                 role: "team_owner",
                 user_id: @user_id,
                 scope: %SatPerms.Scope{
                   table: Proto.table("teams"),
                   id: ["7dde618b-0cb2-44b5-8b12-b98c59338116"]
                 }
               }
             ]
    end

    test "user roles are updated via an update to roles table", cxt do
      {loader, rules} = loader_with_global_perms(cxt)
      assert {:ok, consumer} = State.new(loader)

      %{assigns: [_, %{id: assign_id}]} = rules

      tx =
        Chgs.tx([
          Chgs.insert(
            @scoped_assign_relation,
            %{
              "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
              "project_role" => "editor",
              "user_id" => @user_id,
              "project_id" => "123"
            }
          )
        ])

      assert {:ok, _tx, consumer, loader} = State.update(tx, consumer, loader)

      tx =
        Chgs.tx([
          Chgs.update(
            @scoped_assign_relation,
            %{
              "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
              "project_role" => "editor",
              "user_id" => @user_id,
              "project_id" => "123"
            },
            %{
              "project_role" => "manager"
            }
          )
        ])

      assert {:ok, tx, _consumer, loader} = State.update(tx, consumer, loader)

      assert {:ok, _loader, perms} =
               SchemaLoader.user_permissions(loader, @user_id)

      assert %{id: 3, user_id: @user_id, rules: %{id: 2}} = perms

      assert tx.changes == [
               Chgs.update(
                 @scoped_assign_relation,
                 %{
                   "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
                   "project_role" => "editor",
                   "user_id" => @user_id,
                   "project_id" => "123"
                 },
                 %{
                   "project_role" => "manager"
                 }
               ),
               %Changes.UpdatedPermissions{
                 type: :user,
                 permissions: %Changes.UpdatedPermissions.UserPermissions{
                   user_id: @user_id,
                   permissions: perms
                 }
               }
             ]

      assert perms.roles == [
               %SatPerms.Role{
                 row_id: ["db87f03f-89e1-48b4-a5c3-6cdbafb2837d"],
                 assign_id: assign_id,
                 role: "manager",
                 user_id: @user_id,
                 scope: %SatPerms.Scope{table: Proto.table("projects"), id: ["123"]}
               }
             ]
    end

    test "changes in role ownership are managed", cxt do
      {loader, rules} = loader_with_global_perms(cxt)
      assert {:ok, consumer} = State.new(loader)

      %{assigns: [_, %{id: assign_id}]} = rules

      user_id2 = "0c7afad3-213a-4158-9e89-312fc5e682e1"

      tx =
        Chgs.tx([
          Chgs.insert(
            @scoped_assign_relation,
            %{
              "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
              "project_role" => "editor",
              "user_id" => @user_id,
              "project_id" => "123"
            }
          )
        ])

      assert {:ok, _tx, consumer, loader} = State.update(tx, consumer, loader)

      tx =
        Chgs.tx([
          Chgs.update(
            @scoped_assign_relation,
            %{
              "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
              "project_role" => "editor",
              "user_id" => @user_id,
              "project_id" => "123"
            },
            %{
              "user_id" => user_id2
            }
          )
        ])

      assert {:ok, tx, _consumer, loader} = State.update(tx, consumer, loader)

      assert {:ok, loader, perms} =
               SchemaLoader.user_permissions(loader, @user_id)

      assert {:ok, _loader, perms2} =
               SchemaLoader.user_permissions(loader, user_id2)

      assert %{id: 3, user_id: @user_id, rules: %{id: 2}} = perms
      assert %{id: 5, user_id: user_id2, rules: %{id: 2}} = perms2

      assert tx.changes == [
               Chgs.update(
                 @scoped_assign_relation,
                 %{
                   "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
                   "project_role" => "editor",
                   "user_id" => @user_id,
                   "project_id" => "123"
                 },
                 %{
                   "user_id" => user_id2
                 }
               ),
               %Changes.UpdatedPermissions{
                 type: :user,
                 permissions: %Changes.UpdatedPermissions.UserPermissions{
                   user_id: @user_id,
                   permissions: perms
                 }
               },
               %Changes.UpdatedPermissions{
                 type: :user,
                 permissions: %Changes.UpdatedPermissions.UserPermissions{
                   user_id: user_id2,
                   permissions: perms2
                 }
               }
             ]

      assert perms.roles == []

      assert perms2.roles == [
               %SatPerms.Role{
                 row_id: ["db87f03f-89e1-48b4-a5c3-6cdbafb2837d"],
                 assign_id: assign_id,
                 role: "editor",
                 user_id: user_id2,
                 scope: %SatPerms.Scope{table: Proto.table("projects"), id: ["123"]}
               }
             ]
    end

    test "changes in role scope are managed", cxt do
      {loader, rules} = loader_with_global_perms(cxt)
      assert {:ok, consumer} = State.new(loader)

      %{assigns: [_, %{id: assign_id}]} = rules

      tx =
        Chgs.tx([
          Chgs.insert(
            @scoped_assign_relation,
            %{
              "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
              "project_role" => "editor",
              "user_id" => @user_id,
              "project_id" => "123"
            }
          )
        ])

      assert {:ok, _tx, consumer, loader} = State.update(tx, consumer, loader)

      update =
        Chgs.update(
          @scoped_assign_relation,
          %{
            "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
            "project_role" => "editor",
            "user_id" => @user_id,
            "project_id" => "123"
          },
          %{
            "project_id" => "234"
          }
        )

      tx = Chgs.tx([update])

      assert {:ok, tx, _consumer, loader} = State.update(tx, consumer, loader)

      assert {:ok, _loader, perms} =
               SchemaLoader.user_permissions(loader, @user_id)

      assert %{id: 3, user_id: @user_id, rules: %{id: 2}} = perms

      assert tx.changes == [
               update,
               %Changes.UpdatedPermissions{
                 type: :user,
                 permissions: %Changes.UpdatedPermissions.UserPermissions{
                   user_id: @user_id,
                   permissions: perms
                 }
               }
             ]

      assert perms.roles == [
               %SatPerms.Role{
                 row_id: ["db87f03f-89e1-48b4-a5c3-6cdbafb2837d"],
                 assign_id: assign_id,
                 role: "editor",
                 user_id: @user_id,
                 scope: %SatPerms.Scope{table: Proto.table("projects"), id: ["234"]}
               }
             ]
    end

    test "user roles are deleted with deletes to roles table", cxt do
      {loader, rules} = loader_with_global_perms(cxt)
      assert {:ok, consumer} = State.new(loader)

      %{assigns: [_, %{id: assign_id}]} = rules

      tx =
        Chgs.tx([
          Chgs.insert(
            @scoped_assign_relation,
            %{
              "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
              "project_role" => "editor",
              "user_id" => @user_id,
              "project_id" => "123"
            }
          ),
          Chgs.insert(
            @scoped_assign_relation,
            %{
              "id" => "5e41153f-eb42-4b97-8f42-85ca8f40fa1d",
              "project_role" => "viewer",
              "user_id" => @user_id,
              "project_id" => "234"
            }
          )
        ])

      assert {:ok, _tx, consumer, loader} = State.update(tx, consumer, loader)

      tx =
        Chgs.tx([
          Chgs.delete(
            @scoped_assign_relation,
            %{
              "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
              "project_role" => "editor",
              "user_id" => @user_id,
              "project_id" => "123"
            }
          )
        ])

      assert {:ok, tx, _consumer, loader} = State.update(tx, consumer, loader)

      assert {:ok, _loader, perms} =
               SchemaLoader.user_permissions(loader, @user_id)

      assert %{id: 4, user_id: @user_id, rules: %{id: 2}} = perms

      assert tx.changes == [
               Chgs.delete(
                 @scoped_assign_relation,
                 %{
                   "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
                   "project_role" => "editor",
                   "user_id" => @user_id,
                   "project_id" => "123"
                 }
               ),
               %Changes.UpdatedPermissions{
                 type: :user,
                 permissions: %Changes.UpdatedPermissions.UserPermissions{
                   user_id: @user_id,
                   permissions: perms
                 }
               }
             ]

      assert perms.roles == [
               %SatPerms.Role{
                 row_id: ["5e41153f-eb42-4b97-8f42-85ca8f40fa1d"],
                 assign_id: assign_id,
                 role: "viewer",
                 user_id: @user_id,
                 scope: %SatPerms.Scope{table: Proto.table("projects"), id: ["234"]}
               }
             ]
    end

    test "scoped roles are deleted when columns are nulled", cxt do
      {loader, _rules} = loader_with_global_perms(cxt)
      assert {:ok, consumer} = State.new(loader)

      tx =
        Chgs.tx([
          Chgs.insert(
            @scoped_assign_relation,
            %{
              "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
              "project_role" => "editor",
              "user_id" => @user_id,
              "project_id" => "123"
            }
          )
        ])

      assert {:ok, _tx, consumer, loader} = State.update(tx, consumer, loader)

      for column <- ~w(user_id project_id project_role) do
        update =
          Chgs.update(
            @scoped_assign_relation,
            %{
              "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
              "project_role" => "editor",
              "user_id" => @user_id,
              "project_id" => "123"
            },
            %{column => nil}
          )

        tx = Chgs.tx([update])

        assert {:ok, tx, _consumer, loader} = State.update(tx, consumer, loader)

        assert {:ok, _loader, perms} =
                 SchemaLoader.user_permissions(loader, @user_id)

        assert %{id: 3, user_id: @user_id, rules: %{id: 2}} = perms

        assert tx.changes == [
                 update,
                 %Changes.UpdatedPermissions{
                   type: :user,
                   permissions: %Changes.UpdatedPermissions.UserPermissions{
                     user_id: @user_id,
                     permissions: perms
                   }
                 }
               ]

        assert perms.roles == []
      end
    end

    test "unscoped roles are deleted when columns are nulled", cxt do
      {loader, _rules} = loader_with_global_perms(cxt)
      assert {:ok, consumer} = State.new(loader)

      tx =
        Chgs.tx([
          Chgs.insert(
            @unscoped_assign_relation,
            %{
              "id" => "5c0fd272-3fc2-4ae8-8574-92823c814096",
              "site_role" => "site_admin",
              "user_id" => @user_id
            }
          )
        ])

      assert {:ok, _tx, consumer, loader} = State.update(tx, consumer, loader)

      for column <- ~w(user_id site_role) do
        update =
          Chgs.update(
            @unscoped_assign_relation,
            %{
              "id" => "5c0fd272-3fc2-4ae8-8574-92823c814096",
              "site_role" => "site_admin",
              "user_id" => @user_id
            },
            %{column => nil}
          )

        tx = Chgs.tx([update])

        assert {:ok, tx, _consumer, loader} = State.update(tx, consumer, loader)

        assert {:ok, _loader, perms} =
                 SchemaLoader.user_permissions(loader, @user_id)

        assert %{id: 3, user_id: @user_id, rules: %{id: 2}} = perms

        assert tx.changes == [
                 update,
                 %Changes.UpdatedPermissions{
                   type: :user,
                   permissions: %Changes.UpdatedPermissions.UserPermissions{
                     user_id: @user_id,
                     permissions: perms
                   }
                 }
               ]

        assert perms.roles == []
      end
    end

    test "updates with no changes do nothing", cxt do
      {loader, _rules} = loader_with_global_perms(cxt)
      assert {:ok, consumer} = State.new(loader)

      tx =
        Chgs.tx([
          Chgs.insert(
            @unscoped_assign_relation,
            %{
              "id" => "5c0fd272-3fc2-4ae8-8574-92823c814096",
              "site_role" => "site_admin",
              "user_id" => @user_id
            }
          )
        ])

      assert {:ok, _tx, consumer, loader} = State.update(tx, consumer, loader)

      update =
        Chgs.update(
          @unscoped_assign_relation,
          %{
            "id" => "5c0fd272-3fc2-4ae8-8574-92823c814096",
            "site_role" => "site_admin",
            "user_id" => @user_id
          },
          %{}
        )

      tx = Chgs.tx([update])

      assert {:ok, tx, _consumer, loader} = State.update(tx, consumer, loader)

      assert {:ok, _loader, perms} =
               SchemaLoader.user_permissions(loader, @user_id)

      assert %{id: 2, user_id: @user_id, rules: %{id: 2}} = perms

      assert tx.changes == [update]
    end

    test "roles belonging to removed assigns are GC'd", cxt do
      {loader, rules} = loader_with_global_perms(cxt)
      assert {:ok, consumer} = State.new(loader)
      %{assigns: [%{id: _assign_id1}, %{id: assign_id2}]} = rules

      tx =
        Chgs.tx([
          Chgs.insert(
            @unscoped_assign_relation,
            %{
              "id" => "5c0fd272-3fc2-4ae8-8574-92823c814096",
              "site_role" => "site_admin",
              "user_id" => @user_id
            }
          )
        ])

      assert {:ok, _tx, consumer, loader} = State.update(tx, consumer, loader)

      ddlx =
        Command.ddlx(
          unassigns: [
            Proto.unassign(
              table: Proto.table("site_admins"),
              user_column: "user_id",
              role_column: "site_role"
            )
          ]
        )

      tx = Chgs.tx([Chgs.ddlx(ddlx)])

      assert {:ok, _tx, consumer, loader} = State.update(tx, consumer, loader)

      tx =
        Chgs.tx([
          Chgs.insert(
            @scoped_assign_relation,
            %{
              "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
              "project_role" => "editor",
              "user_id" => @user_id,
              "project_id" => "123"
            }
          )
        ])

      assert {:ok, _tx, _consumer, loader} = State.update(tx, consumer, loader)

      assert {:ok, _loader, perms} =
               SchemaLoader.user_permissions(loader, @user_id)

      assert %{id: 4, user_id: @user_id, rules: %{id: 3}} = perms

      assert perms.roles == [
               %SatPerms.Role{
                 row_id: ["db87f03f-89e1-48b4-a5c3-6cdbafb2837d"],
                 assign_id: assign_id2,
                 role: "editor",
                 user_id: @user_id,
                 scope: %SatPerms.Scope{table: Proto.table("projects"), id: ["123"]}
               }
             ]
    end

    test "assign if clauses are honoured", cxt do
      ddlx = [
        grants: [
          Proto.grant(
            privilege: :INSERT,
            table: Proto.table("issues"),
            role: Proto.role("editor"),
            scope: Proto.scope("projects")
          )
        ],
        assigns: [
          Proto.assign(
            table: Proto.table("project_memberships"),
            scope: Proto.scope("projects"),
            user_column: "user_id",
            role_column: "project_role",
            if: "is_enabled"
          ),
          Proto.assign(
            table: Proto.table("site_admins"),
            user_column: "user_id",
            role_column: "site_role",
            if: "NOT is_superuser"
          ),
          Proto.assign(
            table: Proto.table("site_admins"),
            user_column: "user_id",
            role_name: "superuser",
            if: "is_superuser = true"
          )
        ]
      ]

      {loader, rules} = loader_with_global_perms(cxt, ddlx)
      {:ok, consumer} = State.new(loader)

      %{assigns: [%{id: assign_id2}, %{id: _assign_id1}, %{id: assign_id3}]} = rules

      tx =
        Chgs.tx([
          Chgs.insert({"public", "kittens"}, %{"size" => "cute"}),
          Chgs.insert(
            @scoped_assign_relation,
            %{
              "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
              "project_role" => "editor",
              "user_id" => @user_id,
              "project_id" => "123",
              "is_enabled" => false
            }
          )
        ])

      assert {:ok, tx, consumer, loader} = State.update(tx, consumer, loader)

      assert tx.changes == [
               Chgs.insert({"public", "kittens"}, %{"size" => "cute"}),
               Chgs.insert(
                 @scoped_assign_relation,
                 %{
                   "id" => "db87f03f-89e1-48b4-a5c3-6cdbafb2837d",
                   "project_role" => "editor",
                   "user_id" => @user_id,
                   "project_id" => "123",
                   "is_enabled" => false
                 }
               )
             ]

      [insert1, insert2] =
        changes = [
          Chgs.insert(
            @unscoped_assign_relation,
            %{
              "id" => "5c0fd272-3fc2-4ae8-8574-92823c814096",
              "site_role" => "site_admin",
              "user_id" => @user_id,
              "is_superuser" => true
            }
          ),
          Chgs.insert(
            @unscoped_assign_relation,
            %{
              "id" => "5c0fd272-3fc2-4ae8-8574-92823c814096",
              "site_role" => "site_admin",
              "user_id" => @user_id,
              "is_superuser" => false
            }
          )
        ]

      tx = Chgs.tx(changes)

      assert {:ok, tx, _consumer, loader} = State.update(tx, consumer, loader)

      assert {:ok, _loader, perms} =
               SchemaLoader.user_permissions(loader, @user_id)

      assert %{id: 3, user_id: @user_id, rules: %{id: 2}} = perms

      assert [
               ^insert1,
               %Changes.UpdatedPermissions{
                 type: :user,
                 permissions: %Changes.UpdatedPermissions.UserPermissions{
                   user_id: @user_id,
                   permissions: _perms
                 }
               },
               ^insert2,
               %Changes.UpdatedPermissions{
                 type: :user,
                 permissions: %Changes.UpdatedPermissions.UserPermissions{
                   user_id: @user_id,
                   permissions: perms
                 }
               }
             ] = tx.changes

      assert perms.roles == [
               %SatPerms.Role{
                 row_id: ["5c0fd272-3fc2-4ae8-8574-92823c814096"],
                 assign_id: assign_id2,
                 role: "site_admin",
                 user_id: @user_id,
                 scope: nil
               },
               %SatPerms.Role{
                 row_id: ["5c0fd272-3fc2-4ae8-8574-92823c814096"],
                 assign_id: assign_id3,
                 role: "superuser",
                 user_id: @user_id,
                 scope: nil
               }
             ]
    end
  end

  test "sqlite ddlx messages are a no-op", cxt do
    loader = loader(cxt)
    assert {:ok, consumer} = State.new(loader)

    ddlx = Command.ddlx(sqlite: [Proto.sqlite("create table local (id primary key)")])

    tx =
      Chgs.tx([
        Chgs.insert({"public", "kittens"}, %{"size" => "cute"}),
        Chgs.ddlx(ddlx)
      ])

    assert {:ok, tx, _consumer, _loader} = State.update(tx, consumer, loader)

    assert tx.changes == [
             Chgs.insert({"public", "kittens"}, %{"size" => "cute"})
           ]
  end
end
