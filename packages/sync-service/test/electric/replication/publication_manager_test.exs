defmodule Electric.Replication.PublicationManagerTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit

  import Support.ComponentSetup
  import Support.TestUtils

  alias Electric.Replication.PublicationManager

  @shape_handle_1 "shape_handle_1"
  @shape_handle_2 "shape_handle_2"
  @shape_handle_3 "shape_handle_3"

  setup :with_stack_id_from_test

  setup ctx do
    test_pid = self()

    %{publication_manager: {_, publication_manager_opts}} =
      with_publication_manager(%{
        module: ctx.module,
        test: ctx.test,
        stack_id: ctx.stack_id,
        update_debounce_timeout: Access.get(ctx, :update_debounce_timeout, 0),
        publication_name: "pub_#{ctx.stack_id}",
        pool: :no_pool
      })

    Repatch.patch(
      Electric.Postgres.Configuration,
      :check_publication_status!,
      [mode: :shared],
      fn _, _ -> ctx[:configuration_publication_status] || :ok end
    )

    Repatch.patch(
      Electric.Postgres.Configuration,
      :configure_publication!,
      [mode: :shared],
      fn _, _, filters ->
        # Only relations are relevant now
        send(test_pid, {:filters, MapSet.to_list(filters)})

        Map.new(filters, fn rel -> {rel, :ok} end)
        |> Map.merge(ctx[:configuration_result_overrides] || %{})
      end
    )

    Repatch.patch(
      Electric.ShapeCache.ShapeCleaner,
      :remove_shapes_for_relations,
      [mode: :shared],
      fn relations, _ ->
        send(test_pid, {:remove_shapes_for_relations, relations})
      end
    )

    Repatch.allow(test_pid, publication_manager_opts[:server])

    %{opts: publication_manager_opts, ctx: ctx}
  end

  describe "add_shape/3" do
    test "adds a single relation", %{opts: opts} do
      shape = generate_shape({"public", "items"})
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, opts)

      assert_receive {:filters, [{_, {"public", "items"}}]}
    end

    test "ignores subsequent shapes for same handle", %{opts: opts} do
      shape1 = generate_shape({"public", "items"})
      shape2 = generate_shape({"public", "items"})
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape1, opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape2, opts)

      assert_receive {:filters, [{_, {"public", "items"}}]}
      refute_receive {:filters, _}, 200
    end

    test "accepts multiple relations", %{opts: opts} do
      shape1 = generate_shape({"public", "items"})
      shape2 = generate_shape({"public", "other"})

      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape1, opts)
      assert_receive {:filters, [{_, {"public", "items"}}]}, 500

      assert :ok == PublicationManager.add_shape(@shape_handle_2, shape2, opts)
      assert_receive {:filters, [{_, {"public", "items"}}, {_, {"public", "other"}}]}, 500
    end

    @tag update_debounce_timeout: 100
    test "doesn't update when adding same relation again", %{opts: opts} do
      shape1 = generate_shape({"public", "items"})
      shape2 = generate_shape({"public", "items"})
      shape3 = generate_shape({"public", "items"})
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape1, opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_2, shape2, opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_3, shape3, opts)

      assert_receive {:filters, [{_, {"public", "items"}}]}
      refute_receive {:filters, _}, 500
    end

    @tag configuration_result_overrides: %{
           {10, {"public", "another_table"}} => {:error, :schema_changed}
         }
    test "broadcasts dropped relations to shape cache", %{opts: opts} do
      shape = generate_shape({"public", "items"})
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, opts)
      assert_receive {:filters, [{_, {"public", "items"}}]}
      assert_receive {:remove_shapes_for_relations, [{10, {"public", "another_table"}}]}
    end
  end

  describe "remove_shape/2" do
    test "removes single relation when last shape removed", %{opts: opts} do
      shape = generate_shape({"public", "items"})
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, opts)
      assert_receive {:filters, [{_, {"public", "items"}}]}
      assert :ok == PublicationManager.remove_shape(@shape_handle_1, opts)
      assert_receive {:filters, []}
    end

    test "subsequent additions should wait for reconfiguration", %{opts: opts} do
      shape = generate_shape({"public", "items"})
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, opts)
      assert_receive {:filters, [{_, {"public", "items"}}]}
      assert :ok == PublicationManager.remove_shape(@shape_handle_1, opts)
      assert_receive {:filters, []}
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, opts)
      assert_receive {:filters, [{_, {"public", "items"}}]}
    end

    @tag update_debounce_timeout: 50
    test "deduplicates shape handle operations", %{opts: opts} do
      shape = generate_shape({"public", "items"})
      task1 = Task.async(fn -> PublicationManager.add_shape(@shape_handle_1, shape, opts) end)
      task2 = Task.async(fn -> PublicationManager.add_shape(@shape_handle_2, shape, opts) end)
      task3 = Task.async(fn -> PublicationManager.remove_shape(@shape_handle_1, opts) end)
      task4 = Task.async(fn -> PublicationManager.remove_shape(@shape_handle_1, opts) end)

      Task.await_many([task1, task2, task3, task4])

      assert_receive {:filters, [{_, {"public", "items"}}]}
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
      assert_receive {:filters, [{_, {"public", "items"}}]}

      # Remove one handle; relation should stay
      assert :ok == PublicationManager.remove_shape(@shape_handle_1, opts)
      refute_receive {:filters, _}, 500
    end
  end

  describe "concurrent operations" do
    @tag update_debounce_timeout: 100
    test "queues up requests to add same shape handle", %{opts: opts} do
      shape1 = generate_shape({"public", "items"})
      test_pid = self()

      run_async(fn ->
        :ok = PublicationManager.add_shape(@shape_handle_1, shape1, opts)
        send(test_pid, :task1_done)
      end)

      run_async(fn ->
        :ok = PublicationManager.add_shape(@shape_handle_1, shape1, opts)
        send(test_pid, :task2_done)
      end)

      refute_receive :task1_done, 50
      refute_receive {:filters, _}, 0
      refute_receive :task2_done, 0

      assert_receive :task1_done
      assert_receive :task2_done, 10
      assert_receive {:filters, [{_, {"public", "items"}}]}, 10
      refute_receive {:filters, _}, 200
    end

    @tag update_debounce_timeout: 100
    test "invalidates add requests if removed immediately", %{opts: opts} do
      shape1 = generate_shape({"public", "items"})

      add_task =
        Task.async(fn ->
          assert_raise RuntimeError, "Shape removed before updating publication", fn ->
            PublicationManager.add_shape(@shape_handle_1, shape1, opts)
          end
        end)

      remove_task =
        Task.async(fn ->
          Process.sleep(5)
          :ok = PublicationManager.remove_shape(@shape_handle_1, opts)
        end)

      Task.await_many([add_task, remove_task])

      refute_receive {:filters, _}, 200
    end
  end

  defp run_async(fun) do
    start_supervised!(
      Supervisor.child_spec(
        {Task, fun},
        id: make_ref()
      )
    )
  end
end
