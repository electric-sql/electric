defmodule Electric.Shapes.ConsumerTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit, assert_expectations: true

  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.Commit
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes.TransactionFragment
  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes
  alias Electric.Shapes.Shape
  alias Electric.Shapes.Consumer

  alias Support.StubInspector

  import Support.ComponentSetup

  import Support.TestUtils,
    only: [
      expect_calls: 2,
      patch_shape_status: 1,
      expect_shape_status: 1,
      patch_snapshotter: 1,
      assert_shape_cleanup: 1
    ]

  @receive_timeout 1_000

  @base_inspector StubInspector.new(
                    tables: [
                      "test_table",
                      "other_table",
                      "something else",
                      {"random", "definitely_different"}
                    ],
                    columns: [
                      %{name: "id", type: "int8", pk_position: 0},
                      %{name: "value", type: "text"}
                    ]
                  )
  @shape_handle1 "#{inspect(__MODULE__)}-shape1"
  @shape1 Shape.new!("public.test_table", inspector: @base_inspector)

  @shape_handle2 "#{inspect(__MODULE__)}-shape2"
  @shape2 Shape.new!("public.other_table", inspector: @base_inspector)

  @shape_handle3 "#{inspect(__MODULE__)}-shape3"
  @shape3 Shape.new!("public.test_table",
            inspector: @base_inspector,
            where: "id = 1"
          )

  @shape_with_compaction Shape.new!("public.test_table",
                           inspector: @base_inspector,
                           storage: %{compaction: :enabled}
                         )

  @shape_with_subquery Shape.new!("public.test_table",
                         inspector: @base_inspector,
                         where: "id IN (SELECT id FROM public.other_table)"
                       )

  @shape_position %{
    @shape_handle1 => %{
      latest_offset: LogOffset.new(Lsn.from_string("0/10"), 0),
      snapshot_xmin: 100
    },
    @shape_handle2 => %{
      latest_offset: LogOffset.new(Lsn.from_string("0/50"), 0),
      snapshot_xmin: 120
    },
    @shape_handle3 => %{
      latest_offset: LogOffset.new(Lsn.from_string("0/1"), 0),
      snapshot_xmin: 10
    }
  }

  @moduletag :tmp_dir

  setup :with_stack_id_from_test

  defp shape_status(shape_handle, ctx) do
    get_in(ctx, [:shape_position, shape_handle]) || raise "invalid shape_handle #{shape_handle}"
  end

  defp log_offset(shape_handle, ctx) do
    get_in(ctx, [:shape_position, shape_handle, :latest_offset]) ||
      raise "invalid shape_handle #{shape_handle}"
  end

  defp snapshot_xmin(shape_handle, ctx) do
    get_in(ctx, [:shape_position, shape_handle, :snapshot_xmin]) ||
      raise "invalid shape_handle #{shape_handle}"
  end

  defp lsn(shape_handle, ctx) do
    %{tx_offset: offset} = log_offset(shape_handle, ctx)
    Lsn.from_integer(offset)
  end

  describe "event handling" do
    setup [
      :with_registry,
      :with_in_memory_storage,
      :with_shape_status,
      :with_lsn_tracker,
      :with_persistent_kv,
      :with_status_monitor,
      :with_dynamic_consumer_supervisor,
      :with_noop_publication_manager,
      :with_shape_cleaner
    ]

    setup(ctx) do
      shapes = Map.get(ctx, :shapes, %{@shape_handle1 => @shape1, @shape_handle2 => @shape2})
      shape_position = Map.get(ctx, :shape_position, @shape_position)
      [shape_position: shape_position, shapes: shapes]
    end

    setup(ctx) do
      start_link_supervised!({
        ShapeLogCollector.Supervisor,
        stack_id: ctx.stack_id, persistent_kv: ctx.persistent_kv, inspector: @base_inspector
      })

      ShapeLogCollector.mark_as_ready(ctx.stack_id)

      :ok
    end

    setup(ctx) do
      %{latest_offset: _offset1, snapshot_xmin: xmin1} = shape_status(@shape_handle1, ctx)
      %{latest_offset: _offset2, snapshot_xmin: xmin2} = shape_status(@shape_handle2, ctx)

      storage =
        Support.TestStorage.wrap(ctx.storage, %{
          @shape_handle1 => [
            {:mark_snapshot_as_started, []},
            {:set_pg_snapshot, [%{xmin: xmin1, xmax: xmin1 + 1, xip_list: [xmin1]}]}
          ],
          @shape_handle2 => [
            {:mark_snapshot_as_started, []},
            {:set_pg_snapshot, [%{xmin: xmin2, xmax: xmin2 + 1, xip_list: [xmin2]}]}
          ]
        })

      Electric.StackConfig.put(ctx.stack_id, Electric.ShapeCache.Storage, storage)
      Electric.StackConfig.put(ctx.stack_id, :inspector, @base_inspector)

      patch_shape_status(
        fetch_shape_by_handle: fn _, shape_handle -> Map.fetch(ctx.shapes, shape_handle) end
      )

      Support.TestUtils.activate_mocks_for_descendant_procs(Electric.Shapes.Consumer)
      Support.TestUtils.activate_mocks_for_descendant_procs(Electric.ShapeCache.ShapeCleaner)

      consumers =
        for {shape_handle, shape} <- ctx.shapes do
          %{latest_offset: _offset} = shape_status(shape_handle, ctx)

          {:ok, consumer} =
            start_supervised(
              {Shapes.Consumer,
               %{
                 shape_handle: shape_handle,
                 stack_id: ctx.stack_id,
                 # inspector: {Mock.Inspector, []},
                 otel_ctx: nil,
                 action: :create
               }},
              id: {Shapes.Consumer, shape_handle}
            )

          assert_receive {Support.TestStorage, :init_writer!, ^shape_handle, ^shape}

          :started = Consumer.await_snapshot_start(ctx.stack_id, shape_handle)

          consumer
        end

      [consumers: consumers]
    end

    test "appends to log when xid >= xmin", ctx do
      xid = 150
      xmin = snapshot_xmin(@shape_handle1, ctx)
      last_log_offset = log_offset(@shape_handle1, ctx)
      lsn = lsn(@shape_handle1, ctx)
      next_lsn = Lsn.increment(lsn, 1)
      next_log_offset = LogOffset.new(next_lsn, 0)

      ref = make_ref()

      Registry.register(ctx.registry, @shape_handle1, ref)

      txn =
        transaction(xmin, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: last_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      assert_receive {^ref, :new_changes, ^last_log_offset}, @receive_timeout
      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle1, _}
      refute_storage_calls_for_txn_fragment(@shape_handle2)

      txn2 =
        transaction(xid, next_lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: next_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn2, ctx.stack_id)
      assert_receive {^ref, :new_changes, ^next_log_offset}, @receive_timeout
      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle1, _}
      refute_storage_calls_for_txn_fragment(@shape_handle2)
    end

    test "correctly writes only relevant changes to multiple shape logs", ctx do
      expected_log_offset = log_offset(@shape_handle1, ctx)
      lsn = lsn(@shape_handle1, ctx)

      change1_offset = expected_log_offset
      change2_offset = LogOffset.increment(expected_log_offset, 1)
      change3_offset = LogOffset.increment(expected_log_offset, 2)

      xid = 150

      ref1 = make_ref()
      ref2 = make_ref()

      Registry.register(ctx.registry, @shape_handle1, ref1)
      Registry.register(ctx.registry, @shape_handle2, ref2)

      txn =
        transaction(xid, lsn, [
          %Changes.NewRecord{
            relation: {"public", "something else"},
            record: %{"id" => "3"},
            log_offset: change3_offset
          },
          %Changes.NewRecord{
            relation: {"public", "other_table"},
            record: %{"id" => "2"},
            log_offset: change2_offset
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: change1_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {^ref1, :new_changes, ^change1_offset}, @receive_timeout
      assert_receive {^ref2, :new_changes, ^change2_offset}, @receive_timeout

      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle1,
                      [{_offset, _key, _type, serialized_record}]}

      assert %{"value" => %{"id" => "1"}} = Jason.decode!(serialized_record)

      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle2,
                      [{_offset, _key, _type, serialized_record}]}

      assert %{"value" => %{"id" => "2"}} = Jason.decode!(serialized_record)
    end

    @tag shapes: %{
           @shape_handle1 =>
             Shape.new!("public.test_table", where: "id != 1", inspector: @base_inspector),
           @shape_handle2 =>
             Shape.new!("public.test_table", where: "id = 1", inspector: @base_inspector)
         }
    test "doesn't append to log when change is irrelevant for active shapes", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      ref1 = Shapes.Consumer.register_for_changes(ctx.stack_id, @shape_handle1)
      ref2 = Shapes.Consumer.register_for_changes(ctx.stack_id, @shape_handle2)

      txn =
        transaction(xid, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: last_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle2, _}
      refute_storage_calls_for_txn_fragment(@shape_handle1)

      refute_receive {^ref1, :new_changes, _}
      assert_receive {^ref2, :new_changes, _}
    end

    test "handles truncate without appending to log", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      expect_shape_status(remove_shape: {fn _, @shape_handle1 -> :ok end, at_least: 1})

      txn =
        transaction(xid, lsn, [
          %Changes.TruncatedRelation{
            relation: {"public", "test_table"},
            log_offset: last_log_offset
          }
        ])

      assert_consumer_shutdown(ctx.stack_id, @shape_handle1, fn ->
        assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      end)

      assert_shape_cleanup(@shape_handle1)

      refute_receive {Electric.ShapeCache.ShapeCleaner, :cleanup, @shape_handle2}
    end

    @tag shapes: %{
           @shape_handle1 =>
             Shape.new!("test_table",
               where: "id LIKE 'test'",
               inspector:
                 StubInspector.new(%{
                   {"public", "test_table"} => %{
                     columns: [%{name: "id", type: "text", pk_position: 0}]
                   }
                 })
             )
         }
    test "handles truncate when shape has a where clause", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      expect_shape_status(remove_shape: {fn _, @shape_handle1 -> :ok end, at_least: 1})

      txn =
        transaction(xid, lsn, [
          %Changes.TruncatedRelation{
            relation: {"public", "test_table"},
            log_offset: last_log_offset
          }
        ])

      assert_consumer_shutdown(ctx.stack_id, @shape_handle1, fn ->
        assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      end)

      refute_storage_calls_for_txn_fragment(@shape_handle1)

      assert_shape_cleanup(@shape_handle1)

      refute_receive {Electric.ShapeCache.ShapeCleaner, :cleanup, @shape_handle2}
    end

    test "notifies listeners of new changes", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      ref = make_ref()
      Registry.register(ctx.registry, @shape_handle1, ref)

      txn =
        transaction(xid, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: last_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      assert_receive {^ref, :new_changes, ^last_log_offset}, @receive_timeout
      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle1, _}
    end

    test "does not clean shapes if relation didn't change", ctx do
      rel =
        %Relation{
          id: :erlang.phash2({"random", "definitely_different"}),
          schema: "random",
          table: "definitely_different",
          columns: []
        }

      ref1 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))

      ref2 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle2))

      patch_shape_status(
        remove_shape: fn _, shape_handle ->
          raise "Unexpected call to remove_shape: #{shape_handle}"
        end
      )

      assert :ok = ShapeLogCollector.handle_event(rel, ctx.stack_id)

      refute_receive {:DOWN, ^ref1, :process, _, _}
      refute_receive {:DOWN, ^ref2, :process, _, _}
    end

    test "cleans shapes affected by a relation rename", ctx do
      {orig_schema, _} = @shape1.root_table
      cleaned_oid = @shape1.root_table_id

      rel = %Relation{
        id: cleaned_oid,
        schema: orig_schema,
        table: "definitely_different",
        columns: []
      }

      ref1 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))

      ref2 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle2))

      # also cleans up inspector cache and shape status cache
      expect_calls(
        Electric.Postgres.Inspector,
        clean: fn ^cleaned_oid, _ -> true end
      )

      expect_shape_status(remove_shape: {fn _, @shape_handle1 -> :ok end, at_least: 1})

      assert :ok = ShapeLogCollector.handle_event(rel, ctx.stack_id)

      assert_receive {:DOWN, ^ref1, :process, _, {:shutdown, :cleanup}}
      refute_receive {:DOWN, ^ref2, :process, _, _}

      assert_shape_cleanup(@shape_handle1)
    end

    test "cleans shapes affected by a relation change", ctx do
      ref1 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))
      ref2 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle2))

      {orig_schema, orig_table} = @shape1.root_table
      cleaned_oid = @shape1.root_table_id

      rel_before = %Relation{
        id: @shape1.root_table_id,
        schema: orig_schema,
        table: orig_table,
        columns: [%{name: "id", type_oid: {1, 1}}, %{name: "value", type_oid: {2, 1}}]
      }

      assert :ok = ShapeLogCollector.handle_event(rel_before, ctx.stack_id)

      refute_receive {:DOWN, _, :process, _, _}

      rel_changed = %{
        rel_before
        | columns: [%{name: "id", type_oid: {999, 1}}, %{name: "value", type_oid: {2, 1}}],
          affected_columns: ["id"]
      }

      # also cleans up inspector cache and shape status cache
      expect_calls(
        Electric.Postgres.Inspector,
        clean: fn ^cleaned_oid, _ -> true end
      )

      expect_shape_status(remove_shape: {fn _, @shape_handle1 -> :ok end, at_least: 1})

      assert :ok = ShapeLogCollector.handle_event(rel_changed, ctx.stack_id)

      assert_receive {:DOWN, ^ref1, :process, _, {:shutdown, :cleanup}}
      refute_receive {:DOWN, ^ref2, :process, _, _}

      assert_shape_cleanup(@shape_handle1)

      refute_receive {Electric.ShapeCache.ShapeCleaner, :cleanup, @shape_handle2}
    end

    test "notifies live listeners when invalidated", ctx do
      ref1 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))

      {orig_schema, orig_table} = @shape1.root_table
      cleaned_oid = @shape1.root_table_id

      rel_before = %Relation{
        id: @shape1.root_table_id,
        schema: orig_schema,
        table: orig_table,
        columns: [%{name: "id", type_oid: {1, 1}}, %{name: "value", type_oid: {2, 1}}]
      }

      assert :ok = ShapeLogCollector.handle_event(rel_before, ctx.stack_id)

      refute_receive {:DOWN, _, :process, _, _}

      live_ref = make_ref()
      Registry.register(ctx.registry, @shape_handle1, live_ref)

      rel_changed = %{
        rel_before
        | columns: [%{name: "id", type_oid: {999, 1}}, %{name: "value", type_oid: {2, 1}}],
          affected_columns: ["id"]
      }

      expect_calls(
        Electric.Postgres.Inspector,
        clean: fn cleaned_oid1, _ -> assert cleaned_oid1 == cleaned_oid end
      )

      expect_shape_status(remove_shape: {fn _, @shape_handle1 -> :ok end, at_least: 1})

      assert :ok = ShapeLogCollector.handle_event(rel_changed, ctx.stack_id)

      assert_receive {:DOWN, ^ref1, :process, _, {:shutdown, :cleanup}}
      assert_receive {^live_ref, :shape_rotation}
      refute_receive {Electric.ShapeCache.ShapeCleaner, :cleanup, @shape_handle2}
    end

    test "consumer crashing stops affected consumer", ctx do
      ref1 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))
      ref2 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle2))

      expect_shape_status(remove_shape: {fn _, @shape_handle1 -> :ok end, at_least: 1})

      GenServer.cast(Consumer.whereis(ctx.stack_id, @shape_handle1), :unexpected_cast)

      assert_shape_cleanup(@shape_handle1)

      refute_receive {Electric.ShapeCache.ShapeCleaner, :cleanup, @shape_handle2}

      assert_receive {:DOWN, ^ref1, :process, _, _}
      refute_receive {:DOWN, ^ref2, :process, _, _}
    end
  end

  describe "transaction handling with real storage" do
    @describetag :tmp_dir

    setup do
      %{inspector: @base_inspector, pool: nil}
    end

    setup [
      :with_registry,
      :with_pure_file_storage,
      :with_shape_status,
      :with_lsn_tracker,
      :with_log_chunking,
      :with_persistent_kv,
      :with_async_deleter,
      :with_shape_cleaner,
      :with_shape_log_collector,
      :with_noop_publication_manager,
      :with_status_monitor
    ]

    setup(ctx) do
      snapshot_delay = Map.get(ctx, :snapshot_delay, nil)

      patch_snapshotter(fn parent, shape_handle, _shape, %{snapshot_fun: snapshot_fun} ->
        if is_integer(snapshot_delay), do: Process.sleep(snapshot_delay)
        pg_snapshot = ctx[:pg_snapshot] || {10, 11, [10]}
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, pg_snapshot})
        GenServer.cast(parent, {:snapshot_started, shape_handle})
        snapshot_fun.([])
      end)

      :ok
    end

    setup(ctx) do
      Electric.StackConfig.put(
        ctx.stack_id,
        :shape_hibernate_after,
        Map.get(ctx, :hibernate_after, 10_000)
      )

      :ok
    end

    setup ctx do
      %{consumer_supervisor: consumer_supervisor, shape_cache: shape_cache} =
        Support.ComponentSetup.with_shape_cache(ctx)

      %{
        consumer_supervisor: consumer_supervisor,
        shape_cache: shape_cache
      }
    end

    test "duplicate transactions storage is idempotent", ctx do
      %{storage: storage} = ctx

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      lsn = Lsn.from_integer(10)

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      txn =
        transaction(11, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn, 0)
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2"},
            log_offset: LogOffset.new(lsn, 2)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      expected_offset = LogOffset.new(lsn, 2)
      assert_receive {^ref, :new_changes, ^expected_offset}

      shape_storage = Storage.for_shape(shape_handle, storage)

      assert [op1, op2] =
               Storage.get_log_stream(LogOffset.last_before_real_offsets(), shape_storage)
               |> Enum.map(&Jason.decode!/1)

      # If we encounter & store the same transaction, log stream should be stable
      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      # We should not re-process the same transaction
      refute_receive {^ref, :new_changes, _}

      assert [^op1, ^op2] =
               Storage.get_log_stream(LogOffset.last_before_real_offsets(), shape_storage)
               |> Enum.map(&Jason.decode!/1)

      stop_supervised!(ctx.consumer_supervisor)
    end

    @tag snapshot_delay: 100
    test "transactions are buffered until snapshot xmin is known", ctx do
      %{storage: storage} = ctx

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)

      lsn1 = Lsn.from_integer(9)
      lsn2 = Lsn.from_integer(10)

      assert_receive {:snapshot, ^shape_handle}

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      txn1 =
        transaction(9, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn1, 0)
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2"},
            log_offset: LogOffset.new(lsn1, 2)
          }
        ])

      txn2 =
        transaction(10, lsn2, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn2, 0)
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2"},
            log_offset: LogOffset.new(lsn2, 2)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn1, ctx.stack_id)
      assert :ok = ShapeLogCollector.handle_event(txn2, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      expected_offset = LogOffset.new(lsn2, 2)
      assert_receive {^ref, :new_changes, ^expected_offset}

      shape_storage = Storage.for_shape(shape_handle, storage)

      assert [_op1, _op2] =
               Storage.get_log_stream(LogOffset.last_before_real_offsets(), shape_storage)
               |> Enum.map(&Jason.decode!/1)

      stop_supervised!(ctx.consumer_supervisor)
    end

    test "restarting a consumer doesn't lower the last known offset when only snapshot is present",
         ctx do
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      assert {_, offset1} = ShapeCache.resolve_shape_handle(shape_handle, @shape1, ctx.stack_id)
      assert offset1 == LogOffset.last_before_real_offsets()

      ref = ctx.consumer_supervisor |> GenServer.whereis() |> Process.monitor()
      # Stop the consumer and the shape cache server to simulate a restart
      stop_supervised!(ctx.consumer_supervisor)
      assert_receive {:DOWN, ^ref, :process, _pid, _reason}, 1000

      shape_cache_pid = ctx.stack_id |> ShapeCache.name() |> GenServer.whereis()
      assert is_pid(shape_cache_pid)
      ref = Process.monitor(shape_cache_pid)
      stop_supervised!(ctx.shape_cache)
      assert_receive {:DOWN, ^ref, :process, _pid, _reason}, 1000

      stop_supervised!("shape_task_supervisor")

      # Restart the shape cache and the consumers
      Support.ComponentSetup.with_shape_cache(ctx)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)
      assert {_, offset2} = ShapeCache.resolve_shape_handle(shape_handle, @shape1, ctx.stack_id)

      assert LogOffset.compare(offset2, offset1) != :lt
    end

    @tag with_pure_file_storage_opts: [flush_period: 50]
    test "should correctly normalize a flush boundary to txn", ctx do
      {:via, Registry, {name, key}} = Electric.Postgres.ReplicationClient.name(ctx.stack_id)
      Registry.register(name, key, nil)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape3, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      lsn = Lsn.from_integer(10)

      txn =
        transaction(10, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn, 2)
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {:flush_boundary_updated, 10}, 1_000
    end

    @tag pg_snapshot: {10, 15, [12]}
    test "should notify txns skipped because of xmin/xip as flushed", ctx do
      {:via, Registry, {name, key}} = Electric.Postgres.ReplicationClient.name(ctx.stack_id)
      Registry.register(name, key, nil)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)
      lsn2 = Lsn.from_integer(301)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      txn =
        transaction(2, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn1, 0)
          }
        ])

      txn2 =
        transaction(11, lsn2, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn2, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      assert :ok = ShapeLogCollector.handle_event(txn2, ctx.stack_id)

      assert_receive {:flush_boundary_updated, 300}, 1_000
      assert_receive {:flush_boundary_updated, 301}, 1_000
    end

    @tag hibernate_after: 10, with_pure_file_storage_opts: [flush_period: 1]
    @tag suspend: true
    test "should terminate after :hibernate_after ms", ctx do
      {:via, Registry, {name, key}} = Electric.Postgres.ReplicationClient.name(ctx.stack_id)
      Registry.register(name, key, nil)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)
      ref = Process.monitor(consumer_pid)

      txn =
        transaction(2, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn1, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {:flush_boundary_updated, 300}, 1_000

      Process.sleep(60)

      assert_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}

      refute Consumer.whereis(ctx.stack_id, shape_handle)
    end

    @tag hibernate_after: 10, with_pure_file_storage_opts: [flush_period: 1]
    @tag suspend: true
    test "should hibernate not suspend if has dependencies", ctx do
      {:via, Registry, {name, key}} = Electric.Postgres.ReplicationClient.name(ctx.stack_id)
      Registry.register(name, key, nil)

      {shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_subquery, ctx.stack_id)

      lsn1 = Lsn.from_integer(300)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)

      assert {:ok, shape} = Electric.Shapes.fetch_shape_by_handle(ctx.stack_id, shape_handle)

      assert [dependent_shape_handle] = shape.shape_dependencies_handles

      txn =
        transaction(2, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn1, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {:flush_boundary_updated, 300}, 1_000

      Process.sleep(100)

      assert {:current_function, {:gen_server, :loop_hibernate, 4}} =
               Process.info(consumer_pid, :current_function)

      Process.sleep(20)

      assert {:current_function, {:gen_server, :loop_hibernate, 4}} =
               Process.info(consumer_pid, :current_function)

      dependent_consumer_pid = Consumer.whereis(ctx.stack_id, dependent_shape_handle)

      Process.sleep(20)

      assert {:current_function, {:gen_server, :loop_hibernate, 4}} =
               Process.info(dependent_consumer_pid, :current_function)

      assert is_pid(Consumer.whereis(ctx.stack_id, shape_handle))
    end

    @tag with_pure_file_storage_opts: [flush_period: 1]
    @tag suspend: false
    test "ConsumerRegistry.enable_suspend should suspend hibernated consumers", ctx do
      {:via, Registry, {name, key}} = Electric.Postgres.ReplicationClient.name(ctx.stack_id)
      Registry.register(name, key, nil)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)
      ref = Process.monitor(consumer_pid)

      txn =
        transaction(2, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn1, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {:flush_boundary_updated, 300}, 1_000

      Process.sleep(60)

      refute_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}

      assert Consumer.whereis(ctx.stack_id, shape_handle)

      Shapes.ConsumerRegistry.enable_suspend(ctx.stack_id, 5, 10)

      Process.sleep(60)

      assert_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}

      refute Consumer.whereis(ctx.stack_id, shape_handle)
    end

    @tag with_pure_file_storage_opts: [compaction_period: 5, keep_complete_chunks: 133]
    test "compaction is scheduled and invoked for a shape that has compaction enabled", ctx do
      parent = self()
      ref = make_ref()

      fun = fn _shape_opts, 133 ->
        send(parent, {:consumer_did_invoke_compact, ref})
        :ok
      end

      Repatch.patch(Electric.ShapeCache.PureFileStorage, :compact, [mode: :shared], fun)
      Support.TestUtils.activate_mocks_for_descendant_procs(Consumer)

      {_shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_compaction, ctx.stack_id)

      assert_receive {:consumer_did_invoke_compact, ^ref}
    end

    test "terminating the consumers cleans up its entry from Storage ETS", ctx do
      import Electric.ShapeCache.PureFileStorage.SharedRecords, only: [storage_meta: 2]

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      assert {_, offset1} = ShapeCache.resolve_shape_handle(shape_handle, @shape1, ctx.stack_id)
      assert offset1 == LogOffset.last_before_real_offsets()

      table = Electric.ShapeCache.PureFileStorage.stack_ets(ctx.stack_id)

      assert [shape_meta] = :ets.tab2list(table)
      assert storage_meta(shape_meta, :shape_handle) == shape_handle
      assert storage_meta(shape_meta, :last_persisted_offset) == offset1

      assert :ok == Consumer.stop(ctx.stack_id, shape_handle, "reason")

      assert_receive {Electric.ShapeCache.ShapeCleaner, :cleanup, ^shape_handle}

      assert [] == :ets.tab2list(table)
    end

    test "UPDATE during pending move-in is converted to INSERT and query result skips duplicate key",
         ctx do
      # This test exposes an edge case where:
      # 1. A move-in query starts (snapshot xmin = 90)
      # 2. An UPDATE (xid = 100) arrives and is converted to INSERT
      # 3. Move-in query completes with the same key
      # 4. EXPECTED: Query result should skip the key (already processed at xid 100 > snapshot xmin 90)
      # 5. ACTUAL BUG: Query result creates a duplicate INSERT

      parent = self()

      # Mock query_move_in_async to simulate a query without hitting the database
      Repatch.patch(
        Electric.Shapes.PartialModes,
        :query_move_in_async,
        [mode: :shared],
        fn _task_sup, _shape_handle, _shape, _where_clause, opts ->
          consumer_pid = opts[:consumer_pid]
          name = opts[:move_in_name]
          results_fn = opts[:results_fn]

          send(parent, {:query_requested, name, consumer_pid, results_fn})

          :ok
        end
      )

      Support.TestUtils.activate_mocks_for_descendant_procs(Consumer)

      {shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_subquery, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      {:ok, shape} = Electric.Shapes.fetch_shape_by_handle(ctx.stack_id, shape_handle)
      [_dep_handle] = shape.shape_dependencies_handles

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      ShapeLogCollector.handle_event(
        transaction(100, Lsn.from_integer(50), [
          %Changes.NewRecord{
            relation: {"public", "other_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(Lsn.from_integer(50), 0)
          }
        ]),
        ctx.stack_id
      )

      assert_receive {:query_requested, name, ^consumer_pid, results_fn}

      # Snapshot here is intentionally before the update to make sure the update is considered shadowing
      send(consumer_pid, {:pg_snapshot_known, name, {90, 95, []}})

      # Now send an UPDATE (xid = 100) before move-in query completes
      # This should be converted to INSERT
      lsn = Lsn.from_integer(100)
      xid = 100

      txn =
        transaction(xid, lsn, [
          %Changes.UpdatedRecord{
            relation: {"public", "test_table"},
            old_record: %{"id" => "1"},
            key: "\"public\".\"test_table\"/\"1\"",
            record: %{"id" => "1", "value" => "updated"},
            log_offset: LogOffset.new(lsn, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      # Should get new_changes notification for the UPDATE-as-INSERT
      assert_receive {^ref, :new_changes, _offset}, @receive_timeout

      # Now write data for the move-in query
      results_fn.(
        [
          [
            "\"public\".\"test_table\"/\"1\"",
            ["tag_does_not_matter"],
            Jason.encode!(%{"value" => %{"id" => "1", "value" => "old"}})
          ]
        ],
        {90, 95, []}
      )

      send(consumer_pid, {:query_move_in_complete, name, ["test_key"], {90, 95, []}})

      assert_receive {^ref, :new_changes, _offset}, @receive_timeout

      # Check storage for operations
      shape_storage = Storage.for_shape(shape_handle, ctx.storage)

      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "value" => %{"id" => "1", "value" => "updated"}
               },
               %{
                 "headers" => %{
                   "control" => "snapshot-end",
                   "xmin" => "90",
                   "xmax" => "95",
                   "xip_list" => []
                 }
               }
             ] =
               Storage.get_log_stream(LogOffset.last_before_real_offsets(), shape_storage)
               |> Enum.map(&Jason.decode!/1)
    end
  end

  defp refute_storage_calls_for_txn_fragment(shape_handle) do
    refute_receive {Support.TestStorage, :append_to_log!, ^shape_handle, _}
    refute_receive {Support.TestStorage, :append_fragment_to_log!, ^shape_handle, _}
    refute_receive {Support.TestStorage, :signal_txn_commit!, ^shape_handle, _}
  end

  defp transaction(xid, lsn, changes) do
    [%{log_offset: last_log_offset} | _] = Enum.reverse(changes)

    %TransactionFragment{
      xid: xid,
      lsn: lsn,
      last_log_offset: last_log_offset,
      has_begin?: true,
      commit: %Commit{},
      changes: changes,
      affected_relations: MapSet.new(changes, & &1.relation)
    }
  end

  defp assert_consumer_shutdown(stack_id, shape_handle, fun, timeout \\ 5000) do
    monitors =
      for name <- [
            Shapes.Consumer.name(stack_id, shape_handle),
            Shapes.Consumer.Snapshotter.name(stack_id, shape_handle)
          ],
          pid = GenServer.whereis(name) do
        ref = Process.monitor(pid)
        {ref, pid}
      end

    fun.()

    for {ref, pid} <- monitors do
      assert_receive {:DOWN, ^ref, :process, ^pid, reason}
                     when reason in [:shutdown, {:shutdown, :cleanup}],
                     timeout
    end
  end
end
