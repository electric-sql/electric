defmodule Electric.Satellite.Permissions.TransientTest do
  use ExUnit.Case, async: true

  alias Electric.Satellite.Permissions.{Role, RoleGrant, Transient}

  alias ElectricTest.PermissionsHelpers.{
    LSN,
    Perms,
    Roles
  }

  @projects {"public", "projects"}
  @issues {"public", "issues"}

  setup do
    name = __MODULE__.Transient
    {:ok, _pid} = start_supervised({Transient, name: name})
    {:ok, name: name}
  end

  describe "for_roles/2" do
    test "returns correct transient permissions for a role", cxt do
      valid_perms = [
        Perms.transient(
          assign_id: "assign-01",
          target_relation: @issues,
          target_id: "i3",
          scope_id: "p1",
          valid_to: LSN.new(100)
        ),
        Perms.transient(
          assign_id: "assign-01",
          target_relation: @issues,
          target_id: "i4",
          scope_id: "p2",
          valid_to: LSN.new(100)
        ),
        Perms.transient(
          assign_id: "assign-02",
          target_relation: @issues,
          target_id: "i3",
          scope_id: "p1",
          valid_to: LSN.new(100)
        )
      ]

      invalid_perms = [
        Perms.transient(
          assign_id: "assign-99",
          target_relation: @issues,
          target_id: "i3",
          scope_id: "p1",
          valid_to: LSN.new(100)
        ),
        Perms.transient(
          assign_id: "assign-01",
          target_relation: @issues,
          target_id: "i6",
          scope_id: "p9",
          valid_to: LSN.new(100)
        )
      ]

      :ok = Transient.update(valid_perms ++ invalid_perms, cxt.name)

      role_grants =
        [
          Roles.role("editor", @projects, "p1", assign_id: "assign-01"),
          Roles.role("editor", @projects, "p2", assign_id: "assign-01"),
          Roles.role("editor", @projects, "p3", assign_id: "assign-01"),
          Roles.role("reader", @projects, "p1", assign_id: "assign-02"),
          Roles.role("reader", @projects, "p2", assign_id: "assign-02"),
          Roles.role("reader", @projects, "p3", assign_id: "assign-02")
        ]
        |> Enum.map(&%RoleGrant{role: Role.new(&1)})

      lsn = LSN.new(100)

      perms = Transient.for_roles(role_grants, lsn, cxt.name)

      for {{role_grant, perm}, expected_perm} <- Enum.zip(perms, valid_perms) do
        assert perm == expected_perm
        assert match?(%RoleGrant{}, role_grant)
      end
    end

    test "excludes expired perms", cxt do
      valid_perms = [
        Perms.transient(
          assign_id: "assign-01",
          target_relation: @issues,
          target_id: "i3",
          scope_id: "p1",
          valid_to: LSN.new(101)
        )
      ]

      invalid_perms = [
        Perms.transient(
          assign_id: "assign-01",
          target_relation: @issues,
          target_id: "i4",
          scope_id: "p2",
          valid_to: LSN.new(99)
        ),
        Perms.transient(
          assign_id: "assign-02",
          target_relation: @issues,
          target_id: "i3",
          scope_id: "p1",
          valid_to: LSN.new(99)
        )
      ]

      :ok = Transient.update(valid_perms ++ invalid_perms, cxt.name)

      role_grants =
        [
          Roles.role("editor", @projects, "p1", assign_id: "assign-01"),
          Roles.role("editor", @projects, "p2", assign_id: "assign-01"),
          Roles.role("editor", @projects, "p3", assign_id: "assign-01"),
          Roles.role("reader", @projects, "p1", assign_id: "assign-02"),
          Roles.role("reader", @projects, "p2", assign_id: "assign-02"),
          Roles.role("reader", @projects, "p3", assign_id: "assign-02")
        ]
        |> Enum.map(&%RoleGrant{role: Role.new(&1)})

      lsn = LSN.new(100)

      perms = Transient.for_roles(role_grants, lsn, cxt.name)

      for {{role_grant, perm}, expected_perm} <- Enum.zip(perms, valid_perms) do
        assert perm == expected_perm
        assert match?(%RoleGrant{}, role_grant)
      end
    end
  end
end
