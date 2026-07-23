defmodule Electric.Replication.ShapeLogCollectorTest do
  use ExUnit.Case, async: false
  use Repatch.ExUnit, assert_expectations: true

  alias Electric.LsnTracker
  alias Electric.Postgres.Lsn
  alias Electric.Replication.PersistentReplicationState
  alias Electric.Replication.ShapeLogCollector
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.Commit
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes.TransactionFragment
  alias Electric.Shapes.Shape
  alias Electric.StatusMonitor

  alias Support.Fixtures
  alias Support.RepatchExt

  import Support.TestUtils,
    only: [
      patch_calls: 3,
      expect_calls: 2,
      register_as_replication_client: 1,
      complete_txn_fragment: 3
    ]

  import Support.ComponentSetup

  @moduletag :tmp_dir

  setup [
    :with_stack_id_from_test,
    :with_in_memory_storage,
    :with_shape_status,
    :with_lsn_tracker,
    :with_noop_publication_manager,
    :with_persistent_kv
  ]

  @inspector Support.StubInspector.new(
               tables: [{1234, {"public", "test_table"}}],
               columns: [%{name: "id", type: "int8", pk_position: 0}]
             )

  @shape Shape.new!("test_table", inspector: @inspector)
  @shape_handle "the-shape-handle"

  @subquery_inspector Support.StubInspector.new(
                        tables: [{1234, {"public", "test_table"}}, {5678, {"public", "parent"}}],
                        columns: [%{name: "id", type: "int8", type_id: {20, 1}, pk_position: 0}]
                      )
  @subquery_shape Shape.new!("test_table",
                    inspector: @subquery_inspector,
                    where: "id IN (SELECT id FROM public.parent)"
                  )
  @subquery_shape_handle "subquery-shape-handle"

  def setup_log_collector(ctx) do
    %{stack_id: stack_id} = ctx
    # Start a test Registry
    registry_name = Module.concat(__MODULE__, Registry)
    start_link_supervised!({Registry, keys: :duplicate, name: registry_name})

    existing_shapes = Map.get(ctx, :restore_shapes, [])

    Repatch.patch(Electric.ShapeCache.ShapeStatus, :list_shapes, [mode: :shared], fn ^stack_id ->
      existing_shapes
    end)

    Support.TestUtils.activate_mocks_for_descendant_procs(ShapeLogCollector)

    inspector = Map.get(ctx, :inspector, {Mock.Inspector, elem(@inspector, 1)})

    # Start the ShapeLogCollector process
    opts = [
      stack_id: stack_id,
      inspector: inspector,
      persistent_kv: ctx.persistent_kv,
      consumer_registry_opts: Map.get(ctx, :consumer_registry_opts, [])
    ]

    {:ok, _pid} = start_supervised({ShapeLogCollector.Supervisor, opts})

    parent = self()

    Repatch.patch(StatusMonitor, :mark_shape_log_collector_ready, [mode: :shared], fn _, _ ->
      send(parent, :shape_log_collector_ready)
      :ok
    end)

    shape_cache_opts =
      [
        stack_id: stack_id
      ]

    shape_cache_pid = start_link_supervised!({Electric.ShapeCache, shape_cache_opts})

    assert_receive :shape_log_collector_ready, 1000

    %{stack_id: stack_id, registry: registry_name, shape_cache: shape_cache_pid}
  end

  describe "process gc configuration" do
    setup :setup_log_collector

    @tag process_spawn_opts: %{
           shape_log_collector: [priority: :high, min_bin_vheap_size: 1024 * 1024]
         }
    test "are correctly passed to process", ctx do
      pid = ShapeLogCollector.name(ctx.stack_id) |> GenServer.whereis()

      info = Process.info(pid)

      assert :high == info[:priority]
      assert info[:garbage_collection][:min_bin_vheap_size] >= 1024 * 1024
    end
  end

  describe "shape restoration with flaky introspection" do
    setup _ctx do
      # The collector restores shapes as soon as it starts inside
      # setup_log_collector, so the inspector has to be patched before that
      # setup runs.
      attempts = :counters.new(1, [])

      patch_calls(Electric.Postgres.Inspector, [],
        load_relation_info: fn 1234, _ ->
          if :counters.get(attempts, 1) < 2 do
            :counters.add(attempts, 1, 1)
            {:error, :connection_not_available}
          else
            {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}
          end
        end
      )

      %{introspection_attempts: attempts}
    end

    setup :setup_log_collector

    @tag capture_log: true
    @tag restore_shapes: [{@shape_handle, @shape}], inspector: @inspector
    test "retries introspection until the connection becomes available and restores the shape",
         ctx do
      pid = ShapeLogCollector.name(ctx.stack_id) |> GenServer.whereis()
      assert is_pid(pid)
      assert Process.alive?(pid)

      # The retry loop should have hit the connection error twice before
      # succeeding, otherwise this test would pass even if retrying were broken.
      assert :counters.get(ctx.introspection_attempts, 1) == 2

      # Survival isn't enough: prove the shape was actually restored by routing a
      # transaction through it. If restore had given up (or skipped the shape),
      # the EventRouter wouldn't know about it and nothing would be consumed.
      parent = self()
      xmin = 100
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      consumer =
        start_link_supervised!(
          {Support.TransactionConsumer,
           [
             id: 1,
             stack_id: ctx.stack_id,
             parent: parent,
             shape: @shape,
             shape_handle: @shape_handle,
             action: :restore
           ]}
        )

      :ok =
        Electric.Shapes.ConsumerRegistry.register_consumer(consumer, @shape_handle, ctx.stack_id)

      txn =
        complete_txn_fragment(xmin, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2", "name" => "foo"},
            log_offset: last_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert [^xmin] = Support.TransactionConsumer.assert_consume([{1, consumer}], [txn])
    end
  end

  describe "shape restoration" do
    setup :setup_log_collector

    @tag restore_shapes: [{@shape_handle, @shape}], inspector: @inspector
    test "populates the filter, partitions and layers from the shape_status table", ctx do
      parent = self()

      xmin = 100
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      consumer =
        start_link_supervised!(
          {Support.TransactionConsumer,
           [
             id: 1,
             stack_id: ctx.stack_id,
             parent: parent,
             shape: @shape,
             shape_handle: @shape_handle,
             stack_id: ctx.stack_id,
             action: :restore
           ]}
        )

      # since we're starting the consumer manually we have to explictly register it
      :ok =
        Electric.Shapes.ConsumerRegistry.register_consumer(consumer, @shape_handle, ctx.stack_id)

      txn =
        complete_txn_fragment(xmin, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2", "name" => "foo"},
            log_offset: last_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      xids = Support.TransactionConsumer.assert_consume([{1, consumer}], [txn])
      assert xids == [xmin]
    end

    @tag restore_shapes: [{@subquery_shape_handle, @subquery_shape}],
         inspector: @subquery_inspector
    test "restore skips subquery shapes instead of adding them to routing", ctx do
      alias Electric.Shapes.Filter.Indexes.SubqueryIndex

      # Shapes involved in a subquery are dropped (not restored) on restart —
      # see `ShapeCache.drop_subquery_shapes/1` — so the collector must skip a
      # restored subquery shape rather than reinstate it into the routing
      # indexes. It is therefore neither active nor seeded into the SubqueryIndex.
      refute @subquery_shape_handle in ShapeLogCollector.active_shapes(ctx.stack_id)

      index = SubqueryIndex.for_stack(ctx.stack_id)
      refute index != nil and SubqueryIndex.fallback?(index, @subquery_shape_handle)
    end

    @tag restore_shapes: [{@shape_handle, @shape}, {@shape_handle <> "-2", @shape}],
         inspector: @inspector
    test "sets total_processing_time on the span exactly once for a multi-shape transaction",
         ctx do
      test_pid = self()

      Repatch.patch(
        Electric.Telemetry.OpenTelemetry,
        :add_span_attributes,
        [mode: :shared],
        fn attrs ->
          if Keyword.keyword?(attrs) and Keyword.has_key?(attrs, :total_processing_time) do
            send(
              test_pid,
              {:total_processing_time, Keyword.fetch!(attrs, :total_processing_time)}
            )
          end

          true
        end
      )

      lsn = Lsn.from_string("0/10")

      consumer1 =
        start_link_supervised!(
          {Support.TransactionConsumer,
           id: 1,
           stack_id: ctx.stack_id,
           parent: test_pid,
           shape: @shape,
           shape_handle: @shape_handle,
           action: :restore},
          id: {:consumer, 1}
        )

      consumer2 =
        start_link_supervised!(
          {Support.TransactionConsumer,
           id: 2,
           stack_id: ctx.stack_id,
           parent: test_pid,
           shape: @shape,
           shape_handle: @shape_handle <> "-2",
           action: :restore},
          id: {:consumer, 2}
        )

      :ok =
        Electric.Shapes.ConsumerRegistry.register_consumer(consumer1, @shape_handle, ctx.stack_id)

      :ok =
        Electric.Shapes.ConsumerRegistry.register_consumer(
          consumer2,
          @shape_handle <> "-2",
          ctx.stack_id
        )

      txn =
        complete_txn_fragment(100, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2", "name" => "foo"},
            log_offset: LogOffset.new(lsn, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      # The single incoming fragment is resliced to both shapes by the EventRouter...
      Support.TransactionConsumer.assert_consume([{1, consumer1}, {2, consumer2}], [txn])

      # ...but the wall-clock attribute is set once, on the original incoming commit fragment.
      assert_receive {:total_processing_time, value}
      assert is_integer(value) and value >= 0
      refute_receive {:total_processing_time, _}
    end
  end

  describe "lazy consumer initialization" do
    setup :setup_log_collector

    setup do
      supervisor = start_link_supervised!({DynamicSupervisor, strategy: :one_for_one})
      [supervisor: supervisor]
    end

    setup(ctx) do
      %{stack_id: stack_id} = ctx

      parent = self()

      Repatch.patch(
        Electric.ShapeCache,
        :start_consumer_for_handle,
        [mode: :shared],
        fn shape_handle, ^stack_id, _opts ->
          id = System.unique_integer([:positive, :monotonic])

          with {:ok, pid} <-
                 DynamicSupervisor.start_child(ctx.supervisor, {
                   Support.TransactionConsumer,
                   id: id,
                   stack_id: ctx.stack_id,
                   parent: parent,
                   shape: @shape,
                   shape_handle: shape_handle,
                   action: :restore
                 }) do
            send(parent, {:start_consumer, shape_handle, id, pid})
            {:ok, pid}
          end
        end
      )

      :ok
    end

    @describetag restore_shapes: [{@shape_handle, @shape}], inspector: @inspector
    test "consumers are started when receiving a transaction that matches their filter", ctx do
      xmin = 100
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      txn =
        complete_txn_fragment(xmin, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2", "name" => "foo"},
            log_offset: last_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      assert_receive {:start_consumer, @shape_handle, id, pid}
      xids = Support.TransactionConsumer.assert_consume([{id, pid}], [txn])
      assert xids == [xmin]
    end

    test "consumer exits remove the filter mapping", ctx do
      xmin = 100
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      ShapeLogCollector.monitor(ctx.stack_id)

      txn =
        complete_txn_fragment(xmin, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2", "name" => "foo"},
            log_offset: last_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      assert_receive {:start_consumer, @shape_handle, id, consumer_pid}
      ref = Process.monitor(consumer_pid)
      xids = Support.TransactionConsumer.assert_consume([{id, consumer_pid}], [txn])
      assert xids == [xmin]

      Support.TransactionConsumer.stop(consumer_pid, :normal)

      assert_receive {Support.TransactionConsumer, {^id, ^consumer_pid}, {:terminate, :normal}}
      assert_receive {:DOWN, ^ref, :process, ^consumer_pid, _}

      # the shape has been removed from the filters
      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      refute_receive {:start_consumer, @shape_handle, _id, _consumer_pid}
    end
  end

  defp stub_inspector(opts \\ [], stubs) do
    patch_calls(Electric.Postgres.Inspector, opts, stubs)
  end

  defp expect_inspector(expectations) do
    expect_calls(Electric.Postgres.Inspector, expectations)
  end

  describe "handle_event/2 with transactions" do
    setup :setup_log_collector

    setup ctx do
      parent = self()

      stub_inspector(
        load_relation_oid: fn {"public", "test_table"}, _ ->
          {:ok, {1234, {"public", "test_table"}}}
        end,
        load_relation_info: fn 1234, _ ->
          {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}
        end,
        load_column_info: fn 1234, _ ->
          {:ok, [%{pk_position: 0, name: "id", is_generated: false}]}
        end
      )

      consumers =
        Enum.map(1..3, fn id ->
          consumer =
            start_link_supervised!(%{
              id: {:consumer, id},
              start:
                {Support.TransactionConsumer, :start_link,
                 [
                   [
                     id: id,
                     stack_id: ctx.stack_id,
                     parent: parent,
                     shape: @shape,
                     shape_handle: "#{@shape_handle}-#{id}"
                   ]
                 ]},
              restart: :temporary
            })

          {id, consumer}
        end)

      %{consumers: consumers}
    end

    test "broadcasts keyed changes to consumers", ctx do
      xmin = 100
      xid = 150
      lsn = Lsn.from_string("0/10")
      next_lsn = Lsn.increment(lsn, 1)
      last_log_offset = LogOffset.new(lsn, 0)
      next_log_offset = LogOffset.new(next_lsn, 0)

      txn =
        complete_txn_fragment(xmin, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2", "name" => "foo"},
            log_offset: last_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      xids =
        Support.TransactionConsumer.assert_consume(ctx.consumers, [txn])

      assert xids == [xmin]

      txn2 =
        complete_txn_fragment(xid, next_lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2", "name" => "bar"},
            log_offset: next_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn2, ctx.stack_id)

      xids = Support.TransactionConsumer.assert_consume(ctx.consumers, [txn2])

      assert xids == [xid]
    end

    @transaction_timeout 5
    @num_comparisons 10
    test "drops transactions if already processed", ctx do
      1..@num_comparisons
      |> Enum.reduce({1, 0, 1, 0}, fn _, {xid, prev_xid, lsn_int, prev_lsn_int} ->
        # advance xid and lsn randomly along their potential values to simulate
        # transactions coming in at different points in the DBs lifetime
        xid = xid + (:rand.uniform(2 ** 32 - xid) - 1)
        prev_xid = xid - (:rand.uniform(xid - prev_xid) + 1)
        lsn_int = lsn_int + (:rand.uniform(2 ** 64 - lsn_int) - 1)
        prev_lsn_int = lsn_int - (:rand.uniform(lsn_int - prev_lsn_int) + 1)
        lsn = Lsn.from_integer(lsn_int)
        prev_lsn = Lsn.from_integer(prev_lsn_int)
        log_offset = LogOffset.new(lsn, 0)
        prev_log_offset = LogOffset.new(prev_lsn, 0)

        txn =
          complete_txn_fragment(xid, lsn, [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "2", "name" => "foo"},
              log_offset: log_offset
            }
          ])

        assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

        Support.TransactionConsumer.assert_consume(
          ctx.consumers,
          [txn],
          @transaction_timeout
        )

        txn2 =
          complete_txn_fragment(xid, lsn, [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "2", "name" => "foo"},
              log_offset: log_offset
            }
          ])

        txn3 =
          complete_txn_fragment(prev_xid, prev_lsn, [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "2", "name" => "foo"},
              log_offset: prev_log_offset
            }
          ])

        assert :ok = ShapeLogCollector.handle_event(txn2, ctx.stack_id)
        assert :ok = ShapeLogCollector.handle_event(txn3, ctx.stack_id)
        Support.TransactionConsumer.refute_consume(ctx.consumers, @transaction_timeout * 2)
        {xid, prev_xid, lsn_int, prev_lsn_int}
      end)
    end

    test "drops fragment if already processed", ctx do
      lsn = Lsn.from_integer(100)

      # First fragment - beginning of a transaction (no commit)
      fragment1 = %TransactionFragment{
        xid: 1,
        lsn: lsn,
        last_log_offset: LogOffset.new(lsn, 1),
        has_begin?: true,
        commit: nil,
        changes: [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn, 0)
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2"},
            log_offset: LogOffset.new(lsn, 1)
          }
        ],
        affected_relations: MapSet.new([{"public", "test_table"}])
      }

      # Second fragment - continuation with commit
      fragment2 = %TransactionFragment{
        xid: 1,
        lsn: lsn,
        last_log_offset: LogOffset.new(lsn, 2),
        has_begin?: false,
        commit: %Commit{tx_started_at: System.monotonic_time()},
        changes: [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "3"},
            log_offset: LogOffset.new(lsn, 2)
          }
        ],
        affected_relations: MapSet.new([{"public", "test_table"}])
      }

      assert :ok = ShapeLogCollector.handle_event(fragment1, ctx.stack_id)
      Support.TransactionConsumer.assert_consume(ctx.consumers, [fragment1], @transaction_timeout)

      # Repeat fragment1 - should be dropped
      assert :ok = ShapeLogCollector.handle_event(fragment1, ctx.stack_id)
      Support.TransactionConsumer.refute_consume(ctx.consumers, @transaction_timeout)

      assert :ok = ShapeLogCollector.handle_event(fragment2, ctx.stack_id)
      Support.TransactionConsumer.assert_consume(ctx.consumers, [fragment2], @transaction_timeout)
    end

    test "raises error on partially processed fragment", ctx do
      lsn = Lsn.from_integer(100)

      # First fragment - beginning of a transaction (no commit)
      fragment1 = %TransactionFragment{
        xid: 1,
        lsn: lsn,
        last_log_offset: LogOffset.new(lsn, 1),
        has_begin?: true,
        commit: nil,
        changes: [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn, 0)
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2"},
            log_offset: LogOffset.new(lsn, 1)
          }
        ],
        affected_relations: MapSet.new([{"public", "test_table"}])
      }

      # Second fragment - The first fragment again but a longer batch size this time
      fragment2 = %TransactionFragment{
        xid: 1,
        lsn: lsn,
        last_log_offset: LogOffset.new(lsn, 2),
        has_begin?: true,
        commit: %Commit{tx_started_at: System.monotonic_time()},
        changes: [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn, 0)
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2"},
            log_offset: LogOffset.new(lsn, 1)
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "3"},
            log_offset: LogOffset.new(lsn, 2)
          }
        ],
        affected_relations: MapSet.new([{"public", "test_table"}])
      }

      assert :ok = ShapeLogCollector.handle_event(fragment1, ctx.stack_id)
      Support.TransactionConsumer.assert_consume(ctx.consumers, [fragment1], @transaction_timeout)

      assert {{%RuntimeError{
                 message:
                   "Received TransactionFragment that has already been partially processed." <> _
               }, _}, _} = catch_exit(ShapeLogCollector.handle_event(fragment2, ctx.stack_id))
    end

    # This is a regression test. It used to fail before #2853 was fixed.
    test "succeeds in building a key for a change containing null", ctx do
      stub_inspector(
        load_column_info:
          {fn 1234, _ ->
             {:ok, [%{name: "id", pk_position: nil}, %{name: "name", pk_position: nil}]}
           end, force: true}
      )

      lsn = Lsn.from_integer(1)
      log_offset = LogOffset.new(lsn, 0)

      txn =
        complete_txn_fragment(1, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => nil, "name" => "foo"},
            log_offset: log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
    end

    test "correctly handles flush notifications", ctx do
      lsn = Lsn.from_string("0/10")
      prev_lsn = Lsn.increment(lsn, -1)
      last_log_offset = LogOffset.new(lsn, 0)

      register_as_replication_client(ctx.stack_id)

      irrelevant_txn = complete_txn_fragment(99, prev_lsn, [])

      assert :ok = ShapeLogCollector.handle_event(irrelevant_txn, ctx.stack_id)
      expected_lsn = Lsn.to_integer(prev_lsn)
      assert_receive {:flush_boundary_updated, ^expected_lsn}, 50

      txn =
        complete_txn_fragment(100, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2", "name" => "foo"},
            log_offset: last_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      refute_receive {:flush_boundary_updated, _}, 50

      ShapeLogCollector.notify_flushed(ctx.stack_id, @shape_handle <> "-1", last_log_offset)
      refute_receive {:flush_boundary_updated, _}, 50
      ShapeLogCollector.notify_flushed(ctx.stack_id, @shape_handle <> "-2", last_log_offset)
      refute_receive {:flush_boundary_updated, _}, 50
      ShapeLogCollector.notify_flushed(ctx.stack_id, @shape_handle <> "-3", last_log_offset)

      expected_lsn = Lsn.to_integer(lsn)
      assert_receive {:flush_boundary_updated, ^expected_lsn}, 100
    end

    test "correctly broadcasts flush when transaction is not relevant to any shape", ctx do
      stub_inspector(
        [force: true],
        load_relation_oid: fn {"public", "irrelevant_table"}, _ ->
          {:ok, {1234, {"public", "irrelevant_table"}}}
        end,
        load_relation_info: fn 1234, _ ->
          {:ok,
           %{id: 1234, schema: "public", name: "irrelevant_table", parent: nil, children: nil}}
        end,
        load_column_info: fn 1234, _ ->
          {:ok, [%{pk_position: 0, name: "id", is_generated: false}]}
        end
      )

      register_as_replication_client(ctx.stack_id)

      lsn = Lsn.from_integer(55)
      log_offset = LogOffset.new(lsn, 0)

      txn =
        complete_txn_fragment(100, lsn, [
          %Changes.NewRecord{
            relation: {"public", "irrelevant_table"},
            record: %{"id" => "2", "name" => "foo"},
            log_offset: log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      assert_receive {:flush_boundary_updated, 55}, 50
    end

    test "correctly broadcasts flush when transaction has already been processed before", ctx do
      register_as_replication_client(ctx.stack_id)

      LsnTracker.set_last_processed_lsn(ctx.stack_id, Lsn.from_integer(50))
      assert :ok = ShapeLogCollector.mark_as_ready(ctx.stack_id)

      lsn = Lsn.from_integer(20)
      log_offset = LogOffset.new(lsn, 0)

      txn =
        complete_txn_fragment(100, lsn, [
          %Changes.NewRecord{
            relation: {"public", "irrelevant_table"},
            record: %{"id" => "2", "name" => "foo"},
            log_offset: log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      assert_receive {:flush_boundary_updated, 20}, 50
    end

    test "correctly broadcasts flush when consumers die", ctx do
      register_as_replication_client(ctx.stack_id)

      lsn = Lsn.from_integer(20)
      log_offset = LogOffset.new(lsn, 0)

      txn =
        complete_txn_fragment(100, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2"},
            log_offset: log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      for {id, pid} <- ctx.consumers do
        Process.unlink(pid)
        stop_supervised!({:consumer, id})
      end

      assert_receive {:flush_boundary_updated, 20}, 50
    end

    test "returns error if relation info cannot be loaded", ctx do
      stub_inspector([force: true],
        load_relation_oid: fn {"public", "test_table"}, _ ->
          {:error, :connection_not_available}
        end
      )

      lsn = Lsn.from_integer(1)
      log_offset = LogOffset.new(lsn, 0)

      txn =
        complete_txn_fragment(100, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2", "name" => "foo"},
            log_offset: log_offset
          }
        ])

      assert {:error, :connection_not_available} =
               ShapeLogCollector.handle_event(txn, ctx.stack_id)
    end

    @tag capture_log: true
    test "returns a retryable error and stays alive when column introspection fails unexpectedly",
         ctx do
      stub_inspector([force: true],
        load_relation_oid: fn {"public", "test_table"}, _ ->
          {:ok, {1234, {"public", "test_table"}}}
        end,
        load_column_info: fn 1234, _ ->
          {:error, "ERROR 53200 (out_of_memory) out of memory"}
        end
      )

      lsn = Lsn.from_integer(1)
      log_offset = LogOffset.new(lsn, 0)

      txn =
        complete_txn_fragment(100, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2", "name" => "foo"},
            log_offset: log_offset
          }
        ])

      assert {:error, :connection_not_available} =
               ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert ShapeLogCollector.name(ctx.stack_id) |> GenServer.whereis() |> Process.alive?()
    end

    test "processes the transaction when the table was dropped before introspection", ctx do
      stub_inspector([force: true],
        load_relation_oid: fn {"public", "test_table"}, _ -> :table_not_found end
      )

      lsn = Lsn.from_integer(1)
      log_offset = LogOffset.new(lsn, 0)

      txn =
        complete_txn_fragment(100, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2", "name" => "foo"},
            log_offset: log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert ShapeLogCollector.name(ctx.stack_id) |> GenServer.whereis() |> Process.alive?()
    end
  end

  describe "handle_event/2 with relations" do
    setup :setup_log_collector

    setup ctx do
      parent = self()

      stub_inspector(
        load_relation_oid: fn {"public", "test_table"}, _ ->
          {:ok, {1234, {"public", "test_table"}}}
        end,
        load_relation_info: fn 1234, _ ->
          {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}
        end
      )

      consumers =
        Enum.map(1..3, fn id ->
          consumer =
            start_link_supervised!(%{
              id: {:consumer, id},
              start:
                {Support.TransactionConsumer, :start_link,
                 [
                   [
                     id: id,
                     stack_id: ctx.stack_id,
                     parent: parent,
                     shape: @shape,
                     shape_handle: "#{@shape_handle}-#{id}"
                   ]
                 ]},
              restart: :temporary
            })

          {id, consumer}
        end)

      %{consumers: consumers}
    end

    test "should handle new relations", ctx do
      id = @shape.root_table_id

      stub_inspector(
        [force: true],
        load_relation_oid: fn
          {"public", "test_table"}, _ -> {:ok, {id, {"public", "test_table"}}}
          {"public", "bar"}, _ -> {:ok, {1235, {"public", "bar"}}}
        end,
        load_relation_info: fn
          ^id, _ ->
            {:ok, %{id: id, schema: "public", name: "test_table", parent: nil, children: nil}}

          1235, _ ->
            {:ok, %{id: 1235, schema: "public", name: "bar", parent: nil, children: nil}}
        end
      )

      expect_inspector(
        clean:
          {fn
             ^id, _ -> :ok
             1235, _ -> :ok
           end, exactly: 2}
      )

      relation1 = %Relation{id: id, table: "test_table", schema: "public", columns: []}

      assert :ok = ShapeLogCollector.handle_event(relation1, ctx.stack_id)

      relation2 = %Relation{id: id, table: "bar", schema: "public", columns: []}

      assert :ok = ShapeLogCollector.handle_event(relation2, ctx.stack_id)

      Support.TransactionConsumer.assert_consume(ctx.consumers, [relation1, relation2])
    end

    @tag capture_log: true
    test "returns a retryable error and stays alive when relation introspection fails unexpectedly",
         ctx do
      stub_inspector([force: true],
        load_relation_info: fn 1234, _ ->
          {:error, "ERROR 53200 (out_of_memory) out of memory"}
        end,
        clean: fn _, _ -> :ok end
      )

      relation = %Relation{id: 1234, table: "test_table", schema: "public", columns: []}

      assert {:error, :connection_not_available} =
               ShapeLogCollector.handle_event(relation, ctx.stack_id)

      assert ShapeLogCollector.name(ctx.stack_id) |> GenServer.whereis() |> Process.alive?()
    end

    test "retries changed relation after partition inspection connection error", ctx do
      id = @shape.root_table_id
      {:ok, partition_relation_info_calls} = Agent.start_link(fn -> 0 end)

      stub_inspector([force: true],
        clean: fn ^id, _ -> :ok end,
        load_relation_info: fn ^id, _ ->
          call =
            Agent.get_and_update(partition_relation_info_calls, fn calls ->
              {calls, calls + 1}
            end)

          case call do
            1 ->
              {:error, :connection_not_available}

            _ ->
              {:ok, %{id: id, schema: "public", name: "test_table", parent: nil, children: nil}}
          end
        end
      )

      relation = %Relation{
        id: id,
        table: "test_table",
        schema: "public",
        columns: [%{name: "id", type_oid: {1, 1}}]
      }

      changed_relation = %{
        relation
        | columns: [%{name: "id", type_oid: {2, 1}}]
      }

      assert :ok = ShapeLogCollector.handle_event(relation, ctx.stack_id)

      assert {:error, :connection_not_available} =
               ShapeLogCollector.handle_event(changed_relation, ctx.stack_id)

      assert :ok = ShapeLogCollector.handle_event(changed_relation, ctx.stack_id)
      Support.TransactionConsumer.assert_consume(ctx.consumers, [changed_relation])
    end

    test "does not persist changed relation before routing completes", ctx do
      id = @shape.root_table_id

      stub_inspector([force: true], clean: fn ^id, _ -> :ok end)

      relation = %Relation{
        id: id,
        table: "test_table",
        schema: "public",
        columns: [%{name: "id", type_oid: {1, 1}}]
      }

      changed_relation = %{
        relation
        | columns: [%{name: "id", type_oid: {2, 1}}]
      }

      assert :ok = ShapeLogCollector.handle_event(relation, ctx.stack_id)

      persistence_opts = [stack_id: ctx.stack_id, persistent_kv: ctx.persistent_kv]

      assert %{
               id_to_table_info: %{^id => ^relation},
               table_to_id: %{{"public", "test_table"} => ^id}
             } = PersistentReplicationState.get_tracked_relations(persistence_opts)

      Repatch.patch(Electric.Shapes.Filter, :affected_shapes, [mode: :shared], fn
        _, _ -> raise "routing failed"
      end)

      assert {{%RuntimeError{message: "routing failed"}, _}, _} =
               catch_exit(ShapeLogCollector.handle_event(changed_relation, ctx.stack_id))

      assert %{
               id_to_table_info: %{^id => ^relation},
               table_to_id: %{{"public", "test_table"} => ^id}
             } = PersistentReplicationState.get_tracked_relations(persistence_opts)
    end
  end

  describe "collector not ready" do
    setup ctx do
      {:ok, _pid} =
        start_supervised(
          {ShapeLogCollector.Supervisor,
           stack_id: ctx.stack_id,
           inspector: {Mock.Inspector, elem(@inspector, 1)},
           persistent_kv: ctx.persistent_kv}
        )

      :ok
    end

    test "rejects new transactions", ctx do
      lsn = Lsn.from_string("0/10")

      txn = complete_txn_fragment(100, lsn, [])

      assert {:error, :not_ready} = ShapeLogCollector.handle_event(txn, ctx.stack_id)
    end

    test "rejects relation messages", ctx do
      relation = %Relation{id: 1234, table: "test_table", schema: "public", columns: []}

      assert {:error, :not_ready} = ShapeLogCollector.handle_event(relation, ctx.stack_id)
    end
  end

  test "closes the loop even with no active shapes", ctx do
    ctx = setup_log_collector(ctx)
    xmin = 100
    lsn = Lsn.from_string("0/10")
    log_offset = LogOffset.new(lsn, 0)

    stub_inspector(
      load_relation_oid: fn {"public", "test_table"}, _ ->
        {:ok, {1234, {"public", "test_table"}}}
      end,
      load_column_info: fn 1234, _ ->
        {:ok, [%{pk_position: 0, name: "id", is_generated: false}]}
      end
    )

    txn =
      complete_txn_fragment(xmin, lsn, [
        %Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: log_offset
        }
      ])

    # this call should return immediately
    assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
  end

  test "initializes with provided LSN", ctx do
    # Start a test Registry
    registry_name = Module.concat(__MODULE__, Registry)
    start_link_supervised!({Registry, keys: :duplicate, name: registry_name})

    # Start the ShapeLogCollector process
    opts = [
      stack_id: ctx.stack_id,
      inspector: {Mock.Inspector, elem(@inspector, 1)},
      persistent_kv: ctx.persistent_kv
    ]

    {:ok, _pid} = start_supervised({ShapeLogCollector.Supervisor, opts})

    Repatch.patch(StatusMonitor, :mark_shape_log_collector_ready, [mode: :shared], fn _, _ ->
      :ok
    end)

    Repatch.allow(self(), ShapeLogCollector.name(ctx.stack_id))

    stub_inspector(
      load_relation_oid: fn {"public", "test_table"}, _ ->
        {:ok, {1234, {"public", "test_table"}}}
      end,
      load_relation_info: fn 1234, _ ->
        {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}
      end,
      load_column_info: fn 1234, _ ->
        {:ok, [%{pk_position: 0, name: "id", is_generated: false}]}
      end
    )

    consumer_id = "test_consumer"

    consumer =
      start_link_supervised!(
        {Support.TransactionConsumer,
         id: consumer_id,
         stack_id: ctx.stack_id,
         parent: self(),
         shape: @shape,
         shape_handle: @shape_handle}
      )

    consumers = [{consumer_id, consumer}]

    start_lsn = Lsn.from_integer(100)
    next_lsn = Lsn.increment(start_lsn, +1)
    next_log_offset = LogOffset.new(next_lsn, 0)

    LsnTracker.set_last_processed_lsn(ctx.stack_id, start_lsn)
    ShapeLogCollector.mark_as_ready(ctx.stack_id)

    txn_to_drop =
      complete_txn_fragment(100, start_lsn, [
        %Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: LogOffset.new(start_lsn, 0)
        },
        %Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2"},
          log_offset: LogOffset.new(start_lsn, 1)
        }
      ])

    # this call should return immediately
    assert :ok = ShapeLogCollector.handle_event(txn_to_drop, ctx.stack_id)

    # should drop the transaction and not update the lsn
    Support.TransactionConsumer.refute_consume(consumers)
    assert start_lsn == LsnTracker.get_last_processed_lsn(ctx.stack_id)

    # should accept a transaction with a higher LSN and update it
    txn_to_process =
      complete_txn_fragment(101, next_lsn, [
        %Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "3"},
          log_offset: next_log_offset
        }
      ])

    assert :ok = ShapeLogCollector.handle_event(txn_to_process, ctx.stack_id)
    Support.TransactionConsumer.assert_consume(consumers, [txn_to_process])
    assert next_lsn == LsnTracker.get_last_processed_lsn(ctx.stack_id)
  end

  test "notifies the StatusMonitor when it's ready", ctx do
    ctx = Map.merge(ctx, setup_log_collector(ctx))
    pid = ctx.stack_id |> ShapeLogCollector.name() |> GenServer.whereis()

    assert RepatchExt.called_within_ms?(
             StatusMonitor,
             :mark_shape_log_collector_ready,
             [ctx.stack_id, pid],
             100
           )
  end

  describe "add_shape/4" do
    setup :setup_log_collector
    @shape Fixtures.Shape.new(1)
    @shape_handle "the-shape-handle"
    @relation_info %{
      id: @shape.root_table_id,
      schema: @shape.root_table |> elem(0),
      name: @shape.root_table |> elem(1),
      parent: nil,
      children: nil
    }

    test "returns :ok when relation info available", ctx do
      stub_inspector(load_relation_info: fn _, _ -> {:ok, @relation_info} end)

      assert ShapeLogCollector.add_shape(ctx.stack_id, @shape_handle, @shape, :create) == :ok
    end

    test "returns error when connection not available", ctx do
      stub_inspector(load_relation_info: fn _, _ -> {:error, :connection_not_available} end)

      assert ShapeLogCollector.add_shape(ctx.stack_id, @shape_handle, @shape, :create) ==
               {:error, :connection_not_available}
    end

    test "returns error when introspection fails unexpectedly", ctx do
      error = "ERROR 53200 (out_of_memory) out of memory"
      stub_inspector(load_relation_info: fn _, _ -> {:error, error} end)

      assert ShapeLogCollector.add_shape(ctx.stack_id, @shape_handle, @shape, :create) ==
               {:error, error}

      assert ShapeLogCollector.name(ctx.stack_id) |> GenServer.whereis() |> Process.alive?()
    end
  end

  describe "handle_event/2 with shapes with dependencies" do
    @shape Shape.new!("test_table", inspector: @inspector)
    @shape2 Shape.new!("test_table",
              where: "id IN (SELECT id FROM test_table WHERE id > 10)",
              inspector: @inspector
            )
    setup :setup_log_collector

    setup ctx do
      parent = self()

      stub_inspector(
        load_relation_oid: fn {"public", "test_table"}, _ ->
          {:ok, {1234, {"public", "test_table"}}}
        end,
        load_relation_info: fn 1234, _ ->
          {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}
        end,
        load_column_info: fn 1234, _ ->
          {:ok, [%{pk_position: 0, name: "id", is_generated: false}]}
        end
      )

      consumers = [
        {:normal,
         start_link_supervised!(
           {Support.TransactionConsumer,
            id: :normal,
            stack_id: ctx.stack_id,
            parent: parent,
            shape: @shape,
            shape_handle: "normal-shape-handle"},
           id: {:consumer, :normal}
         )},
        {:inner,
         start_link_supervised!(
           {Support.TransactionConsumer,
            id: :inner,
            stack_id: ctx.stack_id,
            parent: parent,
            shape: @shape2.shape_dependencies |> List.first(),
            shape_handle: "inner-shape-handle"},
           id: {:consumer, :inner}
         )},
        {:outer,
         start_link_supervised!(
           {Support.TransactionConsumer,
            id: :outer,
            stack_id: ctx.stack_id,
            parent: parent,
            shape: %{@shape2 | shape_dependencies_handles: ["inner-shape-handle"]},
            shape_handle: "outer-shape-handle"},
           id: {:consumer, :outer}
         )}
      ]

      %{consumers: consumers}
    end

    test "should handle a transaction that requires a materializer", ctx do
      start_link_supervised!(
        {Support.StubMaterializer,
         stack_id: ctx.stack_id,
         shape_handle: "inner-shape-handle",
         initial_values: MapSet.new([])}
      )

      txn =
        complete_txn_fragment(100, Lsn.from_string("0/10"), [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "11"},
            log_offset: LogOffset.new(Lsn.from_string("0/10"), 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      # Outer consumer should not receive this, because empty initial values won't satisfy the where clause
      Support.TransactionConsumer.assert_consume(ctx.consumers |> Keyword.drop([:outer]), [txn])
    end

    test "should not crash if the materializer is not there, instead skipping the depenencies",
         ctx do
      txn =
        complete_txn_fragment(100, Lsn.from_string("0/10"), [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "11"},
            log_offset: LogOffset.new(Lsn.from_string("0/10"), 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      # This assertion holds because our where clause processing in SLC is best-effort:
      # any crash, like abscence of a materializer, causes the transaction to just be sent everywhere
      # and hope the consumers will filter it out.
      Support.TransactionConsumer.assert_consume(ctx.consumers, [txn])
    end
  end

  describe "global LSN broadcast on transaction commit" do
    setup [:with_registry, :setup_log_collector]

    setup ctx do
      parent = self()

      stub_inspector(
        load_relation_oid: fn {"public", "test_table"}, _ ->
          {:ok, {1234, {"public", "test_table"}}}
        end,
        load_relation_info: fn 1234, _ ->
          {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}
        end,
        load_column_info: fn 1234, _ ->
          {:ok, [%{pk_position: 0, name: "id", is_generated: false}]}
        end
      )

      consumers =
        Enum.map(1..1, fn id ->
          consumer =
            start_link_supervised!(%{
              id: {:consumer, id},
              start:
                {Support.TransactionConsumer, :start_link,
                 [
                   [
                     id: id,
                     stack_id: ctx.stack_id,
                     parent: parent,
                     shape: @shape,
                     shape_handle: "#{@shape_handle}-#{id}"
                   ]
                 ]},
              restart: :temporary
            })

          {id, consumer}
        end)

      %{consumers: consumers}
    end

    test "broadcasts global LSN to registered processes on committed transaction", ctx do
      stack_registry = Electric.StackSupervisor.registry_name(ctx.stack_id)
      Registry.register(stack_registry, :global_lsn_updates, [])

      lsn = Lsn.from_string("0/10")
      log_offset = LogOffset.new(lsn, 0)

      txn =
        complete_txn_fragment(100, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2", "name" => "foo"},
            log_offset: log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      expected_lsn = Lsn.to_integer(lsn)
      assert_receive {:global_last_seen_lsn, ^expected_lsn}
    end

    test "does not broadcast global LSN for non-commit fragments", ctx do
      stack_registry = Electric.StackSupervisor.registry_name(ctx.stack_id)
      Registry.register(stack_registry, :global_lsn_updates, [])

      lsn = Lsn.from_string("0/10")
      log_offset = LogOffset.new(lsn, 0)

      fragment = %TransactionFragment{
        xid: 100,
        lsn: lsn,
        last_log_offset: log_offset,
        has_begin?: true,
        commit: nil,
        changes: [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2", "name" => "foo"},
            log_offset: log_offset
          }
        ],
        affected_relations: MapSet.new([{"public", "test_table"}])
      }

      assert :ok = ShapeLogCollector.handle_event(fragment, ctx.stack_id)

      refute_receive {:global_last_seen_lsn, _}
    end
  end

  describe "FlushTracker advancement when consumer is killed mid-transaction" do
    setup :setup_log_collector

    setup ctx do
      parent = self()

      stub_inspector(
        load_relation_oid: fn {"public", "test_table"}, _ ->
          {:ok, {1234, {"public", "test_table"}}}
        end,
        load_relation_info: fn 1234, _ ->
          {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}
        end,
        load_column_info: fn 1234, _ ->
          {:ok, [%{pk_position: 0, name: "id", is_generated: false}]}
        end
      )

      # Two consumers for two shape handles
      consumer1 =
        start_supervised!(
          {Support.TransactionConsumer,
           id: :alive,
           stack_id: ctx.stack_id,
           parent: parent,
           shape: @shape,
           shape_handle: "shape-alive"},
          id: {:consumer, :alive}
        )

      consumer2 =
        start_supervised!(
          {Support.TransactionConsumer,
           id: :doomed,
           stack_id: ctx.stack_id,
           parent: parent,
           shape: @shape,
           shape_handle: "shape-doomed"},
          id: {:consumer, :doomed}
        )

      %{consumer_alive: consumer1, consumer_doomed: consumer2}
    end

    test "FlushTracker advances past undeliverable shapes from crashed consumer", ctx do
      register_as_replication_client(ctx.stack_id)

      # Send a transaction that affects both shapes and causes the consumer for "shape-doomed"
      # to terminate. As a consequence, SLC should NOT track "shape-doomed" in FlushTracker.
      lsn = Lsn.from_integer(42)
      log_offset = LogOffset.new(lsn, 0)

      txn =
        complete_txn_fragment(100, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{
              "id" => "stop-with-reason",
              "handle" => "shape-doomed",
              "reason" => {:shutdown, :test}
            },
            log_offset: log_offset
          }
        ])

      log =
        ExUnit.CaptureLog.capture_log(fn ->
          assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
        end)

      assert log =~
               ~s'Consumer processes crashed or missing during broadcast: %{"shape-doomed" => {:shutdown, :test}}'

      # The alive consumer receives the transaction
      assert_receive {Support.TransactionConsumer, {:alive, _pid}, [_txn]}

      # Flush only the alive consumer — FlushTracker should advance because
      # the doomed shape was never tracked (excluded as undeliverable).
      ShapeLogCollector.notify_flushed(ctx.stack_id, "shape-alive", log_offset)

      expected_lsn = Lsn.to_integer(lsn)
      assert_receive {:flush_boundary_updated, ^expected_lsn}
    end

    test "FlushTracker advances when consumer crashes on later fragment of multi-fragment txn",
         ctx do
      register_as_replication_client(ctx.stack_id)

      lsn = Lsn.from_integer(42)

      # Fragment 1 (non-commit): both consumers are alive and process it.
      # FlushTracker starts tracking both shapes.
      frag1 = %TransactionFragment{
        xid: 100,
        lsn: lsn,
        last_log_offset: LogOffset.new(lsn, 0),
        has_begin?: true,
        commit: nil,
        changes: [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn, 0)
          }
        ],
        affected_relations: MapSet.new([{"public", "test_table"}])
      }

      assert :ok = ShapeLogCollector.handle_event(frag1, ctx.stack_id)

      # Both consumers receive fragment 1
      assert_receive {Support.TransactionConsumer, {:alive, _}, [_]}
      assert_receive {Support.TransactionConsumer, {:doomed, _}, [_]}

      # Kill the doomed consumer between fragments. This simulates a crash
      # that happens after fragment 1 was processed but before fragment 2.
      kill_consumer(ctx.consumer_doomed, :kill)

      # Fragment 2 (commit): the doomed consumer is dead.
      # ConsumerRegistry.broadcast detects the dead PID → crashed.
      # SLC must remove "shape-doomed" from FlushTracker (it was tracked
      # in fragment 1) and exclude it from the commit fragment tracking.
      frag2 = %TransactionFragment{
        xid: 100,
        lsn: lsn,
        last_log_offset: LogOffset.new(lsn, 5),
        has_begin?: false,
        commit: %Changes.Commit{tx_started_at: System.monotonic_time()},
        changes: [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2"},
            log_offset: LogOffset.new(lsn, 5)
          }
        ],
        affected_relations: MapSet.new([{"public", "test_table"}])
      }

      log =
        ExUnit.CaptureLog.capture_log(fn ->
          assert :ok = ShapeLogCollector.handle_event(frag2, ctx.stack_id)
        end)

      assert log =~
               ~s'Consumer processes crashed or missing during broadcast: %{"shape-doomed" => :noproc}'

      # The alive consumer receives fragment 2
      assert_receive {Support.TransactionConsumer, {:alive, _}, [_]}

      # Flush both fragments for the alive consumer — FlushTracker should advance
      # because the doomed shape was removed from tracking when its crash was detected.
      ShapeLogCollector.notify_flushed(ctx.stack_id, "shape-alive", LogOffset.new(lsn, 5))

      expected_lsn = Lsn.to_integer(lsn)
      assert_receive {:flush_boundary_updated, ^expected_lsn}
    end
  end

  # Adapted from the stall reproduction in PR #4713, with the outcome inverted:
  # a consumer that dies without running its terminate callback (or wedges alive
  # without flushing) no longer pins the FlushTracker's global minimum forever.
  # The SLC monitors the writer pid behind every pending flush entry and runs a
  # periodic stall check, so the boundary is unpinned and the shape invalidated
  # without requiring new traffic or an explicit `remove_shape` call.
  describe "FlushTracker writer monitors and stall detection" do
    @quiet_inspector Support.StubInspector.new(
                       tables: [{5678, {"public", "other_table"}}],
                       columns: [%{name: "id", type: "int8", pk_position: 0}]
                     )
    @quiet_shape Shape.new!("other_table", inspector: @quiet_inspector)

    setup :setup_log_collector

    setup ctx do
      parent = self()

      stub_inspector(
        load_relation_oid: fn
          {"public", "test_table"}, _ -> {:ok, {1234, {"public", "test_table"}}}
          {"public", "other_table"}, _ -> {:ok, {5678, {"public", "other_table"}}}
        end,
        load_relation_info: fn
          1234, _ ->
            {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}

          5678, _ ->
            {:ok, %{id: 5678, schema: "public", name: "other_table", parent: nil, children: nil}}
        end,
        load_column_info: fn
          1234, _ -> {:ok, [%{pk_position: 0, name: "id", is_generated: false}]}
          5678, _ -> {:ok, [%{pk_position: 0, name: "id", is_generated: false}]}
        end
      )

      consumer_alive =
        start_supervised!(
          {Support.TransactionConsumer,
           id: :alive,
           stack_id: ctx.stack_id,
           parent: parent,
           shape: @shape,
           shape_handle: "shape-alive"},
          id: {:consumer, :alive}
        )

      consumer_doomed =
        start_supervised!(
          {Support.TransactionConsumer,
           id: :doomed,
           stack_id: ctx.stack_id,
           parent: parent,
           shape: @quiet_shape,
           shape_handle: "shape-doomed"},
          id: {:consumer, :doomed}
        )

      register_as_replication_client(ctx.stack_id)

      %{consumer_alive: consumer_alive, consumer_doomed: consumer_doomed}
    end

    test "crashed writer DOWN unpins the boundary and schedules removal without traffic", ctx do
      stub_shape_cleaner(ctx)
      attach_writer_down_telemetry(ctx)

      seed_pinned_flush_entry(ctx)

      # The doomed consumer crashes out-of-band (terminate/2 never runs) while its
      # shape's table stays quiet. The writer monitor's DOWN unpins the entry
      # immediately and schedules the shape's removal — no traffic needed.
      Support.TransactionConsumer.crash(ctx.consumer_doomed, {:error, :simulated_disk_failure})

      assert_receive {:remove_shapes_async, ["shape-doomed"]}
      assert_receive {:flush_boundary_updated, 42}

      assert_receive {:writer_down_telemetry, %{count: 1}, %{reason_class: :crash}}
    end

    test "consumer killed without cleanup is self-healed by the stall check", ctx do
      # Emulate the real removal chain: ShapeCleaner.remove_shapes eventually issues
      # ShapeLogCollector.remove_shape for each handle from a cleanup task.
      stack_id = ctx.stack_id
      parent = self()

      patch_calls(Electric.ShapeCache.ShapeCleaner, [],
        remove_shapes_async: fn ^stack_id, handles ->
          send(parent, {:remove_shapes_async, handles})
          spawn(fn -> Enum.each(handles, &ShapeLogCollector.remove_shape(stack_id, &1)) end)
          :ok
        end
      )

      seed_pinned_flush_entry(ctx)

      # `:kill` is untrappable: the consumer dies without terminate/2 and the DOWN
      # reason `:killed` is classified as supervisor teardown, so the entry stays
      # pinned for now...
      kill_consumer(ctx.consumer_doomed, :kill)
      refute_receive {:flush_boundary_updated, _}
      refute_receive {:remove_shapes_async, _}

      # ...until the stall check finds it past the grace period and removes the
      # shape, which unpins the boundary — without new traffic and without an
      # explicit remove_shape call.
      Electric.StackConfig.put(ctx.stack_id, :flush_stall_grace_period, 20)
      Process.sleep(50)
      trigger_stall_check(ctx.stack_id)

      assert_receive {:remove_shapes_async, ["shape-doomed"]}
      assert_receive {:flush_boundary_updated, 42}
    end

    test "consumer stopped with bare :shutdown keeps the entry pinned", ctx do
      stub_shape_cleaner(ctx)
      attach_writer_down_telemetry(ctx)

      seed_pinned_flush_entry(ctx)

      # Bare :shutdown is assumed to be a supervisor teardown: the entry must stay
      # pinned and the shape must not be invalidated.
      Support.TransactionConsumer.crash(ctx.consumer_doomed, :shutdown)

      assert_receive {:writer_down_telemetry, %{count: 1}, %{reason_class: :shutdown}}
      refute_receive {:remove_shapes_async, _}
      refute_receive {:flush_boundary_updated, _}
    end

    test "undeliverable :noproc keeps the entry pinned and the stall check armed", ctx do
      stub_shape_cleaner(ctx)
      attach_writer_down_telemetry(ctx)

      seed_pinned_flush_entry(ctx)

      # The doomed consumer is killed; the `:killed` DOWN is classified as
      # supervisor teardown, so the entry stays pinned and the monitor is gone.
      kill_consumer(ctx.consumer_doomed, :kill)
      assert_receive {:writer_down_telemetry, %{count: 1}, %{reason_class: :shutdown}}

      # New traffic for its table resolves the stale registry entry to the dead
      # pid, so the publish observes a `:noproc` — a masked reason that must not
      # be treated as a crash (no invalidation) nor blindly unpinned (the entry
      # must stay for the stall check).
      lsn = Lsn.from_integer(43)

      txn =
        complete_txn_fragment(101, lsn, [
          %Changes.NewRecord{
            relation: {"public", "other_table"},
            record: %{"id" => "2"},
            log_offset: LogOffset.new(lsn, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {:writer_down_telemetry, %{count: 1}, %{reason_class: :shutdown}}
      refute_receive {:remove_shapes_async, _}
      refute_receive {:flush_boundary_updated, _}

      # The entry is still pinned, so the stall check self-heals one grace
      # period later.
      Electric.StackConfig.put(ctx.stack_id, :flush_stall_grace_period, 20)
      Process.sleep(50)
      trigger_stall_check(ctx.stack_id)

      assert_receive {:remove_shapes_async, ["shape-doomed"]}
    end

    test "stall check challenges a wedged-alive consumer, then invalidates it", ctx do
      stub_shape_cleaner(ctx)

      seed_pinned_flush_entry(ctx)

      # The doomed consumer is alive but never flushes. Once its entry exceeds
      # the grace period, the stall check first challenges the writer rather
      # than removing the shape outright.
      Electric.StackConfig.put(ctx.stack_id, :flush_stall_grace_period, 20)
      Process.sleep(50)
      trigger_stall_check(ctx.stack_id)
      assert_receive {:flush_progress_challenged, _pid}
      refute_receive {:remove_shapes_async, _}

      # The wedged consumer never answers: the next check invalidates it.
      trigger_stall_check(ctx.stack_id)
      assert_receive {:remove_shapes_async, ["shape-doomed"]}

      # The touch re-armed the grace period: an immediate re-check does not re-fire.
      trigger_stall_check(ctx.stack_id)
      refute_receive {:remove_shapes_async, _}

      # If the removal chain is lost (our stub drops it), the stall re-fires one
      # grace period later — again as a challenge first, then invalidation.
      Process.sleep(50)
      trigger_stall_check(ctx.stack_id)
      assert_receive {:flush_progress_challenged, _pid}
      refute_receive {:remove_shapes_async, _}
      trigger_stall_check(ctx.stack_id)
      assert_receive {:remove_shapes_async, ["shape-doomed"]}
    end

    test "a challenged deferring writer answers and re-arms the grace period", ctx do
      stub_shape_cleaner(ctx)

      seed_pinned_flush_entry(ctx)

      Electric.StackConfig.put(ctx.stack_id, :flush_stall_grace_period, 20)
      Process.sleep(50)

      # The stalled entry's writer is challenged; answering with
      # notify_flush_deferred (as a deliberately deferring consumer would)
      # touches the entry, so an immediate re-check finds nothing stalled.
      trigger_stall_check(ctx.stack_id)
      assert_receive {:flush_progress_challenged, _pid}
      ShapeLogCollector.notify_flush_deferred(ctx.stack_id, "shape-doomed")
      trigger_stall_check(ctx.stack_id)
      refute_receive {:flush_progress_challenged, _pid}
      refute_receive {:remove_shapes_async, _}

      # A challenge answered without any stall check in between: the answer must
      # clear the suspicion, so when the entry stalls again a full grace period
      # later the writer is challenged afresh instead of being invalidated as an
      # unresponsive suspect...
      Process.sleep(50)
      trigger_stall_check(ctx.stack_id)
      assert_receive {:flush_progress_challenged, _pid}
      refute_receive {:remove_shapes_async, _}
      ShapeLogCollector.notify_flush_deferred(ctx.stack_id, "shape-doomed")
      Process.sleep(50)
      trigger_stall_check(ctx.stack_id)
      assert_receive {:flush_progress_challenged, _pid}
      refute_receive {:remove_shapes_async, _}

      # ...and only an unanswered challenge invalidates the shape.
      trigger_stall_check(ctx.stack_id)
      assert_receive {:remove_shapes_async, ["shape-doomed"]}
    end

    test "completed entry is demonitored so later writer death has no effect", ctx do
      stub_shape_cleaner(ctx)
      attach_writer_down_telemetry(ctx)

      seed_pinned_flush_entry(ctx)

      # The doomed consumer flushes everything: its entry completes and its monitor
      # is dropped.
      ShapeLogCollector.notify_flushed(ctx.stack_id, "shape-doomed", LogOffset.new(42, 2))
      assert_receive {:flush_boundary_updated, 42}

      # Its subsequent death is nobody's business: no DOWN side effects.
      Support.TransactionConsumer.crash(ctx.consumer_doomed, {:error, :simulated_disk_failure})

      refute_receive {:writer_down_telemetry, _, _}
      refute_receive {:remove_shapes_async, _}
      refute_receive {:flush_boundary_updated, _}
    end

    test "monitor follows the writer when a commit is redelivered to a fresh pid", ctx do
      stub_shape_cleaner(ctx)
      attach_writer_down_telemetry(ctx)

      seed_pinned_flush_entry(ctx)

      # Simulate the suspend-retry hand-over: the registry entry for the
      # still-incomplete shape is replaced by a fresh consumer before the old
      # one's exit is observed by the SLC.
      Electric.Shapes.ConsumerRegistry.remove_consumer("shape-doomed", ctx.stack_id)

      consumer_fresh =
        start_supervised!(
          {Support.TransactionConsumer,
           id: :doomed_fresh,
           stack_id: ctx.stack_id,
           parent: self(),
           shape: @quiet_shape,
           shape_handle: "shape-doomed",
           action: :restore},
          id: {:consumer, :doomed_fresh}
        )

      lsn = Lsn.from_integer(50)

      txn =
        complete_txn_fragment(101, lsn, [
          %Changes.NewRecord{
            relation: {"public", "other_table"},
            record: %{"id" => "2"},
            log_offset: LogOffset.new(lsn, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      assert_receive {Support.TransactionConsumer, {:doomed_fresh, _}, [_]}

      # The predecessor's late exit — e.g. its deferred {:shutdown, :suspend} —
      # is no longer this shape's business: no crash classification, no
      # invalidation. Without the monitor swap this reads as a contract
      # violation and spuriously invalidates a healthy shape.
      Support.TransactionConsumer.crash(ctx.consumer_doomed, {:shutdown, :suspend})
      refute_receive {:writer_down_telemetry, _, _}
      refute_receive {:remove_shapes_async, _}

      # The monitor followed the fresh pid: its crash unpins and invalidates.
      Support.TransactionConsumer.crash(consumer_fresh, {:error, :simulated_disk_failure})
      assert_receive {:writer_down_telemetry, %{count: 1}, %{reason_class: :crash}}
      assert_receive {:remove_shapes_async, ["shape-doomed"]}
      assert_receive {:flush_boundary_updated, 50}
    end

    test "writer crashing during publish is classified as a crash for its tracked entry", ctx do
      stub_shape_cleaner(ctx)
      attach_writer_down_telemetry(ctx)

      seed_pinned_flush_entry(ctx)

      # The doomed consumer exits with a real crash reason while handling the
      # next commit: the publish-time exit observation must classify it exactly
      # like a monitor DOWN — immediate unpin plus invalidation, with the
      # writer monitor's own queued DOWN flushed rather than double-handled.
      lsn = Lsn.from_integer(50)

      txn =
        complete_txn_fragment(101, lsn, [
          %Changes.NewRecord{
            relation: {"public", "other_table"},
            record: %{
              "id" => "stop-with-reason",
              "handle" => "shape-doomed",
              "reason" => {:error, :simulated_disk_failure}
            },
            log_offset: LogOffset.new(lsn, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {:writer_down_telemetry, %{count: 1}, %{reason_class: :crash}}
      assert_receive {:remove_shapes_async, ["shape-doomed"]}
      assert_receive {:flush_boundary_updated, 42}
      assert_receive {:flush_boundary_updated, 50}
    end
  end

  # Publish a txn (lsn 42) touching both test_table (shape-alive) and other_table
  # (shape-doomed), then flush shape-alive completely. shape-doomed's entry is left
  # as the only incomplete one, holding the flush boundary just before the txn.
  defp seed_pinned_flush_entry(ctx) do
    lsn = Lsn.from_integer(42)

    txn =
      complete_txn_fragment(100, lsn, [
        %Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: LogOffset.new(lsn, 0)
        },
        %Changes.NewRecord{
          relation: {"public", "other_table"},
          record: %{"id" => "1"},
          log_offset: LogOffset.new(lsn, 2)
        }
      ])

    assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
    assert_receive {Support.TransactionConsumer, {:alive, _}, [_]}
    assert_receive {Support.TransactionConsumer, {:doomed, _}, [_]}

    ShapeLogCollector.notify_flushed(ctx.stack_id, "shape-alive", LogOffset.new(lsn, 2))
    assert_receive {:flush_boundary_updated, 40}
  end

  defp stub_shape_cleaner(%{stack_id: stack_id}) do
    parent = self()

    patch_calls(Electric.ShapeCache.ShapeCleaner, [],
      remove_shapes_async: fn ^stack_id, handles ->
        send(parent, {:remove_shapes_async, handles})
        :ok
      end
    )
  end

  defp attach_writer_down_telemetry(%{stack_id: stack_id, test: test}) do
    parent = self()
    handler_id = "writer-down-#{inspect(test)}"

    :telemetry.attach(
      handler_id,
      [:electric, :flush_tracker, :writer_down],
      fn _event, measurements, metadata, _config ->
        if metadata.stack_id == stack_id do
          send(parent, {:writer_down_telemetry, measurements, metadata})
        end
      end,
      nil
    )

    on_exit(fn -> :telemetry.detach(handler_id) end)
  end

  defp trigger_stall_check(stack_id) do
    stack_id |> ShapeLogCollector.name() |> GenServer.whereis() |> send(:check_stalled_flushes)
  end

  defp kill_consumer(pid, reason) do
    ref = Process.monitor(pid)
    Process.exit(pid, reason)
    expected_reason = with :kill <- reason, do: :killed
    assert_receive {:DOWN, ^ref, :process, ^pid, ^expected_reason}
  end
end
