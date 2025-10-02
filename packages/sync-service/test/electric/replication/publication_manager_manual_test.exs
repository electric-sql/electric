defmodule Electric.Replication.PublicationManagerManualTest do
  # This module tests the publication manager running in manual publishing mode against a real database.
  #
  # Specifically, we verify that the state of the publication in Postgres is validated when a
  # published table is dropped or renamed in the database, and that the corresponding shapes
  # are cleaned up.

  use ExUnit.Case, async: true
  use Repatch.ExUnit

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Support.TestUtils

  alias Electric.Replication.PublicationManager

  @shape_handle "pub_mgr_manual_test_shape_handle"

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
        pool: ctx.pool,
        manual_table_publishing?: true
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

  describe "add_shape" do
    test "raises if the new shape's table is not in the publication", ctx do
      shape = generate_shape(ctx.relation_with_oid)

      assert_raise Electric.DbConfigurationError,
                   "Database table \"public.items\" is missing from the publication \"#{ctx.publication_name}\" and " <>
                     "the ELECTRIC_MANUAL_TABLE_PUBLISHING setting prevents Electric from adding it",
                   fn ->
                     PublicationManager.add_shape(@shape_handle, shape, ctx.pub_mgr_opts)
                   end

      assert_receive {:remove_shapes_for_relations, [{_oid, {"public", "items"}}]}
    end

    test "raises if the table's replica identity is not full", ctx do
      Postgrex.query!(ctx.pool, "ALTER PUBLICATION #{ctx.publication_name} ADD TABLE items")

      shape = generate_shape(ctx.relation_with_oid)

      assert_raise Electric.DbConfigurationError,
                   "Database table \"public.items\" does not have its replica identity set to FULL",
                   fn ->
                     PublicationManager.add_shape(@shape_handle, shape, ctx.pub_mgr_opts)
                   end

      assert_receive {:remove_shapes_for_relations, [{_oid, {"public", "items"}}]}
    end
  end
end
