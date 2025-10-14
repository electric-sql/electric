defmodule Electric.Replication.PublicationManagerDbTest do
  # This module tests the publication manager against a real database.
  #
  # Specifically, we verify that the publication in Postgres is updated correctly when a table
  # that's part of it is dropped or renamed in the database, and that the corresponding shapes
  # are cleaned up.

  use ExUnit.Case, async: true

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Support.TestUtils

  require Repatch
  alias Electric.Utils
  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.PublicationManager

  @shape_handle_1 "pub_mgr_db_test_shape_handle_1"
  @shape_handle_2 "pub_mgr_db_test_shape_handle_2"
  @where_clause_1 %Expr{query: "id = '1'", used_refs: %{["id"] => :text}}
  @where_clause_2 %Expr{query: "id = '2'", used_refs: %{["id"] => :text}}

  setup [
    :with_stack_id_from_test,
    :with_in_memory_storage,
    :with_shape_status,
    :with_unique_db,
    :with_sql_execute,
    :with_publication_name,
    :with_publication,
    :with_basic_tables
  ]

  setup ctx do
    %{publication_manager: {_, pub_mgr_opts}} =
      with_publication_manager(%{
        module: ctx.module,
        test: ctx.test,
        stack_id: ctx.stack_id,
        shape_cache: {__MODULE__, [self()]},
        publication_name: ctx.publication_name,
        pool: ctx.pool
      })

    test_pid = self()

    Repatch.patch(
      Electric.ShapeCache.ShapeCleaner,
      :remove_shapes_for_relations,
      [mode: :shared],
      fn relations, _ ->
        send(test_pid, {:remove_shapes_for_relations, relations})
      end
    )

    # notify when publication is configured to avoid timing issues
    config_notification =
      Repatch.notify(Electric.Postgres.Configuration, :configure_publication!, 3, mode: :shared)

    Repatch.allow(test_pid, pub_mgr_opts[:server])

    relation = {"public", "items"}
    relation_oid = lookup_relation_oid(ctx.pool, relation)

    %{
      pub_mgr_opts: pub_mgr_opts,
      relation: relation,
      relation_with_oid: {relation_oid, relation},
      config_notification: config_notification
    }
  end

  describe "add_shape/3" do
    test "adds the table to the publication when a shape is created for it", ctx do
      shape = generate_shape(ctx.relation_with_oid)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, ctx.pub_mgr_opts)
      assert [ctx.relation] == fetch_pub_tables(ctx)
    end

    test "keeps the table in the publication when shapes with different where clauses are added and removed",
         %{config_notification: config_notification} = ctx do
      shape_1 = generate_shape(ctx.relation_with_oid, @where_clause_1)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape_1, ctx.pub_mgr_opts)
      assert_receive ^config_notification
      assert [ctx.relation] == fetch_pub_tables(ctx)

      shape_2 = generate_shape(ctx.relation_with_oid, @where_clause_2)
      assert :ok == PublicationManager.add_shape(@shape_handle_2, shape_2, ctx.pub_mgr_opts)
      refute_receive ^config_notification
      assert [ctx.relation] == fetch_pub_tables(ctx)

      assert :ok == PublicationManager.remove_shape(@shape_handle_2, ctx.pub_mgr_opts)
      refute_receive ^config_notification
      assert [ctx.relation] == fetch_pub_tables(ctx)

      assert :ok == PublicationManager.remove_shape(@shape_handle_1, ctx.pub_mgr_opts)
      assert_receive ^config_notification
      assert [] == fetch_pub_tables(ctx)
    end
  end

  describe "publication misonfiguration" do
    test "handles publication being deleted during operation", ctx do
      Postgrex.query!(ctx.pool, "DROP PUBLICATION #{ctx.publication_name};", [])

      shape_1 = generate_shape(ctx.relation_with_oid, @where_clause_1)

      assert_raise Electric.DbConfigurationError,
                   "Publication #{Utils.quote_name(ctx.publication_name)} not found in the database",
                   fn ->
                     PublicationManager.add_shape(@shape_handle_1, shape_1, ctx.pub_mgr_opts)
                   end

      refute_receive {:remove_shapes_for_relations, _}
      assert [] == fetch_pub_tables(ctx)
    end

    test "handles publication not publishing all operations", ctx do
      Postgrex.query!(
        ctx.pool,
        "ALTER PUBLICATION #{ctx.publication_name} SET (publish = 'insert, update');",
        []
      )

      shape_1 = generate_shape(ctx.relation_with_oid, @where_clause_1)

      assert_raise Electric.DbConfigurationError,
                   "Publication #{Utils.quote_name(ctx.publication_name)} does not " <>
                     "publish all required operations: INSERT, UPDATE, DELETE, TRUNCATE",
                   fn ->
                     PublicationManager.add_shape(@shape_handle_1, shape_1, ctx.pub_mgr_opts)
                   end

      refute_receive {:remove_shapes_for_relations, _}
      assert [] == fetch_pub_tables(ctx)
    end

    test "handles publication not being owned", ctx do
      patch_queries_to_unprivileged()

      relation_with_oid = ctx.relation_with_oid
      shape_1 = generate_shape(relation_with_oid, @where_clause_1)

      assert_raise Electric.DbConfigurationError,
                   "Database table #{Utils.relation_to_sql(ctx.relation) |> Utils.quote_name()} is missing from " <>
                     "the publication #{Utils.quote_name(ctx.publication_name)} and " <>
                     "Electric lacks privileges to add it",
                   fn ->
                     PublicationManager.add_shape(@shape_handle_1, shape_1, ctx.pub_mgr_opts)
                   end

      assert_receive {:remove_shapes_for_relations, [^relation_with_oid]}
      assert [] == fetch_pub_tables(ctx)
    end
  end

  describe "insufficient table privilege" do
    setup ctx do
      relation_not_owned = {"public", "not_owned"}

      Postgrex.query!(ctx.pool, "CREATE TABLE not_owned (id SERIAL PRIMARY KEY);")
      Postgrex.query!(ctx.pool, "ALTER TABLE items OWNER TO unprivileged;")

      Postgrex.query!(
        ctx.pool,
        "ALTER PUBLICATION #{ctx.publication_name} OWNER TO unprivileged;"
      )

      patch_queries_to_unprivileged()

      %{
        relation_not_owned: relation_not_owned,
        relation_not_owned_with_oid:
          {lookup_relation_oid(ctx.pool, relation_not_owned), relation_not_owned}
      }
    end

    test "returns appropriate error when relation not owned", ctx do
      relation_not_owned_with_oid = ctx.relation_not_owned_with_oid
      shape_1 = generate_shape(relation_not_owned_with_oid, @where_clause_1)

      assert_raise Postgrex.Error, ~r/insufficient_privilege/, fn ->
        PublicationManager.add_shape(@shape_handle_1, shape_1, ctx.pub_mgr_opts)
      end

      assert_receive {:remove_shapes_for_relations, [^relation_not_owned_with_oid]}
      assert [] == fetch_pub_tables(ctx)
    end

    @tag update_debounce_timeout: 10
    test "should only fail relevant tables with insufficient privilege errors", ctx do
      %{relation_not_owned_with_oid: relation_not_owned_with_oid} = ctx
      shape_1 = generate_shape(relation_not_owned_with_oid, @where_clause_1)
      shape_2 = generate_shape(ctx.relation_with_oid, @where_clause_1)

      task =
        Task.async(fn ->
          assert_raise Postgrex.Error, ~r/insufficient_privilege/, fn ->
            PublicationManager.add_shape(@shape_handle_1, shape_1, ctx.pub_mgr_opts)
          end
        end)

      # this should succeed, even if the other one fails
      assert :ok = PublicationManager.add_shape(@shape_handle_2, shape_2, ctx.pub_mgr_opts)

      Task.await(task)

      assert_receive {:remove_shapes_for_relations, [^relation_not_owned_with_oid]}
      assert [ctx.relation] == fetch_pub_tables(ctx)
    end
  end

  defp fetch_pub_tables(ctx), do: fetch_publication_tables(ctx.pool, ctx.publication_name)

  defp patch_queries_to_unprivileged() do
    Repatch.patch(Postgrex, :query!, [mode: :shared], fn conn, sql, params ->
      DBConnection.run(conn, fn conn ->
        Repatch.real(Postgrex.query(conn, "SET ROLE unprivileged", []))
        Repatch.real(Postgrex.query!(conn, sql, params))
      end)
    end)

    Repatch.patch(Postgrex, :query, [mode: :shared], fn conn, sql, params ->
      DBConnection.run(conn, fn conn ->
        Repatch.real(Postgrex.query(conn, "SET ROLE unprivileged", []))
        Repatch.real(Postgrex.query(conn, sql, params))
      end)
    end)
  end
end
