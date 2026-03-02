defmodule Electric.Shapes.ConsumerTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit, assert_expectations: true

  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
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
      assert_shape_cleanup: 1,
      complete_txn_fragment: 3,
      txn_fragments: 3,
      txn_fragment: 4
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
        complete_txn_fragment(xmin, lsn, [
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
        complete_txn_fragment(xid, next_lsn, [
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
        complete_txn_fragment(xid, lsn, [
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
        complete_txn_fragment(xid, lsn, [
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
        complete_txn_fragment(xid, lsn, [
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
        complete_txn_fragment(xid, lsn, [
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
        complete_txn_fragment(xid, lsn, [
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
      delay_snapshot_creation? = Map.get(ctx, :delay_snapshot_creation?)
      test_pid = self()

      patch_snapshotter(fn parent, shape_handle, _shape, %{snapshot_fun: snapshot_fun} ->
        if delay_snapshot_creation? do
          receive do
            {^test_pid, :resume} -> :ok
          end
        end

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

      if not Map.get(ctx, :allow_subqueries, true) do
        Electric.StackConfig.put(ctx.stack_id, :feature_flags, [])
      end

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

    test "duplicate transaction handling is idempotent", ctx do
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      xid = 11
      lsn = Lsn.from_integer(10)

      txn =
        complete_txn_fragment(xid, lsn, [
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

      consumer_pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      shape_storage = Storage.for_shape(shape_handle, ctx.storage)
      enable_storage_tracer_for(consumer_pid)

      # The event is a transaction fragment containing the entire transaction, therefore
      # we expect a single Storage.append_to_log!() call for it.
      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert [
               {Storage, :append_to_log!,
                [
                  [
                    {_, ~s'"public"."test_table"/"1"', :insert, _},
                    {_, ~s'"public"."test_table"/"2"', :insert, _}
                  ],
                  _
                ]}
             ] = Support.StorageTracer.collect_traced_calls()

      last_log_offset = LogOffset.new(lsn, 2)
      assert_receive {^ref, :new_changes, ^last_log_offset}

      assert [op1, op2] =
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      # If we encounter & store the same transaction, no new storage calls are expected.
      # In fact, ShapeLogCollector will simply drop this txn since it's already seen its offset before.
      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert [] == Support.StorageTracer.collect_traced_calls()

      # We should not re-process the same transaction
      refute_receive {^ref, :new_changes, _}

      assert [op1, op2] ==
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)
    end

    @tag allow_subqueries: false
    test "duplicate txn fragment handling is idempotent", ctx do
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      xid = 11
      lsn = Lsn.from_integer(10)

      [f1, f2, f3, f4] =
        txn_fragments(xid, lsn, [
          %{
            has_begin?: true,
            changes: [
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
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "3"},
                log_offset: LogOffset.new(lsn, 4)
              }
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "4"},
                log_offset: LogOffset.new(lsn, 6)
              }
            ]
          },
          %{
            has_commit?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "5"},
                log_offset: LogOffset.new(lsn, 8)
              }
            ]
          }
        ])

      consumer_pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      enable_storage_tracer_for(consumer_pid)

      assert :ok = ShapeLogCollector.handle_event(f1, ctx.stack_id)

      assert [
               {Storage, :append_fragment_to_log!,
                [
                  [
                    {_, ~s'"public"."test_table"/"1"', :insert, _},
                    {_, ~s'"public"."test_table"/"2"', :insert, _}
                  ],
                  _
                ]}
             ] = Support.StorageTracer.collect_traced_calls()

      # Repeat and observe idempotency
      assert :ok = ShapeLogCollector.handle_event(f1, ctx.stack_id)
      assert [] == Support.StorageTracer.collect_traced_calls()

      assert :ok = ShapeLogCollector.handle_event(f2, ctx.stack_id)
      assert :ok = ShapeLogCollector.handle_event(f3, ctx.stack_id)

      assert [
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"3"', :insert, _}], _]},
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"4"', :insert, _}], _]}
             ] = Support.StorageTracer.collect_traced_calls()

      # Repeat and observe idempotency
      assert :ok = ShapeLogCollector.handle_event(f2, ctx.stack_id)
      assert :ok = ShapeLogCollector.handle_event(f3, ctx.stack_id)
      assert [] == Support.StorageTracer.collect_traced_calls()

      assert :ok = ShapeLogCollector.handle_event(f4, ctx.stack_id)

      assert [
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"5"', :insert, _}], _]},
               {Storage, :signal_txn_commit!, [^xid, _]}
             ] = Support.StorageTracer.collect_traced_calls()

      last_log_offset = LogOffset.new(lsn, 8)
      assert_receive {^ref, :new_changes, ^last_log_offset}

      # Repeat and observe idempotency
      assert :ok = ShapeLogCollector.handle_event(f4, ctx.stack_id)
      assert [] == Support.StorageTracer.collect_traced_calls()
      refute_receive {^ref, :new_changes, _}
    end

    @tag pg_snapshot: {10, 13, [10, 12]},
         delay_snapshot_creation?: true,
         with_pure_file_storage_opts: [flush_period: 1]
    test "transactions are buffered until snapshot xmin is known", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      assert_receive {:snapshot, ^shape_handle, snapshotter_pid}

      lsn1 = Lsn.from_integer(9)
      lsn2 = Lsn.from_integer(10)
      lsn3 = Lsn.from_integer(11)
      lsn4 = Lsn.from_integer(12)
      lsn5 = Lsn.from_integer(13)

      # This transaction will be considered flushed because its xid < snapshot's xmin
      txn1 =
        complete_txn_fragment(9, lsn1, [
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

      # This transaction will be written to storage because its xid is in snapshot's xip_list
      txn2 =
        complete_txn_fragment(10, lsn2, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "3"},
            log_offset: LogOffset.new(lsn2, 0)
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "4"},
            log_offset: LogOffset.new(lsn2, 2)
          }
        ])

      # This transaction will be considered flushed because its xid > snapshot's xmin but it's not in xip_list
      txn3 =
        complete_txn_fragment(11, lsn3, [
          %Changes.UpdatedRecord{
            key: ~s'"public"."test_table"/"1"',
            relation: {"public", "test_table"},
            old_record: %{"id" => "1"},
            record: %{"id" => "1", "ha" => "ha"},
            log_offset: LogOffset.new(lsn3, 0)
          }
        ])

      # This transaction will be written to storage because its xid is in snapshot's xip_list
      txn4 =
        complete_txn_fragment(12, lsn4, [
          %Changes.DeletedRecord{
            relation: {"public", "test_table"},
            old_record: %{"id" => "3"},
            log_offset: LogOffset.new(lsn4, 0)
          }
        ])

      # This transaction will be written to storage (with no filtering applied) because its xid >= snapshot's xmax
      txn5 =
        complete_txn_fragment(13, lsn5, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "5"},
            log_offset: LogOffset.new(lsn5, 0)
          }
        ])

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      consumer_pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      enable_storage_tracer_for(consumer_pid)

      Enum.each([txn1, txn2, txn3, txn4, txn5], fn txn ->
        assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      end)

      # No storage calls and no new changes at this point because the consumer process does not yet have snapshot info.
      assert [] == Support.StorageTracer.collect_traced_calls()
      refute_receive {^ref, :new_changes, _}
      refute_receive {:flush_boundary_updated, _}

      shape_storage = Storage.for_shape(shape_handle, ctx.storage)

      assert [] ==
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      # Make the actual snapshot
      send(snapshotter_pid, {self(), :resume})
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      # Verify storage calls and new change notifications
      last_log_offset_txn2 = LogOffset.new(lsn2, 2)
      assert_receive {^ref, :new_changes, ^last_log_offset_txn2}
      last_log_offset_txn4 = LogOffset.new(lsn4, 0)
      assert_receive {^ref, :new_changes, ^last_log_offset_txn4}
      last_log_offset_txn5 = LogOffset.new(lsn5, 0)
      assert_receive {^ref, :new_changes, ^last_log_offset_txn5}
      refute_receive {^ref, :new_changes, _}

      assert [
               {Storage, :append_to_log!, [log_items_txn2, _]},
               {Storage, :append_to_log!, [log_items_txn4, _]},
               {Storage, :append_to_log!, [log_items_txn5, _]}
             ] = Support.StorageTracer.collect_traced_calls()

      traced_log_items =
        Stream.concat([log_items_txn2, log_items_txn4, log_items_txn5])
        |> Enum.map(fn {_log_offset, _key, _op, json} -> Jason.decode!(json) end)

      assert 4 == length(traced_log_items)

      assert traced_log_items ==
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      # Verify that the last transaction is successfully flushed and the replication client can confirm its offset
      tx_offset = last_log_offset_txn5.tx_offset
      assert_receive {:flush_boundary_updated, ^tx_offset}
    end

    @tag allow_subqueries: false,
         delay_snapshot_creation?: true,
         with_pure_file_storage_opts: [flush_period: 1]
    test "transaction fragments are buffered until snapshot xmin is known", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      assert_receive {:snapshot, ^shape_handle, snapshotter_pid}

      xid1 = 90
      lsn1 = Lsn.from_integer(9)

      xid2 = 100
      lsn2 = Lsn.from_integer(10)

      txn1_fragments =
        txn_fragments(xid1, lsn1, [
          %{
            has_begin?: true,
            changes: [
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
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "3"},
                log_offset: LogOffset.new(lsn1, 4)
              }
            ]
          },
          %{
            has_commit?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "4"},
                log_offset: LogOffset.new(lsn1, 6)
              }
            ]
          }
        ])

      txn2_fragments =
        txn_fragments(xid2, lsn2, [
          %{
            has_begin?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "5"},
                log_offset: LogOffset.new(lsn2, 0)
              },
              %Changes.UpdatedRecord{
                relation: {"public", "test_table"},
                old_record: %{"id" => "1"},
                record: %{"id" => "1", "foo" => "bar"},
                log_offset: LogOffset.new(lsn2, 2),
                changed_columns: MapSet.new(["foo"])
              }
            ]
          },
          %{
            changes: [
              %Changes.UpdatedRecord{
                relation: {"public", "test_table"},
                old_record: %{"id" => "3"},
                record: %{"id" => "3", "another" => "update"},
                log_offset: LogOffset.new(lsn2, 4),
                changed_columns: MapSet.new(["another"])
              }
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "6"},
                log_offset: LogOffset.new(lsn2, 6)
              }
            ]
          },
          %{
            has_commit?: true,
            changes: [
              %Changes.DeletedRecord{
                relation: {"public", "test_table"},
                old_record: %{"id" => "2"},
                log_offset: LogOffset.new(lsn2, 8)
              }
            ]
          }
        ])

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      consumer_pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      enable_storage_tracer_for(consumer_pid)

      Enum.each(txn1_fragments, fn fragment ->
        assert :ok = ShapeLogCollector.handle_event(fragment, ctx.stack_id)
      end)

      [txn2_f1, txn2_f2, txn2_f3, txn2_f4] = txn2_fragments
      assert :ok = ShapeLogCollector.handle_event(txn2_f1, ctx.stack_id)
      assert :ok = ShapeLogCollector.handle_event(txn2_f2, ctx.stack_id)

      # No storage calls and no new changes at this point because the consumer process does not yet have snapshot info.
      assert [] == Support.StorageTracer.collect_traced_calls()

      refute_receive {^ref, :new_changes, _}
      refute_receive {:flush_boundary_updated, _}

      shape_storage = Storage.for_shape(shape_handle, ctx.storage)

      assert [] ==
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      # The latest storage offset is the initial value since no snapshot has been written yet
      assert {:ok, LogOffset.last_before_real_offsets()} ==
               Storage.fetch_latest_offset(shape_storage)

      # Make the actual snapshot
      send(snapshotter_pid, {self(), :resume})
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      # Observe that the first txn gets written to storage and flushed, but the second one is still in progress.
      last_log_offset = LogOffset.new(lsn1, 6)
      assert_receive {^ref, :new_changes, ^last_log_offset}

      assert [
               # 1st txn
               {Storage, :append_fragment_to_log!,
                [
                  [
                    {_, ~s'"public"."test_table"/"1"', :insert, _},
                    {_, ~s'"public"."test_table"/"2"', :insert, _}
                  ] = log_items1,
                  _
                ]},
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"3"', :insert, _}] = log_items2, _]},
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"4"', :insert, _}] = log_items3, _]},
               {Storage, :signal_txn_commit!, [^xid1, _]},
               # 2nd txn, incomplete
               {Storage, :append_fragment_to_log!,
                [
                  [
                    {_, ~s'"public"."test_table"/"5"', :insert, _},
                    {_, ~s'"public"."test_table"/"1"', :update, _}
                  ] = log_items_txn2_1,
                  _
                ]},
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"3"', :update, _}] = log_items_txn2_2, _]}
             ] = Support.StorageTracer.collect_traced_calls()

      traced_log_items =
        Stream.concat([log_items1, log_items2, log_items3])
        |> Enum.map(fn {_log_offset, _key, _op, json} -> Jason.decode!(json) end)

      assert 4 == length(traced_log_items)

      assert traced_log_items ==
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      assert {:ok, last_log_offset} == Storage.fetch_latest_offset(shape_storage)

      # Feed the remaining txn2 fragments to the consumer and observe the 2nd transaction getting flushed
      assert :ok = ShapeLogCollector.handle_event(txn2_f3, ctx.stack_id)

      # 2nd txn is still not visible in storage
      assert [] == get_log_items_from_storage(last_log_offset, shape_storage)

      assert :ok = ShapeLogCollector.handle_event(txn2_f4, ctx.stack_id)

      last_log_offset = LogOffset.new(lsn2, 8)
      assert_receive {^ref, :new_changes, ^last_log_offset}

      tx_offset = last_log_offset.tx_offset
      assert_receive {:flush_boundary_updated, ^tx_offset}

      assert [
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"6"', :insert, _}] = log_items_txn2_3, _]},
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"2"', :delete, _}] = log_items_txn2_4, _]},
               {Storage, :signal_txn_commit!, [^xid2, _]}
             ] = Support.StorageTracer.collect_traced_calls()

      traced_log_items =
        Stream.concat([log_items_txn2_1, log_items_txn2_2, log_items_txn2_3, log_items_txn2_4])
        |> Enum.map(fn {_log_offset, _key, _op, json} -> Jason.decode!(json) end)

      assert 5 == length(traced_log_items)

      assert traced_log_items ==
               get_log_items_from_storage(LogOffset.new(lsn1, 6), shape_storage)

      assert {:ok, last_log_offset} == Storage.fetch_latest_offset(shape_storage)
    end

    @tag allow_subqueries: false,
         pg_snapshot: {10, 13, [10]},
         with_pure_file_storage_opts: [flush_period: 1]
    test "fragments that belong to transactions already included in the snapshot are skipped",
         ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      lsn1 = Lsn.from_integer(9)
      lsn2 = Lsn.from_integer(10)
      lsn3 = Lsn.from_integer(11)

      # Txn 1 (xid=9 < xmin=10): will be considered flushed, all fragments skipped
      txn1_fragments =
        txn_fragments(9, lsn1, [
          %{
            has_begin?: true,
            changes: [
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
            ]
          },
          %{
            has_commit?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "3"},
                log_offset: LogOffset.new(lsn1, 4)
              }
            ]
          }
        ])

      # Txn 2 (xid=10 in xip_list): will be written to storage
      txn2_fragments =
        txn_fragments(10, lsn2, [
          %{
            has_begin?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "10"},
                log_offset: LogOffset.new(lsn2, 0)
              }
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "11"},
                log_offset: LogOffset.new(lsn2, 2)
              }
            ]
          },
          %{
            has_commit?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "12"},
                log_offset: LogOffset.new(lsn2, 4)
              }
            ]
          }
        ])

      # Txn 3 (xid=11, >= xmin but not in xip_list): will be considered flushed
      txn3_fragments =
        txn_fragments(11, lsn3, [
          %{
            has_begin?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "20"},
                log_offset: LogOffset.new(lsn3, 0)
              }
            ]
          },
          %{
            has_commit?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "21"},
                log_offset: LogOffset.new(lsn3, 2)
              }
            ]
          }
        ])

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      consumer_pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      enable_storage_tracer_for(consumer_pid)

      # Send all fragments before snapshot is known - they should be buffered
      Enum.each(txn1_fragments ++ txn2_fragments ++ txn3_fragments, fn frag ->
        assert :ok = ShapeLogCollector.handle_event(frag, ctx.stack_id)
      end)

      # Verify storage calls
      # Only txn2 (xid=10, in xip_list) should be written to storage
      # txn1 (xid=9 < xmin) and txn3 (xid=11, not in xip_list) should be skipped
      txn2_offset1 = LogOffset.new(lsn2, 0)
      txn2_offset2 = LogOffset.new(lsn2, 2)
      txn2_offset3 = LogOffset.new(lsn2, 4)

      assert [
               {Storage, :append_fragment_to_log!,
                [[{^txn2_offset1, ~s'"public"."test_table"/"10"', :insert, _}], _]},
               {Storage, :append_fragment_to_log!,
                [[{^txn2_offset2, ~s'"public"."test_table"/"11"', :insert, _}], _]},
               {Storage, :append_fragment_to_log!,
                [[{^txn2_offset3, ~s'"public"."test_table"/"12"', :insert, _}], _]},
               {Storage, :signal_txn_commit!, [10, _]}
             ] = Support.StorageTracer.collect_traced_calls()

      last_log_offset = txn2_offset3
      assert_receive {^ref, :new_changes, ^last_log_offset}
      refute_receive {^ref, :new_changes, _}

      # Verify the shape log only contains txn2's records
      shape_storage = Storage.for_shape(shape_handle, ctx.storage)

      assert [
               %{"key" => ~s'"public"."test_table"/"10"', "value" => %{"id" => "10"}},
               %{"key" => ~s'"public"."test_table"/"11"', "value" => %{"id" => "11"}},
               %{
                 "key" => ~s'"public"."test_table"/"12"',
                 "value" => %{"id" => "12"},
                 "headers" => %{"last" => true}
               }
             ] = get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      # Verify flush boundary is updated to the last transaction's offset
      # txn3 (lsn3) is the last transaction processed, even though it was skipped
      tx_offset = Lsn.to_integer(lsn3)
      assert_receive {:flush_boundary_updated, ^tx_offset}
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
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape3, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      lsn = Lsn.from_integer(10)

      txn =
        complete_txn_fragment(10, lsn, [
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
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)
      lsn2 = Lsn.from_integer(301)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      txn =
        complete_txn_fragment(2, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn1, 0)
          }
        ])

      txn2 =
        complete_txn_fragment(11, lsn2, [
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
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)
      ref = Process.monitor(consumer_pid)

      txn =
        complete_txn_fragment(2, lsn1, [
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
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_subquery, ctx.stack_id)

      lsn1 = Lsn.from_integer(300)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)

      assert {:ok, shape} = Electric.Shapes.fetch_shape_by_handle(ctx.stack_id, shape_handle)

      assert [dependent_shape_handle] = shape.shape_dependencies_handles

      txn =
        complete_txn_fragment(2, lsn1, [
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
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)
      ref = Process.monitor(consumer_pid)

      txn =
        complete_txn_fragment(2, lsn1, [
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

    @tag allow_subqueries: false, with_pure_file_storage_opts: [flush_period: 1]
    test "writes txn fragments to storage immediately but keeps txn boundaries when flushing",
         ctx do
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      register_as_replication_client(ctx.stack_id)

      xid = 11
      lsn = Lsn.from_integer(10)

      fragments =
        txn_fragments(xid, lsn, [
          %{
            has_begin?: true,
            changes: [
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
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "3"},
                log_offset: LogOffset.new(lsn, 4)
              }
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "4"},
                log_offset: LogOffset.new(lsn, 6)
              }
            ]
          }
        ])

      expected_log_items = [
        [
          {LogOffset.new(lsn, 0), ~s'"public"."test_table"/"1"', :insert},
          {LogOffset.new(lsn, 2), ~s'"public"."test_table"/"2"', :insert}
        ],
        [{LogOffset.new(lsn, 4), ~s'"public"."test_table"/"3"', :insert}],
        [{LogOffset.new(lsn, 6), ~s'"public"."test_table"/"4"', :insert}]
      ]

      consumer_pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      shape_storage = Storage.for_shape(shape_handle, ctx.storage)
      enable_storage_tracer_for(consumer_pid)

      Enum.zip(fragments, expected_log_items)
      |> Enum.each(fn {fragment, expected_log_items} ->
        assert :ok = ShapeLogCollector.handle_event(fragment, ctx.stack_id)

        assert [{Storage, :append_fragment_to_log!, [log_items, _]}] =
                 Support.StorageTracer.collect_traced_calls()

        assert expected_log_items ==
                 Enum.map(log_items, fn {log_offset, key, op, _json} -> {log_offset, key, op} end)
      end)

      # Nothing should be returned from the shape log until a fragment containing Commit is stored
      assert [] ==
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      # The latest storage offset corresponds to the only persisted snapshot chunk
      assert {:ok, LogOffset.new(0, 0)} == Storage.fetch_latest_offset(shape_storage)

      refute_receive {^ref, :new_changes, _}
      refute_receive {:flush_boundary_updated, _}

      commit_fragment =
        txn_fragment(
          xid,
          lsn,
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "5"},
              log_offset: LogOffset.new(lsn, 8)
            }
          ],
          has_commit?: true
        )

      assert :ok = ShapeLogCollector.handle_event(commit_fragment, ctx.stack_id)

      last_log_offset = LogOffset.new(lsn, 8)

      assert [
               {Storage, :append_fragment_to_log!,
                [[{^last_log_offset, ~s'"public"."test_table"/"5"', :insert, _json}], _]},
               {Storage, :signal_txn_commit!, [^xid, _]}
             ] = Support.StorageTracer.collect_traced_calls()

      assert [
               %{"key" => ~s'"public"."test_table"/"1"', "value" => %{"id" => "1"}},
               %{"key" => ~s'"public"."test_table"/"2"', "value" => %{"id" => "2"}},
               %{"key" => ~s'"public"."test_table"/"3"', "value" => %{"id" => "3"}},
               %{"key" => ~s'"public"."test_table"/"4"', "value" => %{"id" => "4"}},
               %{
                 "key" => ~s'"public"."test_table"/"5"',
                 "value" => %{"id" => "5"},
                 "headers" => %{"last" => true}
               }
             ] = get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      assert {:ok, last_log_offset} == Storage.fetch_latest_offset(shape_storage)

      assert_receive {^ref, :new_changes, ^last_log_offset}

      offset = last_log_offset.tx_offset
      assert_receive {:flush_boundary_updated, ^offset}
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
        complete_txn_fragment(100, Lsn.from_integer(50), [
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
        complete_txn_fragment(xid, lsn, [
          %Changes.UpdatedRecord{
            relation: {"public", "test_table"},
            old_record: %{"id" => "1"},
            key: ~s'"public"."test_table"/"1"',
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
             ] = get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)
    end
  end

  defp refute_storage_calls_for_txn_fragment(shape_handle) do
    refute_receive {Support.TestStorage, :append_to_log!, ^shape_handle, _}
    refute_receive {Support.TestStorage, :append_fragment_to_log!, ^shape_handle, _}
    refute_receive {Support.TestStorage, :signal_txn_commit!, ^shape_handle, _}
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

  defp enable_storage_tracer_for(consumer_pid) do
    Support.StorageTracer.trace_storage_calls(
      pid: consumer_pid,
      functions: [:append_to_log!, :append_fragment_to_log!, :signal_txn_commit!]
    )
  end

  # Make the test process pose as a replication client to receive flush notifications from ShapeLogCollector
  defp register_as_replication_client(stack_id) do
    {:via, Registry, {reg_name, key}} = Electric.Postgres.ReplicationClient.name(stack_id)
    Registry.register(reg_name, key, nil)
  end

  defp get_log_items_from_storage(offset, shape_storage) do
    Storage.get_log_stream(offset, shape_storage) |> Enum.map(&Jason.decode!/1)
  end
end
