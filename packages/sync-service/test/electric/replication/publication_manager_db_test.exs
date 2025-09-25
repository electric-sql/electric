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

  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.PublicationManager

  @shape_handle_1 "pub_mgr_db_test_shape_handle_1"
  @shape_handle_2 "pub_mgr_db_test_shape_handle_2"
  @where_clause_1 %Expr{query: "id = '1'", used_refs: %{["id"] => :text}}
  @where_clause_2 %Expr{query: "id = '2'", used_refs: %{["id"] => :text}}

  setup [
    :with_stack_id_from_test,
    :with_unique_db,
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

    Repatch.allow(test_pid, pub_mgr_opts[:server])

    relation = {"public", "items"}
    relation_oid = lookup_relation_oid(ctx.pool, relation)

    %{pub_mgr_opts: pub_mgr_opts, relation: relation, relation_with_oid: {relation_oid, relation}}
  end

  describe "add_shape()" do
    test "adds the table to the publication when a shape is created for it", ctx do
      shape = generate_shape(ctx.relation_with_oid)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, ctx.pub_mgr_opts)
      assert [ctx.relation] == fetch_pub_tables(ctx)
    end

    test "keeps the table in the publication when shapes with different where clauses are added and removed",
         ctx do
      shape_1 = generate_shape(ctx.relation_with_oid, @where_clause_1)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape_1, ctx.pub_mgr_opts)
      assert [ctx.relation] == fetch_pub_tables(ctx)

      shape_2 = generate_shape(ctx.relation_with_oid, @where_clause_2)
      assert :ok == PublicationManager.add_shape(@shape_handle_2, shape_2, ctx.pub_mgr_opts)
      assert [ctx.relation] == fetch_pub_tables(ctx)

      assert :ok == PublicationManager.remove_shape(@shape_handle_2, ctx.pub_mgr_opts)
      assert [ctx.relation] == fetch_pub_tables(ctx)

      assert :ok == PublicationManager.remove_shape(@shape_handle_1, ctx.pub_mgr_opts)
      assert [] == fetch_pub_tables(ctx)
    end
  end

  defp fetch_pub_tables(ctx), do: fetch_publication_tables(ctx.pool, ctx.publication_name)
end
