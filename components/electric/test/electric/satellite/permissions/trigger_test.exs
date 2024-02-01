defmodule Electric.Satellite.Permissions.TriggerTest do
  use ExUnit.Case, async: true

  alias Electric.Satellite.Permissions
  alias Electric.Satellite.Permissions.Trigger

  alias ElectricTest.PermissionsHelpers.{
    Auth,
    Chgs,
    Perms,
    Tree
  }

  import ElectricTest.PermissionsHelpers

  @workspaces {"public", "workspaces"}
  @projects {"public", "projects"}
  @issues {"public", "issues"}
  @comments {"public", "comments"}
  @reactions {"public", "reactions"}
  @project_memberships {"public", "project_memberships"}

  setup do
    tree =
      Tree.new(
        [
          {@workspaces, "w1",
           [
             {@projects, "p1", []},
             {@projects, "p2", []},
             {@projects, "p3", []}
           ]}
        ],
        [
          {@comments, @issues, ["issue_id"]},
          {@issues, @projects, ["project_id"]},
          {@project_memberships, @projects, ["project_id"]},
          {@projects, @workspaces, ["workspace_id"]},
          {@reactions, @comments, ["comment_id"]}
        ]
        # [
        #   {@workspaces, nil,
        #    [
        #      {@projects, "workspace_id",
        #       [
        #         {@project_memberships, "project_id", []},
        #         {@issues, "project_id",
        #          [{@comments, "issue_id", [{@reactions, "comment_id", []}]}]}
        #       ]}
        #    ]}
        # ]
      )

    {:ok, _} = start_supervised(Perms.Transient)

    {:ok, tree: tree}
  end

  def assign(ddlx) do
    %{assigns: [assign | _]} = Perms.to_rules(ddlx)

    assign
  end

  describe "for_assign/1" do
    test "generates a function that turns inserts into transient roles", cxt do
      assign =
        assign(
          "assign (projects, #{table(@project_memberships)}.role) to #{table(@project_memberships)}.user_id"
        )

      assert [{@project_memberships, fun}] = Trigger.for_assign(assign)
      assert is_function(fun, 3)

      %{user_id: user_id} = auth = Auth.user()

      change =
        Chgs.insert(@project_memberships, %{
          "id" => "pm1",
          "project_id" => "p1",
          "user_id" => user_id,
          "role" => "admin"
        })

      assert [{:insert, {@project_memberships, ["pm1"]}, role}] = fun.(change, cxt.tree, auth)

      assert %Permissions.Role{
               id: ["pm1"],
               role: "admin",
               user_id: ^user_id,
               scope: {@projects, ["p1"]}
             } = role

      assert [] = fun.(change, cxt.tree, Auth.user("1191723b-37a5-46c8-818e-326cfbc2c0a7"))
      assert [] = fun.(change, cxt.tree, Auth.nobody())
    end

    test "supports static role names", cxt do
      assign =
        assign("assign (projects, 'something') to #{table(@project_memberships)}.user_id")

      assert [{@project_memberships, fun}] = Trigger.for_assign(assign)
      assert is_function(fun, 3)

      %{user_id: user_id} = auth = Auth.user()

      change =
        Chgs.insert(@project_memberships, %{
          "id" => "pm1",
          "project_id" => "p1",
          "user_id" => user_id
        })

      assert [{:insert, {@project_memberships, ["pm1"]}, role}] = fun.(change, cxt.tree, auth)

      assert %Permissions.Role{
               id: ["pm1"],
               role: "something",
               user_id: ^user_id,
               scope: {@projects, ["p1"]}
             } = role
    end

    test "global role assignments, dynamic roles", cxt do
      assign =
        assign(
          "assign #{table(@project_memberships)}.role to #{table(@project_memberships)}.user_id"
        )

      assert [{@project_memberships, fun}] = Trigger.for_assign(assign)
      assert is_function(fun, 3)

      %{user_id: user_id} = auth = Auth.user()

      change =
        Chgs.insert(@project_memberships, %{
          "id" => "pm1",
          "project_id" => "p1",
          "user_id" => user_id,
          "role" => "admin"
        })

      assert [{:insert, {@project_memberships, ["pm1"]}, role}] = fun.(change, cxt.tree, auth)

      assert %Permissions.Role{
               id: ["pm1"],
               role: "admin",
               user_id: ^user_id,
               scope: nil
             } = role
    end

    test "global role assignments, static roles", cxt do
      assign =
        assign("assign 'something' to #{table(@project_memberships)}.user_id")

      assert [{@project_memberships, fun}] = Trigger.for_assign(assign)
      assert is_function(fun, 3)

      %{user_id: user_id} = auth = Auth.user()

      change =
        Chgs.insert(@project_memberships, %{
          "id" => "pm1",
          "project_id" => "p1",
          "user_id" => user_id
        })

      assert [{:insert, {@project_memberships, ["pm1"]}, role}] = fun.(change, cxt.tree, auth)

      assert %Permissions.Role{
               id: ["pm1"],
               role: "something",
               user_id: ^user_id,
               scope: nil
             } = role
    end
  end
end
