defmodule Electric.Satellite.Permissions.StructureTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.TestConnection
  alias ElectricTest.PermissionsHelpers.Schema
  alias ElectricTest.PermissionsHelpers.Perms
  alias Electric.Satellite.Permissions.Structure

  setup do
    start_link_supervised!(Perms.Transient)

    :ok
  end

  public = fn name -> {"public", name} end

  @projects public.("projects")
  @accounts public.("accounts")
  @issues public.("issues")
  @comments public.("comments")
  @users public.("users")

  describe "linear" do
    setup do
      migrations = TestConnection.migrations(:linear)

      {:ok, schema_version} = Schema.load(migrations)

      {:ok, perms} =
        Perms.new()
        |> Perms.update(
          schema_version,
          [
            "GRANT READ ON public.accounts TO (public.accounts, 'member')",
            "GRANT READ ON public.projects TO (public.projects, 'member')",
            "GRANT ALL ON public.issues TO (public.projects, 'member') WHERE (row.visible = true)",
            "GRANT ALL ON public.comments TO (public.projects, 'member')",
            "GRANT ALL ON public.users TO (public.users, 'self')",
            "GRANT READ ON public.users TO (public.projects, 'member')",
            # "GRANT READ ON public.users TO AUTHENTICATED",
            "ASSIGN (public.accounts, public.team_memberships.role) TO public.team_memberships.user_id",
            "ASSIGN (public.projects, public.project_memberships.role) TO public.project_memberships.user_id",
            "ASSIGN (public.users, 'self') TO public.users.id"
          ],
          []
        )

      {:ok, schema_version: schema_version, perms: perms, structure: perms.structure}
    end

    test "path to root from table outside perms scope", %{structure: structure} = _cxt do
      assert [{"public", "comments"}, {"public", "issues"}, {"public", "projects"}] =
               Structure.path(structure, @projects, @comments)

      refute Structure.path(structure, @users, @issues)
      refute Structure.path(structure, @users, @accounts)
    end

    test "path to root from table including one-to-many relation", %{structure: structure} do
      assert [
               {"public", "users"},
               {"public", "comments"},
               {"public", "issues"},
               {"public", "projects"}
             ] = Structure.path(structure, @projects, @users)
    end
  end

  describe "entries" do
    setup do
      migrations = TestConnection.migrations(:entries_and_documents)

      {:ok, schema_version} = Schema.load(migrations)

      {:ok, perms} =
        Perms.new()
        |> Perms.update(
          schema_version,
          [
            "GRANT ALL ON public.comments TO (public.users, 'self')",
            "GRANT ALL ON public.authored_entries TO (public.users, 'self')",
            "GRANT SELECT ON public.users TO (public.users, 'self')",
            "GRANT UPDATE ON public.users TO (public.users, 'self')",
            "ASSIGN (public.users, 'self') TO public.users.id"
          ],
          []
        )

      {:ok, schema_version: schema_version, perms: perms, structure: perms.structure}
    end

    test "path to users from tables in scope", %{structure: structure} do
      assert [{"public", "authored_entries"}, {"public", "users"}] =
               Structure.path(structure, @users, {"public", "authored_entries"})

      assert [{"public", "comments"}, {"public", "authored_entries"}, {"public", "users"}] =
               Structure.path(structure, @users, {"public", "comments"})
    end
  end

  describe "scope traversal validation" do
    setup do
      migrations = TestConnection.migrations(:linear)

      {:ok, schema_version} = Schema.load(migrations)

      {:ok, schema_version: schema_version}
    end

    defp perms(cxt, ddlx) do
      Perms.update(Perms.new(), cxt.schema_version, ddlx, [])
    end

    test "returns an error if there is a hole in the scope traversal", cxt do
      assert {:error, _source, _reason} =
               perms(
                 cxt,
                 [
                   "GRANT READ ON public.projects TO (public.projects, 'member')",
                   # so we have a comments table in the projects scope, but no access to the issues table
                   # "GRANT ALL ON public.issues TO (public.projects, 'member') WHERE (row.visible = true)",
                   "GRANT ALL ON public.comments TO (public.projects, 'member')",
                   "GRANT ALL ON public.users TO (public.users, 'self')"
                 ]
               )

      assert {:ok, _perms} =
               perms(
                 cxt,
                 [
                   "GRANT READ ON public.projects TO (public.projects, 'member')",
                   # add missing issues grant
                   "GRANT ALL ON public.issues TO (public.projects, 'member') WHERE (row.visible = true)",
                   "GRANT ALL ON public.comments TO (public.projects, 'member')",
                   "GRANT ALL ON public.users TO (public.users, 'self')"
                 ]
               )
    end
  end
end
