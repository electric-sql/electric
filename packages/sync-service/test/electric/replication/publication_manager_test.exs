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
      fn relations, _ ->
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
      assert :ok == PublicationManager.wait_for_restore(ctx.pub_mgr_opts)
      assert_pub_tables(ctx, [])
      refute_receive {:alter_publication, _, _}
    end

    @tag existing_where_clauses: [@where_clause_1]
    test "restores existing shapes", ctx do
      assert :ok == PublicationManager.wait_for_restore(ctx.pub_mgr_opts)
      assert_pub_tables(ctx, [ctx.relation])
    end
  end

  describe "add_shape/3" do
    test "adds a single relation", ctx do
      shape = generate_shape(ctx.relation_with_oid, @where_clause_1)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, ctx.pub_mgr_opts)

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
        assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, ctx.pub_mgr_opts)
        assert_pub_tables(ctx, [ctx.relation])
      else
        assert_raise Electric.DbConfigurationError,
                     ~r/does not publish generated columns/,
                     fn ->
                       PublicationManager.add_shape(@shape_handle_1, shape, ctx.pub_mgr_opts)
                     end
      end
    end

    test "ignores subsequent shapes for same handle", ctx do
      notify_alter_queries()
      shape1 = generate_shape(ctx.relation_with_oid, @where_clause_1)
      shape2 = generate_shape(ctx.relation_with_oid, @where_clause_2)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape1, ctx.pub_mgr_opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape2, ctx.pub_mgr_opts)

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

      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape1, ctx.pub_mgr_opts)
      assert_pub_tables(ctx, [ctx.relation])

      assert :ok == PublicationManager.add_shape(@shape_handle_2, shape2, ctx.pub_mgr_opts)
      assert_pub_tables(ctx, [ctx.relation, alt_relation])
    end

    @tag update_debounce_timeout: 100
    test "doesn't update when adding same relation again", ctx do
      notify_alter_queries()
      shape1 = generate_shape(ctx.relation_with_oid, @where_clause_1)
      shape2 = generate_shape(ctx.relation_with_oid, @where_clause_2)
      shape3 = generate_shape(ctx.relation_with_oid, @where_clause_3)

      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape1, ctx.pub_mgr_opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_2, shape2, ctx.pub_mgr_opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_3, shape3, ctx.pub_mgr_opts)

      assert_pub_tables(ctx, [ctx.relation])
      assert_received {:alter_publication, _, _}
      refute_received {:alter_publication, _, _}, 200
    end

    test "keeps the table in the publication when shapes with different where clauses are added and removed",
         ctx do
      notify_alter_queries()
      shape_1 = generate_shape(ctx.relation_with_oid, @where_clause_1)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape_1, ctx.pub_mgr_opts)
      assert_receive {:alter_publication, _, _}
      assert_pub_tables(ctx, [ctx.relation])

      shape_2 = generate_shape(ctx.relation_with_oid, @where_clause_2)
      assert :ok == PublicationManager.add_shape(@shape_handle_2, shape_2, ctx.pub_mgr_opts)
      refute_receive {:alter_publication, _, _}, 200
      assert_pub_tables(ctx, [ctx.relation])

      assert :ok == PublicationManager.remove_shape(@shape_handle_2, ctx.pub_mgr_opts)
      refute_receive {:alter_publication, _, _}, 200
      assert_pub_tables(ctx, [ctx.relation])

      assert :ok == PublicationManager.remove_shape(@shape_handle_1, ctx.pub_mgr_opts)
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
        PublicationManager.add_shape(@shape_handle_1, shape, ctx.pub_mgr_opts)
      end

      assert_raise RuntimeError, "some error", fn ->
        PublicationManager.add_shape(@shape_handle_1, shape, ctx.pub_mgr_opts)
      end
    end
  end

  describe "remove_shape/2" do
    test "removes single relation when last shape removed", ctx do
      shape = generate_shape(ctx.relation_with_oid, @where_clause_1)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, ctx.pub_mgr_opts)
      assert_pub_tables(ctx, [ctx.relation])
      assert :ok == PublicationManager.remove_shape(@shape_handle_1, ctx.pub_mgr_opts)
      assert_pub_tables(ctx, [])
    end

    @tag update_debounce_timeout: 50
    test "subsequent additions should wait for reconfiguration", ctx do
      shape = generate_shape(ctx.relation_with_oid, @where_clause_1)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, ctx.pub_mgr_opts)
      assert_pub_tables(ctx, [ctx.relation])

      assert :ok == PublicationManager.remove_shape(@shape_handle_1, ctx.pub_mgr_opts)
      assert_pub_tables(ctx, [])

      test_pid = self()

      run_async(fn ->
        res = PublicationManager.add_shape(@shape_handle_1, shape, ctx.pub_mgr_opts)
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
      assert :ok = PublicationManager.add_shape(@shape_handle_1, shape, ctx.pub_mgr_opts)

      task1 =
        Task.async(fn ->
          PublicationManager.add_shape(@shape_handle_2, shape, ctx.pub_mgr_opts)
        end)

      task2 =
        Task.async(fn -> PublicationManager.remove_shape(@shape_handle_1, ctx.pub_mgr_opts) end)

      task3 =
        Task.async(fn -> PublicationManager.remove_shape(@shape_handle_1, ctx.pub_mgr_opts) end)

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
          PublicationManager.add_shape(@shape_handle_1, shape1, ctx.pub_mgr_opts)
        end)

      task2 =
        Task.async(fn ->
          PublicationManager.add_shape(@shape_handle_2, shape2, ctx.pub_mgr_opts)
        end)

      task3 =
        Task.async(fn ->
          PublicationManager.add_shape(@shape_handle_3, shape3, ctx.pub_mgr_opts)
        end)

      Task.await_many([task1, task2, task3])
      assert_receive {:alter_publication, _, _}
      assert_pub_tables(ctx, [ctx.relation])

      # Remove one handle; relation should stay
      assert :ok == PublicationManager.remove_shape(@shape_handle_1, ctx.pub_mgr_opts)
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
        :ok = PublicationManager.add_shape(@shape_handle_1, shape1, ctx.pub_mgr_opts)
        send(test_pid, :task1_done)
      end)

      run_async(fn ->
        :ok = PublicationManager.add_shape(@shape_handle_1, shape1, ctx.pub_mgr_opts)
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
            PublicationManager.add_shape(@shape_handle_1, shape1, ctx.pub_mgr_opts)
          end
        end)

      remove_task =
        Task.async(fn ->
          Process.sleep(5)
          :ok = PublicationManager.remove_shape(@shape_handle_1, ctx.pub_mgr_opts)
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
                     PublicationManager.add_shape(@shape_handle_1, shape_1, ctx.pub_mgr_opts)
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
                     PublicationManager.add_shape(@shape_handle_1, shape_1, ctx.pub_mgr_opts)
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

  describe "component restarts" do
    test "handles relation tracker restart", ctx do
      notify_alter_queries()
      shape = generate_shape(ctx.relation_with_oid, @where_clause_1)

      {:ok, shape_handle} = Electric.ShapeCache.ShapeStatus.add_shape(ctx.stack_id, shape)

      run_async(fn ->
        assert_raise RuntimeError, fn ->
          PublicationManager.add_shape(shape_handle, shape, ctx.pub_mgr_opts)
        end
      end)

      relation_tracker_name = PublicationManager.RelationTracker.name(ctx.stack_id)

      receive do
        {:alter_publication, _, _} -> GenServer.stop(relation_tracker_name)
      end

      assert_pub_tables(ctx, [ctx.relation])

      # after restart, the publication manager should repopulate the publication
      PublicationManager.remove_shape(shape_handle, ctx.pub_mgr_opts)
      assert_pub_tables(ctx, [])
    end

    @tag update_debounce_timeout: 100
    test "handles configurator restart", ctx do
      notify_alter_queries()
      shape = generate_shape(ctx.relation_with_oid, @where_clause_1)

      configurator_name = PublicationManager.Configurator.name(ctx.stack_id)

      assert :ok = PublicationManager.add_shape(@shape_handle_1, shape, ctx.pub_mgr_opts)
      assert_pub_tables(ctx, [ctx.relation])
      run_async(fn -> PublicationManager.remove_shape(@shape_handle_1, ctx.pub_mgr_opts) end)
      GenServer.stop(configurator_name)
      assert_pub_tables(ctx, [])
    end
  end

  defp assert_pub_tables(ctx, expected_tables, timeout \\ 500) do
    start_time = :erlang.monotonic_time(:millisecond)
    pub_tables = fetch_pub_tables(ctx)

    try do
      assert pub_tables == expected_tables
    rescue
      e in ExUnit.AssertionError ->
        current_time = :erlang.monotonic_time(:millisecond)

        if current_time - start_time < timeout do
          Process.sleep(10)
          assert_pub_tables(ctx, expected_tables, timeout)
        else
          reraise e, __STACKTRACE__
        end
    end
  end

  defp fetch_pub_tables(ctx), do: fetch_publication_tables(ctx.pool, ctx.publication_name)

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
