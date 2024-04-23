defmodule Electric.Postgres.Extension.SchemaLoader.EpgsqlTest do
  use Electric.Extension.Case, async: false

  alias Electric.DDLX.Command
  alias Electric.Postgres.Extension
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Satellite.Permissions.State
  alias Electric.Satellite.SatPerms
  alias ElectricTest.PermissionsHelpers.Proto

  def epgsql_loader(conn) do
    {:ok, loader} = SchemaLoader.connect({SchemaLoader.Epgsql, []}, __connection__: conn)
    loader
  end

  def epgsql_loader_with_rules(conn) do
    loader = epgsql_loader(conn)

    rules =
      %SatPerms.Rules{
        id: 2,
        parent_id: 1,
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
      }

    assert {:ok, _loader} = SchemaLoader.save_global_permissions(loader, rules)

    {loader, rules}
  end

  test_tx "global_permissions/1", fn conn ->
    loader = epgsql_loader(conn)
    assert {:ok, %SatPerms.Rules{id: 1} = _rules} = SchemaLoader.global_permissions(loader)
  end

  test_tx "global_permissions/2", fn conn ->
    loader = epgsql_loader(conn)
    assert {:ok, %SatPerms.Rules{id: 1} = _rules} = SchemaLoader.global_permissions(loader, 1)
  end

  test_tx "save_global_permissions/2", fn conn ->
    loader = epgsql_loader(conn)

    rules =
      %SatPerms.Rules{
        id: 2,
        parent_id: 1,
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
      }

    assert {:ok, _loader} = SchemaLoader.save_global_permissions(loader, rules)
    assert {:ok, %SatPerms.Rules{id: 2} = ^rules} = SchemaLoader.global_permissions(loader)
  end

  test_tx "user_permissions/2", fn conn ->
    {loader, _rules} = epgsql_loader_with_rules(conn)

    assert {:ok, _loader,
            %SatPerms{
              id: 1,
              user_id: "e815dfe6-f64d-472a-a322-bfc9e7993d27",
              roles: [],
              rules: %SatPerms.Rules{id: 2}
            }} =
             SchemaLoader.user_permissions(loader, "e815dfe6-f64d-472a-a322-bfc9e7993d27")

    assert {:ok, _loader,
            %SatPerms{
              id: 2,
              user_id: "11f03d43-09e9-483b-9e8c-1f0e117f20fe",
              roles: [],
              rules: %SatPerms.Rules{id: 2}
            }} =
             SchemaLoader.user_permissions(loader, "11f03d43-09e9-483b-9e8c-1f0e117f20fe")
  end

  test_tx "user_permissions/3", fn conn ->
    {loader, _rules} = epgsql_loader_with_rules(conn)

    assert {:ok, _loader, %SatPerms{id: 1}} =
             SchemaLoader.user_permissions(loader, "e815dfe6-f64d-472a-a322-bfc9e7993d27")

    assert {:ok, %SatPerms{id: 1}} =
             SchemaLoader.user_permissions(loader, "e815dfe6-f64d-472a-a322-bfc9e7993d27", 1)
  end

  test_tx "save_user_permissions/3", fn conn ->
    {loader, _rules} = epgsql_loader_with_rules(conn)

    assert {:ok, _loader, %SatPerms{id: 1, rules: %{id: rules_id}}} =
             SchemaLoader.user_permissions(loader, "e815dfe6-f64d-472a-a322-bfc9e7993d27")

    assert {:ok, _loader, %SatPerms{id: 2, roles: [_]}} =
             SchemaLoader.save_user_permissions(
               loader,
               "e815dfe6-f64d-472a-a322-bfc9e7993d27",
               %SatPerms.Roles{
                 parent_id: 1,
                 rules_id: rules_id,
                 roles: [
                   %SatPerms.Role{
                     user_id: "e815dfe6-f64d-472a-a322-bfc9e7993d27",
                     role: "editor"
                   }
                 ]
               }
             )

    assert {:ok, _loader, %SatPerms{id: 2, roles: [_]}} =
             SchemaLoader.user_permissions(loader, "e815dfe6-f64d-472a-a322-bfc9e7993d27")
  end

  test_tx "save_global_permissions/2 migrates existing user roles", fn conn ->
    {loader, rules} = epgsql_loader_with_rules(conn)

    assert {:ok, _loader,
            %SatPerms{
              id: 1,
              user_id: "e815dfe6-f64d-472a-a322-bfc9e7993d27",
              roles: [],
              rules: %SatPerms.Rules{id: 2}
            }} =
             SchemaLoader.user_permissions(loader, "e815dfe6-f64d-472a-a322-bfc9e7993d27")

    assert {:ok, _loader,
            %SatPerms{
              id: 2,
              user_id: "11f03d43-09e9-483b-9e8c-1f0e117f20fe",
              roles: [],
              rules: %SatPerms.Rules{id: 2}
            }} =
             SchemaLoader.user_permissions(loader, "11f03d43-09e9-483b-9e8c-1f0e117f20fe")

    assert {:ok, _loader, %SatPerms{id: 3, roles: [_]}} =
             SchemaLoader.save_user_permissions(
               loader,
               "e815dfe6-f64d-472a-a322-bfc9e7993d27",
               %SatPerms.Roles{
                 parent_id: 1,
                 rules_id: 2,
                 roles: [
                   %SatPerms.Role{
                     user_id: "e815dfe6-f64d-472a-a322-bfc9e7993d27",
                     role: "editor"
                   }
                 ]
               }
             )

    ddlx =
      Command.ddlx(
        grants: [
          Proto.grant(
            privilege: :INSERT,
            table: Proto.table("comments"),
            role: Proto.role("editor"),
            scope: Proto.scope("projects")
          )
        ]
      )

    rules = State.apply_ddlx(rules, ddlx)

    assert {:ok, _loader} = SchemaLoader.save_global_permissions(loader, rules)

    assert {:ok, _loader,
            %SatPerms{
              id: 5,
              user_id: "e815dfe6-f64d-472a-a322-bfc9e7993d27",
              rules: ^rules
            }} =
             SchemaLoader.user_permissions(loader, "e815dfe6-f64d-472a-a322-bfc9e7993d27")

    assert {:ok, _loader,
            %SatPerms{
              id: 4,
              user_id: "11f03d43-09e9-483b-9e8c-1f0e117f20fe",
              rules: ^rules
            }} =
             SchemaLoader.user_permissions(loader, "11f03d43-09e9-483b-9e8c-1f0e117f20fe")

    ddlx =
      Command.ddlx(
        grants: [
          Proto.grant(
            privilege: :DELETE,
            table: Proto.table("comments"),
            role: Proto.role("editor"),
            scope: Proto.scope("projects")
          )
        ]
      )

    rules = State.apply_ddlx(rules, ddlx)

    assert {:ok, _loader} = SchemaLoader.save_global_permissions(loader, rules)

    assert {:ok, _loader,
            %SatPerms{
              id: 7,
              user_id: "e815dfe6-f64d-472a-a322-bfc9e7993d27",
              rules: ^rules
            }} =
             SchemaLoader.user_permissions(loader, "e815dfe6-f64d-472a-a322-bfc9e7993d27")

    assert {:ok, _loader,
            %SatPerms{
              id: 6,
              user_id: "11f03d43-09e9-483b-9e8c-1f0e117f20fe",
              rules: ^rules
            }} =
             SchemaLoader.user_permissions(loader, "11f03d43-09e9-483b-9e8c-1f0e117f20fe")

    {:ok, _, rows} =
      :epgsql.equery(
        conn,
        "select count(id) as n from #{Extension.user_perms_table()} where global_perms_id = $1 group by (user_id)",
        [rules.id]
      )

    # two users
    assert length(rows) == 2

    # there should only be one user permissions state for each user for each global rules state
    for {n} <- rows do
      assert n == 1
    end
  end
end
