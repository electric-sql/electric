defmodule Electric.Satellite.Permissions.MultipleScopesTest do
  use ExUnit.Case, async: true

  alias ElectricTest.PermissionsHelpers.{
    Auth,
    Schema,
    Tree
  }

  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Satellite.Permissions.Graph
  alias Electric.Satellite.Permissions.Structure

  import ElectricTest.PermissionsHelpers

  @comments {"public", "comments"}
  @users {"public", "users"}
  @entries {"public", "entries"}

  @user_id Auth.user_id()

  describe "user scopes test" do
    setup do
      migrations = [
        {"01",
         [
           "create table users (id uuid primary key)",
           """
           create table entries (
             id uuid primary key,
             user_id uuid not null references users (id)
           )
           """,
           # comments table points to users via entries and via author_id
           """
           create table comments (
             id uuid primary key,
             entry_id uuid not null references entries (id),
             author_id uuid not null references users (id)
           )
           """
         ]}
      ]

      data = [
        {@users, Auth.user_id(),
         [
           {@entries, "e1",
            [
              {@comments, "c1", %{"author_id" => Auth.user_id()}, []},
              {@comments, "c2", %{"author_id" => Auth.not_user_id()}, []}
            ]}
         ]},
        {@users, Auth.not_user_id(),
         [
           {@entries, "e2",
            [
              {@comments, "c3", %{"author_id" => Auth.user_id()}, []},
              {@comments, "c4", %{"author_id" => Auth.not_user_id()}, []}
            ]}
         ]}
      ]

      {:ok, loader} = Schema.loader(migrations)
      {:ok, schema_version} = SchemaLoader.load(loader)

      tree = Tree.new(data, schema_version)

      perms =
        perms_build(
          schema_version,
          [
            ~s[GRANT READ ON comments TO (users, 'self')],
            ~s[GRANT READ ON entries TO (users, 'self')],
            ~s[GRANT READ ON users TO (users, 'self')],
            ~s[ASSIGN (users, 'self') TO users.id]
          ],
          []
        )

      {:ok,
       tree: tree,
       data: data,
       loader: loader,
       schema_version: schema_version,
       user_id: Auth.user_id(),
       not_user_id: Auth.not_user_id(),
       perms: perms}
    end

    test "scope_id returns the correct scope", cxt do
      # every comment has two user scopes, the one directly from its author_id
      # and the one through the entries table
      # the one through the entries table is the right one
      assert [{[@user_id], _}] =
               Graph.scope_id(cxt.tree, cxt.perms.structure, @users, @comments, ["c2"])

      assert [{[@user_id], _}] =
               Graph.scope_id(cxt.tree, cxt.perms.structure, @users, @comments, ["c1"])
    end

    test "parent returns all possible parents", cxt do
      assert [{@entries, ["e1"]}] =
               Structure.parent(cxt.perms.structure, @users, @comments, %{
                 "entry_id" => "e1",
                 "author_id" => Auth.user_id()
               })
    end
  end
end
