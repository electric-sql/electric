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

  alias Electric.Replication.PublicationManager

  @shape_handle "pub_mgr_db_test_shape_handle"

  def clean_all_shapes_for_relations(relations, [parent_pid]) do
    send(parent_pid, {:clean_all_shapes_for_relations, relations})
  end

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

    relation = {"public", "items"}
    relation_oid = lookup_relation_oid(ctx.pool, relation)

    %{pub_mgr_opts: pub_mgr_opts, relation: relation, relation_with_oid: {relation_oid, relation}}
  end

  describe "add_shape()" do
    test "adds the table to the publication when a shape is created for it", ctx do
      shape = generate_shape(ctx.relation_with_oid)
      assert :ok == PublicationManager.add_shape(@shape_handle, shape, ctx.pub_mgr_opts)
      assert [ctx.relation] == fetch_pub_tables(ctx)
    end
  end

  describe "refresh_publication()" do
    setup ctx do
      shape = generate_shape(ctx.relation_with_oid)
      :ok = PublicationManager.add_shape(@shape_handle, shape, ctx.pub_mgr_opts)
    end

    test "updates the publication if a published table is dropped", ctx do
      Postgrex.query!(ctx.pool, "DROP TABLE items")

      assert :ok == PublicationManager.refresh_publication(ctx.pub_mgr_opts ++ [forced?: true])
      assert [] == fetch_pub_tables(ctx)

      assert_receive {:clean_all_shapes_for_relations, [{_oid, {"public", "items"}}]}
    end

    test "updates the publication if a published table is renamed", ctx do
      Postgrex.query!(ctx.pool, "ALTER TABLE items RENAME TO items_no_more")

      assert :ok == PublicationManager.refresh_publication(ctx.pub_mgr_opts ++ [forced?: true])
      assert [] == fetch_pub_tables(ctx)

      assert_receive {:clean_all_shapes_for_relations, [{_oid, {"public", "items"}}]}
    end
  end

  defp fetch_pub_tables(ctx), do: fetch_publication_tables(ctx.pool, ctx.publication_name)
end
