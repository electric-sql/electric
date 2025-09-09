defmodule Electric.Replication.PublicationManagerTest do
  use ExUnit.Case, async: true

  import Support.ComponentSetup
  import Support.TestUtils

  alias Electric.Replication.PublicationManager.RelationFilter
  alias Electric.Replication.PublicationManager

  @shape_handle_1 "shape_handle_1"
  @shape_handle_2 "shape_handle_2"
  @shape_handle_3 "shape_handle_3"

  def clean_all_shapes_for_relations(relations, [parent_pid]) do
    send(parent_pid, {:clean_all_shapes_for_relations, relations})
  end

  setup :with_stack_id_from_test

  setup ctx do
    test_pid = self()

    configure_tables_fn = fn _, _, filters, _ ->
      # Only relations are relevant now
      send(test_pid, {:filters, Map.values(filters)})
      Map.get(ctx, :returned_relations, [])
    end

    %{publication_manager: {_, publication_manager_opts}} =
      with_publication_manager(%{
        module: ctx.module,
        test: ctx.test,
        stack_id: ctx.stack_id,
        update_debounce_timeout: Access.get(ctx, :update_debounce_timeout, 0),
        shape_cache: {__MODULE__, [self()]},
        publication_name: "pub_#{ctx.stack_id}",
        pool: :no_pool,
        configure_tables_for_replication_fn: configure_tables_fn
      })

    %{opts: publication_manager_opts, ctx: ctx}
  end

  describe "add_shape/2" do
    test "adds a single relation", %{opts: opts} do
      shape = generate_shape({"public", "items"})
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, opts)

      assert_receive {:filters, [%RelationFilter{relation: {"public", "items"}}]}
    end

    test "ignores subsequent shapes for same handle", %{opts: opts} do
      shape1 = generate_shape({"public", "items"})
      shape2 = generate_shape({"public", "items"})
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape1, opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape2, opts)

      assert_receive {:filters, [%RelationFilter{relation: {"public", "items"}}]}
      refute_receive {:filters, _}, 200
    end

    @tag update_debounce_timeout: 10
    test "accepts multiple relations", %{opts: opts} do
      shape1 = generate_shape({"public", "items"})
      shape2 = generate_shape({"public", "other"})
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape1, opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_2, shape2, opts)

      collected =
        receive do
          {:filters, filters} -> MapSet.new(Enum.map(filters, & &1.relation))
        after
          500 -> flunk("Did not receive initial filters")
        end

      # Force refresh to ensure any pending prepared filters are committed
      :ok = PublicationManager.refresh_publication(Keyword.merge(opts, forced?: true))

      collected =
        receive do
          {:filters, filters} ->
            MapSet.union(collected, MapSet.new(Enum.map(filters, & &1.relation)))
        after
          200 -> collected
        end

      assert MapSet.equal?(collected, MapSet.new([{"public", "items"}, {"public", "other"}]))
    end

    @tag update_debounce_timeout: 100
    test "doesn't update when adding same relation again", %{opts: opts} do
      shape1 = generate_shape({"public", "items"})
      shape2 = generate_shape({"public", "items"})
      shape3 = generate_shape({"public", "items"})
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape1, opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_2, shape2, opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_3, shape3, opts)

      assert_receive {:filters, [%RelationFilter{relation: {"public", "items"}}]}
      refute_receive {:filters, _}, 500
    end

    @tag returned_relations: [{10, {"public", "another_table"}}]
    test "broadcasts dropped relations to shape cache", %{opts: opts} do
      shape = generate_shape({"public", "items"})
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, opts)
      assert_receive {:filters, [%RelationFilter{relation: {"public", "items"}}]}
      assert_receive {:clean_all_shapes_for_relations, [{10, {"public", "another_table"}}]}
    end
  end

  describe "remove_shape/2" do
    test "removes single relation when last shape removed", %{opts: opts} do
      shape = generate_shape({"public", "items"})
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, opts)
      assert_receive {:filters, [%RelationFilter{relation: {"public", "items"}}]}
      assert :ok == PublicationManager.remove_shape(@shape_handle_1, shape, opts)
      assert_receive {:filters, []}
    end

    @tag update_debounce_timeout: 50
    test "deduplicates shape handle operations", %{opts: opts} do
      shape = generate_shape({"public", "items"})
      task1 = Task.async(fn -> PublicationManager.add_shape(@shape_handle_1, shape, opts) end)
      task2 = Task.async(fn -> PublicationManager.add_shape(@shape_handle_2, shape, opts) end)
      task3 = Task.async(fn -> PublicationManager.remove_shape(@shape_handle_1, shape, opts) end)
      task4 = Task.async(fn -> PublicationManager.remove_shape(@shape_handle_1, shape, opts) end)

      Task.await_many([task1, task2, task3, task4])

      assert_receive {:filters, [%RelationFilter{relation: {"public", "items"}}]}
      refute_receive {:filters, _}, 300
    end

    @tag update_debounce_timeout: 50
    test "reference counts relations to avoid premature removal", %{opts: opts} do
      shape1 = generate_shape({"public", "items"})
      shape2 = generate_shape({"public", "items"})
      shape3 = generate_shape({"public", "items"})
      task1 = Task.async(fn -> PublicationManager.add_shape(@shape_handle_1, shape1, opts) end)
      task2 = Task.async(fn -> PublicationManager.add_shape(@shape_handle_2, shape2, opts) end)
      task3 = Task.async(fn -> PublicationManager.add_shape(@shape_handle_3, shape3, opts) end)
      Task.await_many([task1, task2, task3])
      assert_receive {:filters, [%RelationFilter{relation: {"public", "items"}}]}

      # Remove one handle; relation should stay
      assert :ok == PublicationManager.remove_shape(@shape_handle_1, shape1, opts)
      refute_receive {:filters, _}, 500
    end
  end

  describe "recover_shape/2" do
    test "tracks relation without updating immediately", %{opts: opts} do
      shape = generate_shape({"public", "items"})
      assert :ok == PublicationManager.recover_shape(@shape_handle_1, shape, opts)
      refute_receive {:filters, _}, 300
    end

    test "ignores subsequent recover for same handle", %{opts: opts} do
      shape1 = generate_shape({"public", "items"})
      shape2 = generate_shape({"public", "items"})
      assert :ok == PublicationManager.recover_shape(@shape_handle_1, shape1, opts)
      assert :ok == PublicationManager.recover_shape(@shape_handle_1, shape2, opts)
      :ok = PublicationManager.refresh_publication(opts)
      assert_receive {:filters, [%RelationFilter{relation: {"public", "items"}}]}
    end
  end

  describe "refresh_publication/2" do
    test "forces update when recovered relation present", %{opts: opts} do
      shape = generate_shape({"public", "items"})
      assert :ok == PublicationManager.recover_shape(@shape_handle_1, shape, opts)
      refute_receive {:filters, _}, 200
      assert :ok == PublicationManager.refresh_publication(opts)
      assert_receive {:filters, [%RelationFilter{relation: {"public", "items"}}]}
    end
  end

  describe "missing publication handling" do
    test "add_shape raises and server stops when publication is missing", ctx do
      stop_supervised!(ctx.opts[:server])

      missing_pub_error = %Postgrex.Error{
        postgres: %{
          code: :undefined_object,
          pg_code: "42704",
          severity: "ERROR",
          message: "publication \"pub_#{ctx.stack_id}\" does not exist"
        }
      }

      configure_tables_fn = fn _pool, _publication_name, _filters, _opts ->
        raise missing_pub_error
      end

      %{publication_manager: {_, publication_manager_opts}} =
        with_publication_manager(%{
          module: ctx.module,
          test: ctx.test,
          stack_id: ctx.stack_id,
          update_debounce_timeout: 0,
          shape_cache: {__MODULE__, [self()]},
          publication_name: "pub_#{ctx.stack_id}",
          pool: :no_pool,
          configure_tables_for_replication_fn: configure_tables_fn
        })

      pid = GenServer.whereis(publication_manager_opts[:server])
      mref = Process.monitor(pid)
      Process.unlink(pid)

      shape = generate_shape({"public", "items"})

      raised =
        assert_raise(Postgrex.Error, fn ->
          PublicationManager.add_shape(@shape_handle_1, shape, publication_manager_opts)
        end)

      assert raised.postgres.code == :undefined_object

      assert_receive {:DOWN, ^mref, :process, ^pid,
                      {:shutdown, %Postgrex.Error{postgres: %{code: :undefined_object}}}}
    end
  end
end
