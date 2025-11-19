defmodule Electric.Replication.ShapeLogCollectorTest do
  use ExUnit.Case, async: false
  use Repatch.ExUnit, assert_expectations: true

  alias Electric.LsnTracker
  alias Electric.Postgres.Lsn
  alias Electric.Replication.ShapeLogCollector
  alias Electric.Replication.Changes.{Transaction, Relation}
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Shape
  alias Electric.StatusMonitor

  alias Support.Fixtures
  alias Support.RepatchExt

  import Support.TestUtils, only: [patch_calls: 3, expect_calls: 2]

  import Support.ComponentSetup

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

    {:ok, pid} = start_supervised({ShapeLogCollector, opts})

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

    %{server: pid, registry: registry_name, shape_cache: shape_cache_pid}
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
             producer: ctx.server,
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
        %Transaction{xid: xmin, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2", "name" => "foo"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.server)

      xids = Support.TransactionConsumer.assert_consume([{1, consumer}], [txn])
      assert xids == [xmin]
    end
  end

  describe "lazy consumer initialization" do
    setup do
      supervisor = start_link_supervised!({DynamicSupervisor, strategy: :one_for_one})
      [supervisor: supervisor]
    end

    setup :setup_log_collector

    setup(ctx) do
      %{stack_id: stack_id} = ctx

      parent = self()

      Repatch.patch(
        Electric.ShapeCache,
        :start_consumer_for_handle,
        [mode: :shared],
        fn shape_handle, ^stack_id ->
          id = System.unique_integer([:positive, :monotonic])

          with {:ok, pid} <-
                 DynamicSupervisor.start_child(ctx.supervisor, {
                   Support.TransactionConsumer,
                   id: id,
                   stack_id: ctx.stack_id,
                   parent: parent,
                   producer: ctx.server,
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
        %Transaction{xid: xmin, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2", "name" => "foo"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.server)
      assert_receive {:start_consumer, @shape_handle, id, pid}
      xids = Support.TransactionConsumer.assert_consume([{id, pid}], [txn])
      assert xids == [xmin]
    end

    test "consumer exits remove the filter mapping", ctx do
      xmin = 100
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      Process.monitor(ctx.server)

      txn =
        %Transaction{xid: xmin, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2", "name" => "foo"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.server)
      assert_receive {:start_consumer, @shape_handle, id, consumer_pid}
      ref = Process.monitor(consumer_pid)
      xids = Support.TransactionConsumer.assert_consume([{id, consumer_pid}], [txn])
      assert xids == [xmin]

      Support.TransactionConsumer.stop(consumer_pid, :normal)

      assert_receive {Support.TransactionConsumer, {^id, ^consumer_pid}, {:terminate, :normal}}
      assert_receive {:DOWN, ^ref, :process, ^consumer_pid, _}

      # the shape has been removed from the filters
      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.server)
      refute_receive {:start_consumer, @shape_handle, _id, _consumer_pid}
    end
  end

  defp stub_inspector(opts \\ [], stubs) do
    patch_calls(Electric.Postgres.Inspector, opts, stubs)
  end

  defp expect_inspector(expectations) do
    expect_calls(Electric.Postgres.Inspector, expectations)
  end

  describe "store_transaction/2" do
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
                     producer: ctx.server,
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

      txn =
        %Transaction{xid: xmin, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2", "name" => "foo"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.server)

      xids =
        Support.TransactionConsumer.assert_consume(ctx.consumers, [txn])

      assert xids == [xmin]

      txn2 =
        %Transaction{xid: xid, lsn: next_lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2", "name" => "bar"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn2, ctx.server)

      xids = Support.TransactionConsumer.assert_consume(ctx.consumers, [txn2])

      assert xids == [xid]
    end

    @transaction_timeout 5
    @num_comparisons 10
    test "drops transactions if already processed", ctx do
      change = %Changes.NewRecord{
        relation: {"public", "test_table"},
        record: %{"id" => "2", "name" => "foo"}
      }

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

        txn =
          %Transaction{xid: xid, lsn: lsn, last_log_offset: LogOffset.new(lsn, 0)}
          |> Transaction.prepend_change(change)

        assert :ok = ShapeLogCollector.store_transaction(txn, ctx.server)

        Support.TransactionConsumer.assert_consume(ctx.consumers, [txn], @transaction_timeout)

        txn2 =
          %Transaction{xid: xid, lsn: lsn, last_log_offset: LogOffset.new(lsn, 0)}
          |> Transaction.prepend_change(change)

        txn3 =
          %Transaction{
            xid: prev_xid,
            lsn: prev_lsn,
            last_log_offset: LogOffset.new(prev_lsn, 0)
          }
          |> Transaction.prepend_change(change)

        assert :ok = ShapeLogCollector.store_transaction(txn2, ctx.server)
        assert :ok = ShapeLogCollector.store_transaction(txn3, ctx.server)
        Support.TransactionConsumer.refute_consume(ctx.consumers, @transaction_timeout * 2)
        {xid, prev_xid, lsn_int, prev_lsn_int}
      end)
    end

    # This is a regression test. It used to fail before #2853 was fixed.
    test "succeeds in building a key for a change containing null", ctx do
      stub_inspector(
        load_column_info:
          {fn 1234, _ ->
             {:ok, [%{name: "id", pk_position: nil}, %{name: "name", pk_position: nil}]}
           end, force: true}
      )

      change = %Changes.NewRecord{
        relation: {"public", "test_table"},
        record: %{"id" => nil, "name" => "foo"}
      }

      txn =
        %Transaction{xid: 1, lsn: 1, last_log_offset: LogOffset.new(1, 0)}
        |> Transaction.prepend_change(change)

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.server)
    end

    test "correctly handles flush notifications", ctx do
      lsn = Lsn.from_string("0/10")
      prev_lsn = Lsn.increment(lsn, -1)

      {:via, Registry, {name, key}} = Electric.Postgres.ReplicationClient.name(ctx.stack_id)

      Registry.register(name, key, nil)

      irrelevant_txn = %Transaction{xid: 99, lsn: prev_lsn} |> Transaction.finalize()

      assert :ok = ShapeLogCollector.store_transaction(irrelevant_txn, ctx.server)
      expected_lsn = Lsn.to_integer(prev_lsn)
      assert_receive {:flush_boundary_updated, ^expected_lsn}, 50

      txn =
        %Transaction{xid: 100, lsn: lsn}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2", "name" => "foo"},
          log_offset: LogOffset.new(lsn, 0)
        })
        |> Transaction.finalize()

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.server)
      refute_receive {:flush_boundary_updated, _}, 50

      ShapeLogCollector.notify_flushed(ctx.server, @shape_handle <> "-1", txn.last_log_offset)
      refute_receive {:flush_boundary_updated, _}, 50
      ShapeLogCollector.notify_flushed(ctx.server, @shape_handle <> "-2", txn.last_log_offset)
      refute_receive {:flush_boundary_updated, _}, 50
      ShapeLogCollector.notify_flushed(ctx.server, @shape_handle <> "-3", txn.last_log_offset)

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

      {:via, Registry, {name, key}} = Electric.Postgres.ReplicationClient.name(ctx.stack_id)

      Registry.register(name, key, nil)

      lsn = Lsn.from_integer(55)

      txn =
        %Transaction{xid: 100, lsn: lsn}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "irrelevant_table"},
          record: %{"id" => "2", "name" => "foo"},
          log_offset: LogOffset.new(lsn, 0)
        })
        |> Transaction.finalize()

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.server)
      assert_receive {:flush_boundary_updated, 55}, 50
    end

    test "correctly broadcasts flush when transaction has already been processed before", ctx do
      {:via, Registry, {name, key}} = Electric.Postgres.ReplicationClient.name(ctx.stack_id)
      Registry.register(name, key, nil)

      LsnTracker.set_last_processed_lsn(ctx.stack_id, Lsn.from_integer(50))
      assert :ok = ShapeLogCollector.mark_as_ready(ctx.server)

      lsn = Lsn.from_integer(20)

      txn =
        %Transaction{xid: 100, lsn: lsn}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "irrelevant_table"},
          record: %{"id" => "2", "name" => "foo"},
          log_offset: LogOffset.new(lsn, 0)
        })
        |> Transaction.finalize()

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.server)
      assert_receive {:flush_boundary_updated, 20}, 50
    end

    test "correctly broadcasts flush when consumers die", ctx do
      {:via, Registry, {name, key}} = Electric.Postgres.ReplicationClient.name(ctx.stack_id)
      Registry.register(name, key, nil)

      lsn = Lsn.from_integer(20)

      txn =
        %Transaction{xid: 100, lsn: lsn}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2"},
          log_offset: LogOffset.new(lsn, 0)
        })
        |> Transaction.finalize()

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.server)

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

      txn =
        %Transaction{xid: 100, lsn: 1, last_log_offset: LogOffset.new(1, 0)}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2", "name" => "foo"}
        })

      assert {:error, :connection_not_available} =
               ShapeLogCollector.store_transaction(txn, ctx.server)
    end
  end

  describe "handle_relation_msg/2" do
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
                     producer: ctx.server,
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

      assert :ok = ShapeLogCollector.handle_relation_msg(relation1, ctx.server)

      relation2 = %Relation{id: id, table: "bar", schema: "public", columns: []}

      assert :ok = ShapeLogCollector.handle_relation_msg(relation2, ctx.server)

      Support.TransactionConsumer.assert_consume(ctx.consumers, [relation1, relation2])
    end
  end

  describe "collector not ready" do
    setup ctx do
      {:ok, pid} =
        start_supervised(
          {ShapeLogCollector,
           stack_id: ctx.stack_id,
           inspector: {Mock.Inspector, elem(@inspector, 1)},
           persistent_kv: ctx.persistent_kv}
        )

      %{server: pid}
    end

    test "rejects new transactions", ctx do
      lsn = Lsn.from_string("0/10")

      txn = %Transaction{xid: 100, lsn: lsn, last_log_offset: LogOffset.new(lsn, 0)}

      assert {:error, :not_ready} = ShapeLogCollector.store_transaction(txn, ctx.server)
    end

    test "rejects relation messages", ctx do
      relation = %Relation{id: 1234, table: "test_table", schema: "public", columns: []}

      assert_raise MatchError, fn ->
        ShapeLogCollector.handle_relation_msg(relation, ctx.server)
      end
    end
  end

  test "closes the loop even with no active shapes", ctx do
    ctx = setup_log_collector(ctx)
    xmin = 100
    lsn = Lsn.from_string("0/10")
    last_log_offset = LogOffset.new(lsn, 0)

    txn =
      %Transaction{xid: xmin, lsn: lsn, last_log_offset: last_log_offset}
      |> Transaction.prepend_change(%Changes.NewRecord{
        relation: {"public", "test_table"},
        record: %{"id" => "1"}
      })

    # this call should return immediately
    assert :ok = ShapeLogCollector.store_transaction(txn, ctx.server)
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

    {:ok, pid} = start_supervised({ShapeLogCollector, opts})

    Repatch.patch(StatusMonitor, :mark_shape_log_collector_ready, [mode: :shared], fn _, _ ->
      :ok
    end)

    Repatch.allow(self(), pid)

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
         producer: pid,
         shape: @shape,
         shape_handle: @shape_handle}
      )

    consumers = [{consumer_id, consumer}]

    start_lsn = Lsn.from_integer(100)
    prev_lsn = Lsn.increment(start_lsn, -1)
    next_lsn = Lsn.increment(start_lsn, +1)

    LsnTracker.set_last_processed_lsn(ctx.stack_id, start_lsn)
    ShapeLogCollector.mark_as_ready(pid)

    txn_to_drop =
      %Transaction{xid: 99, lsn: prev_lsn, last_log_offset: LogOffset.new(prev_lsn, 0)}
      |> Transaction.prepend_change(%Changes.NewRecord{
        relation: {"public", "test_table"},
        record: %{"id" => "1"}
      })

    # this call should return immediately
    assert :ok = ShapeLogCollector.store_transaction(txn_to_drop, pid)

    # should drop the transaction and not update the lsn
    Support.TransactionConsumer.refute_consume(consumers)
    assert start_lsn == LsnTracker.get_last_processed_lsn(ctx.stack_id)

    # should accept a transaction with a higher LSN and update it
    txn_to_process =
      %Transaction{xid: 101, lsn: next_lsn, last_log_offset: LogOffset.new(next_lsn, 0)}
      |> Transaction.prepend_change(%Changes.NewRecord{
        relation: {"public", "test_table"},
        record: %{"id" => "3"}
      })

    assert :ok = ShapeLogCollector.store_transaction(txn_to_process, pid)
    Support.TransactionConsumer.assert_consume(consumers, [txn_to_process])
    assert next_lsn == LsnTracker.get_last_processed_lsn(ctx.stack_id)
  end

  test "notifies the StatusMonitor when it's ready", ctx do
    ctx = Map.merge(ctx, setup_log_collector(ctx))

    assert RepatchExt.called_within_ms?(
             StatusMonitor,
             :mark_shape_log_collector_ready,
             [ctx.stack_id, ctx.server],
             100
           )
  end

  describe "subscribe/4" do
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

    test "returns :ok when relation info available", %{server: server} do
      stub_inspector(load_relation_info: fn _, _ -> {:ok, @relation_info} end)

      assert ShapeLogCollector.subscribe(server, @shape_handle, @shape, :create) == :ok
    end

    test "returns error when connection not available", %{server: server} do
      stub_inspector(load_relation_info: fn _, _ -> {:error, :connection_not_available} end)

      assert ShapeLogCollector.subscribe(server, @shape_handle, @shape, :create) ==
               {:error, :connection_not_available}
    end
  end
end
