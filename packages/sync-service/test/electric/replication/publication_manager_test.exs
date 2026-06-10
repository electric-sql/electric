defmodule Electric.Replication.PublicationManagerTest do
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
  @shape_handle_3 "pub_mgr_db_test_shape_handle_3"
  @where_clause_1 %Expr{query: "id = '1'", used_refs: %{["id"] => :text}}
  @where_clause_2 %Expr{query: "id = '2'", used_refs: %{["id"] => :text}}
  @where_clause_3 %Expr{query: "id = '3'", used_refs: %{["id"] => :text}}

  @moduletag :tmp_dir

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
    relation = {"public", "items"}
    relation_oid = lookup_relation_oid(ctx.pool, relation)

    %{
      relation: relation,
      relation_with_oid: {relation_oid, relation}
    }
  end

  setup ctx do
    if ctx[:existing_where_clauses] do
      for where_clause <- ctx.existing_where_clauses do
        shape = generate_shape(ctx.relation_with_oid, where_clause)
        {:ok, _shape_handle} = Electric.ShapeCache.ShapeStatus.add_shape(ctx.stack_id, shape)
      end
    end

    :ok
  end

  setup ctx do
    %{publication_manager: {_, pub_mgr_opts}} =
      with_publication_manager(%{
        module: ctx.module,
        test: ctx.test,
        stack_id: ctx.stack_id,
        update_debounce_timeout: Access.get(ctx, :update_debounce_timeout, 0),
        publication_name: ctx.publication_name,
        pool: ctx.pool
      })

    test_pid = self()

    Repatch.patch(
      Electric.ShapeCache.ShapeCleaner,
      :remove_shapes_for_relations,
      [mode: :shared],
      fn _stack_id, relations, _reason ->
        send(test_pid, {:remove_shapes_for_relations, relations})
      end
    )

    # notify when publication is configured to avoid timing issues
    config_notification = "test"

    Repatch.allow(test_pid, PublicationManager.Configurator.name(ctx.stack_id))
    Repatch.allow(test_pid, PublicationManager.RelationTracker.name(ctx.stack_id))

    relation = {"public", "items"}
    relation_oid = lookup_relation_oid(ctx.pool, relation)

    %{
      pub_mgr_opts: pub_mgr_opts,
      relation: relation,
      relation_with_oid: {relation_oid, relation},
      config_notification: config_notification
    }
  end

  describe "wait_for_restore/1" do
    @tag existing_where_clauses: []
    test "immediately completes if nothing to restore", ctx do
      notify_alter_queries()
      assert :ok == PublicationManager.wait_for_restore(ctx.stack_id)
      assert_pub_tables(ctx, [])
      refute_receive {:alter_publication, _, _}
    end

    @tag existing_where_clauses: [@where_clause_1]
    test "restores existing shapes", ctx do
      assert :ok == PublicationManager.wait_for_restore(ctx.stack_id)
      assert_pub_tables(ctx, [ctx.relation])
    end
  end

  describe "add_shape/3" do
    test "adds a single relation", ctx do
      shape = generate_shape(ctx.relation_with_oid, @where_clause_1)
      assert :ok == PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape)

      assert_pub_tables(ctx, [ctx.relation])
    end

    test "accepts shape with generated columns if supported", ctx do
      supported_features = fetch_supported_features(ctx.db_conn)

      shape = generate_shape(ctx.relation_with_oid, @where_clause_1)

      shape = %Electric.Shapes.Shape{
        shape
        | flags: Map.put(shape.flags, :selects_generated_columns, true)
      }

      if supported_features.supports_generated_column_replication do
        assert :ok == PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape)
        assert_pub_tables(ctx, [ctx.relation])
      else
        assert_raise Electric.DbConfigurationError,
                     ~r/does not publish generated columns/,
                     fn ->
                       PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape)
                     end
      end
    end

    test "ignores subsequent shapes for same handle", ctx do
      notify_alter_queries()
      shape1 = generate_shape(ctx.relation_with_oid, @where_clause_1)
      shape2 = generate_shape(ctx.relation_with_oid, @where_clause_2)
      assert :ok == PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape1)
      assert :ok == PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape2)

      assert_pub_tables(ctx, [ctx.relation])
      assert_received {:alter_publication, _, _}
      refute_received {:alter_publication, _, _}, 200
    end

    test "accepts multiple relations", ctx do
      Postgrex.query!(
        ctx.pool,
        "CREATE TABLE other_table (id UUID PRIMARY KEY, value TEXT NOT NULL)",
        []
      )

      alt_relation = {"public", "other_table"}
      alt_relation_oid = lookup_relation_oid(ctx.pool, alt_relation)

      shape1 = generate_shape(ctx.relation_with_oid, @where_clause_1)
      shape2 = generate_shape({alt_relation_oid, alt_relation}, @where_clause_1)

      assert :ok == PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape1)
      assert_pub_tables(ctx, [ctx.relation])

      assert :ok == PublicationManager.add_shape(ctx.stack_id, @shape_handle_2, shape2)
      assert_pub_tables(ctx, [ctx.relation, alt_relation])
    end

    @tag update_debounce_timeout: 100
    test "doesn't update when adding same relation again", ctx do
      notify_alter_queries()
      shape1 = generate_shape(ctx.relation_with_oid, @where_clause_1)
      shape2 = generate_shape(ctx.relation_with_oid, @where_clause_2)
      shape3 = generate_shape(ctx.relation_with_oid, @where_clause_3)

      assert :ok == PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape1)
      assert :ok == PublicationManager.add_shape(ctx.stack_id, @shape_handle_2, shape2)
      assert :ok == PublicationManager.add_shape(ctx.stack_id, @shape_handle_3, shape3)

      assert_pub_tables(ctx, [ctx.relation])
      assert_received {:alter_publication, _, _}
      refute_received {:alter_publication, _, _}, 200
    end

    test "keeps the table in the publication when shapes with different where clauses are added and removed",
         ctx do
      notify_alter_queries()
      shape_1 = generate_shape(ctx.relation_with_oid, @where_clause_1)
      assert :ok == PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape_1)
      assert_receive {:alter_publication, _, _}
      assert_pub_tables(ctx, [ctx.relation])

      shape_2 = generate_shape(ctx.relation_with_oid, @where_clause_2)
      assert :ok == PublicationManager.add_shape(ctx.stack_id, @shape_handle_2, shape_2)
      refute_receive {:alter_publication, _, _}, 200
      assert_pub_tables(ctx, [ctx.relation])

      assert :ok == PublicationManager.remove_shape(ctx.stack_id, @shape_handle_2)
      refute_receive {:alter_publication, _, _}, 200
      assert_pub_tables(ctx, [ctx.relation])

      assert :ok == PublicationManager.remove_shape(ctx.stack_id, @shape_handle_1)
      assert_receive {:alter_publication, _, _}
      assert_pub_tables(ctx, [])
    end

    test "should continue to fail with same error", ctx do
      Repatch.patch(
        Electric.Postgres.Configuration,
        :add_table_to_publication,
        [mode: :shared],
        fn _, _, _ -> {:error, %RuntimeError{message: "some error"}} end
      )

      shape = generate_shape(ctx.relation_with_oid, @where_clause_1)

      assert_raise RuntimeError, "some error", fn ->
        PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape)
      end

      assert_raise RuntimeError, "some error", fn ->
        PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape)
      end
    end
  end

  describe "cast issuance" do
    @tag update_debounce_timeout: 0
    test "issues a single configure cast while a submission is in flight", ctx do
      test_pid = self()

      # Capture casts to the Configurator without forwarding them, so the
      # submission never produces a result and `committed` stays behind
      # `submitted` for the whole test — exactly the in-flight window.
      Repatch.patch(
        PublicationManager.Configurator,
        :configure_publication,
        [mode: :shared],
        fn _stack_id, filters -> send(test_pid, {:configure_cast, filters}) end
      )

      # Three shapes on the SAME relation (same oid) → a single relation
      # transition. Run them async because, with no result delivered, each
      # add_shape blocks as a waiter.
      for {handle, where} <- [
            {@shape_handle_1, @where_clause_1},
            {@shape_handle_2, @where_clause_2},
            {@shape_handle_3, @where_clause_3}
          ] do
        shape = generate_shape(ctx.relation_with_oid, where)
        run_async(fn -> PublicationManager.add_shape(ctx.stack_id, handle, shape) end)
      end

      # Exactly one cast, carrying the single-relation filter set.
      assert_receive {:configure_cast, filters}
      assert MapSet.size(filters) == 1
      refute_receive {:configure_cast, _}, 200
    end

    @tag update_debounce_timeout: 0
    test "re-issues a configure cast after a global configuration error", ctx do
      test_pid = self()

      Repatch.patch(
        PublicationManager.Configurator,
        :configure_publication,
        [mode: :shared],
        fn _stack_id, _filters -> send(test_pid, :configure_cast) end
      )

      relation_tracker = PublicationManager.RelationTracker.name(ctx.stack_id)

      shape1 = generate_shape(ctx.relation_with_oid, @where_clause_1)
      run_async(fn -> PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape1) end)

      # First submission is now in flight.
      assert_receive :configure_cast

      # Simulate the in-flight chain dying with a global configuration error.
      GenServer.cast(
        relation_tracker,
        {:configuration_error, {:error, %RuntimeError{message: "boom"}}}
      )

      # A subsequent add on the SAME relation (no change to prepared filters)
      # must re-arm the retry path and issue a fresh cast.
      shape2 = generate_shape(ctx.relation_with_oid, @where_clause_2)
      run_async(fn -> PublicationManager.add_shape(ctx.stack_id, @shape_handle_2, shape2) end)

      assert_receive :configure_cast, 500
    end

    @tag update_debounce_timeout: 0
    test "still issues a cast for a new relation while another submission is in flight", ctx do
      Postgrex.query!(
        ctx.pool,
        "CREATE TABLE other_table (id UUID PRIMARY KEY, value TEXT NOT NULL)",
        []
      )

      alt_relation = {"public", "other_table"}
      alt_relation_oid = lookup_relation_oid(ctx.pool, alt_relation)

      test_pid = self()

      Repatch.patch(
        PublicationManager.Configurator,
        :configure_publication,
        [mode: :shared],
        fn _stack_id, filters -> send(test_pid, {:configure_cast, filters}) end
      )

      shape1 = generate_shape(ctx.relation_with_oid, @where_clause_1)
      run_async(fn -> PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape1) end)

      # First relation's submission is in flight (no result delivered).
      assert_receive {:configure_cast, first_filters}
      assert MapSet.size(first_filters) == 1

      # Adding a DIFFERENT relation changes `prepared`, so a fresh cast must
      # still be issued despite the in-flight submission.
      shape2 = generate_shape({alt_relation_oid, alt_relation}, @where_clause_1)
      run_async(fn -> PublicationManager.add_shape(ctx.stack_id, @shape_handle_2, shape2) end)

      assert_receive {:configure_cast, second_filters}, 500
      assert MapSet.size(second_filters) == 2
    end

    @tag update_debounce_timeout: 0
    test "re-issues a configure cast after a per-relation configuration error", ctx do
      test_pid = self()

      Repatch.patch(
        PublicationManager.Configurator,
        :configure_publication,
        [mode: :shared],
        fn _stack_id, _filters -> send(test_pid, :configure_cast) end
      )

      relation_tracker = PublicationManager.RelationTracker.name(ctx.stack_id)
      oid_rel = ctx.relation_with_oid

      shape1 = generate_shape(ctx.relation_with_oid, @where_clause_1)
      run_async(fn -> PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape1) end)

      # First submission is now in flight.
      assert_receive :configure_cast

      # Simulate the in-flight chain reporting a per-relation error for the
      # relation it was configuring.
      GenServer.cast(
        relation_tracker,
        {:relation_configuration_result, oid_rel, {:error, %RuntimeError{message: "boom"}}}
      )

      # A subsequent add on the SAME relation (no change to prepared filters)
      # must re-arm the retry path and issue a fresh cast.
      shape2 = generate_shape(ctx.relation_with_oid, @where_clause_2)
      run_async(fn -> PublicationManager.add_shape(ctx.stack_id, @shape_handle_2, shape2) end)

      assert_receive :configure_cast, 500
    end
  end

  describe "remove_shape/2" do
    test "removes single relation when last shape removed", ctx do
      shape = generate_shape(ctx.relation_with_oid, @where_clause_1)
      assert :ok == PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape)
      assert_pub_tables(ctx, [ctx.relation])
      assert :ok == PublicationManager.remove_shape(ctx.stack_id, @shape_handle_1)
      assert_pub_tables(ctx, [])
    end

    @tag update_debounce_timeout: 50
    test "subsequent additions should wait for reconfiguration", ctx do
      shape = generate_shape(ctx.relation_with_oid, @where_clause_1)
      assert :ok == PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape)
      assert_pub_tables(ctx, [ctx.relation])

      assert :ok == PublicationManager.remove_shape(ctx.stack_id, @shape_handle_1)
      assert_pub_tables(ctx, [])

      test_pid = self()

      run_async(fn ->
        res = PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape)
        send(test_pid, {:add_shape_result, res})
      end)

      refute_receive {:add_shape_result, _}, 20
      assert_pub_tables(ctx, [ctx.relation])
      assert_receive {:add_shape_result, :ok}
    end

    @tag update_debounce_timeout: 50
    test "deduplicates shape handle operations", ctx do
      notify_alter_queries()
      shape = generate_shape(ctx.relation_with_oid, @where_clause_1)
      assert :ok = PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape)

      task1 =
        Task.async(fn ->
          PublicationManager.add_shape(ctx.stack_id, @shape_handle_2, shape)
        end)

      task2 =
        Task.async(fn -> PublicationManager.remove_shape(ctx.stack_id, @shape_handle_1) end)

      task3 =
        Task.async(fn -> PublicationManager.remove_shape(ctx.stack_id, @shape_handle_1) end)

      Task.await_many([task1, task2, task3])

      assert_pub_tables(ctx, [ctx.relation])
      assert_received {:alter_publication, _, _}
      refute_received {:alter_publication, _, _}, 300
    end

    @tag update_debounce_timeout: 50
    test "reference counts relations to avoid premature removal", ctx do
      notify_alter_queries()
      shape1 = generate_shape(ctx.relation_with_oid, @where_clause_1)
      shape2 = generate_shape(ctx.relation_with_oid, @where_clause_2)
      shape3 = generate_shape(ctx.relation_with_oid, @where_clause_3)

      task1 =
        Task.async(fn ->
          PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape1)
        end)

      task2 =
        Task.async(fn ->
          PublicationManager.add_shape(ctx.stack_id, @shape_handle_2, shape2)
        end)

      task3 =
        Task.async(fn ->
          PublicationManager.add_shape(ctx.stack_id, @shape_handle_3, shape3)
        end)

      Task.await_many([task1, task2, task3])
      assert_receive {:alter_publication, _, _}
      assert_pub_tables(ctx, [ctx.relation])

      # Remove one handle; relation should stay
      assert :ok == PublicationManager.remove_shape(ctx.stack_id, @shape_handle_1)
      refute_receive {:alter_publication, _, _}
      assert_pub_tables(ctx, [ctx.relation])
    end
  end

  describe "concurrent operations" do
    @tag update_debounce_timeout: 100
    test "queues up requests to add same shape handle", ctx do
      notify_alter_queries()
      shape1 = generate_shape(ctx.relation_with_oid, @where_clause_1)
      test_pid = self()

      run_async(fn ->
        :ok = PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape1)
        send(test_pid, :task1_done)
      end)

      run_async(fn ->
        :ok = PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape1)
        send(test_pid, :task2_done)
      end)

      refute_receive :task1_done, 50
      refute_receive {:alter_publication, _, _}, 0
      refute_receive :task2_done, 0

      assert_receive :task1_done
      assert_receive :task2_done, 10
      assert_pub_tables(ctx, [ctx.relation])
      assert_received {:alter_publication, _, _}
      refute_received {:alter_publication, _, _}
    end

    @tag update_debounce_timeout: 100
    test "invalidates add requests if removed immediately", ctx do
      notify_alter_queries()
      shape1 = generate_shape(ctx.relation_with_oid, @where_clause_1)

      add_task =
        Task.async(fn ->
          assert_raise RuntimeError, "Shape removed before updating publication", fn ->
            PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape1)
          end
        end)

      remove_task =
        Task.async(fn ->
          Process.sleep(5)
          :ok = PublicationManager.remove_shape(ctx.stack_id, @shape_handle_1)
        end)

      Task.await_many([add_task, remove_task])

      refute_receive {:alter_publication, _, _}, 200
    end
  end

  describe "publication misonfiguration" do
    setup do
      test_pid = self()

      Repatch.patch(
        Electric.Connection.Restarter,
        :restart_connection_subsystem,
        [mode: :shared],
        fn _ ->
          send(test_pid, :connection_subsystem_restarted)
          :ok
        end
      )
    end

    test "handles publication being deleted during operation", ctx do
      Postgrex.query!(ctx.pool, "DROP PUBLICATION #{ctx.publication_name};", [])

      shape_1 = generate_shape(ctx.relation_with_oid, @where_clause_1)

      assert_raise Electric.DbConfigurationError,
                   "Publication #{Utils.quote_name(ctx.publication_name)} not found in the database",
                   fn ->
                     PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape_1)
                   end

      assert_receive :connection_subsystem_restarted
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
                     PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape_1)
                   end

      assert_receive :connection_subsystem_restarted
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
                     PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape_1)
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
        PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape_1)
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
            PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape_1)
          end
        end)

      # this should succeed, even if the other one fails
      assert :ok = PublicationManager.add_shape(ctx.stack_id, @shape_handle_2, shape_2)

      Task.await(task)

      assert_receive {:remove_shapes_for_relations, [^relation_not_owned_with_oid]}
      assert [ctx.relation] == fetch_pub_tables(ctx)
    end
  end

  describe "component restarts" do
    test "handles relation tracker restart", ctx do
      shape = generate_shape(ctx.relation_with_oid, @where_clause_1)

      # Add the shape to ShapeStatus first - this is what allows restoration after restart
      {:ok, shape_handle} = Electric.ShapeCache.ShapeStatus.add_shape(ctx.stack_id, shape)

      # Add the shape to the publication manager
      assert :ok = PublicationManager.add_shape(ctx.stack_id, shape_handle, shape)
      assert_pub_tables(ctx, [ctx.relation])

      # Stop the RelationTracker - supervisor will restart it
      relation_tracker_name = PublicationManager.RelationTracker.name(ctx.stack_id)
      old_pid = GenServer.whereis(relation_tracker_name)
      ref = Process.monitor(old_pid)
      GenServer.stop(relation_tracker_name)
      assert_receive {:DOWN, ^ref, :process, ^old_pid, _}, 1_000

      # Wait for the supervisor to restart and re-register the RelationTracker
      # before issuing calls to it. Otherwise the via-Registry lookup made by
      # remove_shape/2 below can race with re-registration and fail with
      # :no_process.
      new_pid = wait_for_restart(relation_tracker_name, old_pid)
      assert new_pid != old_pid

      # Wait for the supervisor to restart and re-register the RelationTracker,
      # then for it to finish restoring filters from ShapeStatus.
      #
      # The assert_pub_tables below is NOT a sufficient barrier on its own: the
      # relation is already in the publication and is not removed during the
      # restart, so the assertion passes immediately - potentially before the
      # restarted process has re-registered. Calling remove_shape in that window
      # races with a "no process" exit, which is the flakiness this guards
      # against.
      assert wait_until(fn -> is_pid(GenServer.whereis(relation_tracker_name)) end, 2_000)
      :ok = PublicationManager.wait_for_restore(ctx.stack_id, timeout: 2_000)

      # After restart, the publication manager should repopulate from ShapeStatus.
      # The publication should still have the relation.
      assert_pub_tables(ctx, [ctx.relation], 2_000)

      # Verify we can still remove the shape after the restart
      PublicationManager.remove_shape(ctx.stack_id, shape_handle)
      assert_pub_tables(ctx, [], 2_000)
    end

    @tag update_debounce_timeout: 100
    test "handles configurator restart", ctx do
      notify_alter_queries()
      shape = generate_shape(ctx.relation_with_oid, @where_clause_1)

      configurator_name = PublicationManager.Configurator.name(ctx.stack_id)

      assert :ok = PublicationManager.add_shape(ctx.stack_id, @shape_handle_1, shape)
      assert_pub_tables(ctx, [ctx.relation])
      run_async(fn -> PublicationManager.remove_shape(ctx.stack_id, @shape_handle_1) end)
      GenServer.stop(configurator_name)
      assert_pub_tables(ctx, [])
    end
  end

  defp assert_pub_tables(
         ctx,
         expected_tables,
         timeout \\ 500,
         start_time \\ :erlang.monotonic_time(:millisecond)
       ) do
    pub_tables = fetch_pub_tables(ctx)

    try do
      assert pub_tables == expected_tables
    rescue
      e in ExUnit.AssertionError ->
        current_time = :erlang.monotonic_time(:millisecond)

        if current_time - start_time < timeout do
          Process.sleep(10)
          assert_pub_tables(ctx, expected_tables, timeout, start_time)
        else
          reraise e, __STACKTRACE__
        end
    end
  end

  defp fetch_pub_tables(ctx), do: fetch_publication_tables(ctx.pool, ctx.publication_name)

  # Polls the process registry until `name` resolves to a live pid other than
  # `old_pid`, i.e. until the supervisor has restarted and re-registered it.
  defp wait_for_restart(
         name,
         old_pid,
         timeout \\ 2_000,
         start_time \\ :erlang.monotonic_time(:millisecond)
       ) do
    case GenServer.whereis(name) do
      pid when is_pid(pid) and pid != old_pid ->
        pid

      _ ->
        if :erlang.monotonic_time(:millisecond) - start_time < timeout do
          Process.sleep(10)
          wait_for_restart(name, old_pid, timeout, start_time)
        else
          flunk("#{inspect(name)} was not restarted within #{timeout}ms")
        end
    end
  end

  defp notify_alter_queries(notify_pid \\ self()) do
    Repatch.patch(Postgrex, :query, [mode: :shared], fn conn, sql, params ->
      if String.starts_with?(sql, "ALTER TABLE") do
        send(notify_pid, {:alter_table, sql, params})
      end

      if String.starts_with?(sql, "ALTER PUBLICATION") do
        send(notify_pid, {:alter_publication, sql, params})
      end

      Repatch.real(Postgrex.query(conn, sql, params))
    end)
  end

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

  defp run_async(fun) do
    start_supervised!(
      Supervisor.child_spec(
        {Task, fun},
        id: make_ref()
      )
    )
  end
end
