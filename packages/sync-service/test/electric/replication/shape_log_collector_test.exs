defmodule Electric.Replication.ShapeLogCollectorTest do
  use ExUnit.Case, async: false
  use Repatch.ExUnit

  alias Electric.LsnTracker
  alias Electric.Postgres.Lsn
  alias Electric.Replication.ShapeLogCollector
  alias Electric.Replication.Changes.{Transaction, Relation}
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Shape
  alias Electric.StatusMonitor

  alias Support.Mock
  alias Support.StubInspector
  alias Support.RepatchExt

  import Support.ComponentSetup,
    only: [
      with_in_memory_storage: 1,
      with_stack_id_from_test: 1,
      with_noop_publication_manager: 1,
      with_persistent_kv: 1
    ]

  import Mox

  @moduletag :capture_log

  setup :verify_on_exit!

  setup [
    :with_stack_id_from_test,
    :with_in_memory_storage,
    :with_noop_publication_manager,
    :with_persistent_kv
  ]

  @inspector StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])
  @shape Shape.new!("test_table", inspector: @inspector)

  def setup_log_collector(ctx) do
    # Start a test Registry
    registry_name = Module.concat(__MODULE__, Registry)
    start_link_supervised!({Registry, keys: :duplicate, name: registry_name})

    # Start the ShapeLogCollector process
    opts = [
      stack_id: ctx.stack_id,
      inspector: {Mock.Inspector, []},
      persistent_kv: ctx.persistent_kv
    ]

    {:ok, pid} = start_supervised({ShapeLogCollector, opts})

    Repatch.patch(StatusMonitor, :mark_shape_log_collector_ready, [mode: :shared], fn _, _ ->
      :ok
    end)

    Repatch.allow(self(), pid)

    Mock.ShapeStatus
    |> expect(:initialise, 1, fn _opts -> {:ok, %{}} end)
    |> expect(:list_shapes, 1, fn _ -> [] end)
    # allow the ShapeCache to call this mock
    |> allow(self(), fn ->
      GenServer.whereis(Electric.ShapeCache.name(ctx.stack_id))
    end)

    shape_cache_opts =
      [
        storage: {Mock.Storage, []},
        chunk_bytes_threshold: Electric.ShapeCache.LogChunker.default_chunk_size_threshold(),
        inspector: {Mock.Inspector, []},
        shape_status: Mock.ShapeStatus,
        publication_manager: ctx.publication_manager,
        log_producer: ShapeLogCollector.name(ctx.stack_id),
        stack_id: ctx.stack_id,
        consumer_supervisor: Electric.Shapes.DynamicConsumerSupervisor.name(ctx.stack_id),
        registry: registry_name
      ]

    {:ok, shape_cache_pid} = Electric.ShapeCache.start_link(shape_cache_opts)

    %{server: pid, registry: registry_name, shape_cache: shape_cache_pid}
  end

  describe "store_transaction/2" do
    setup :setup_log_collector

    setup ctx do
      parent = self()

      Mock.Inspector
      |> stub(:load_relation, fn {"public", "test_table"}, _ ->
        {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}
      end)
      |> allow(self(), ctx.server)

      consumers =
        Enum.map(1..3, fn id ->
          {:ok, consumer} =
            Support.TransactionConsumer.start_link(
              id: id,
              parent: parent,
              producer: ctx.server,
              shape: @shape
            )

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

      Mock.Inspector
      |> stub(:load_relation, fn
        {"public", "test_table"}, _ ->
          {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}
      end)
      |> stub(:load_column_info, fn {"public", "test_table"}, _ ->
        {:ok, [%{pk_position: 0, name: "id", is_generated: false}]}
      end)
      |> allow(self(), ctx.server)

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
      Mock.Inspector
      |> stub(:load_relation, fn
        {"public", "test_table"}, _ ->
          {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}
      end)
      |> stub(:load_column_info, fn {"public", "test_table"}, _ ->
        {:ok, [%{pk_position: 0, name: "id", is_generated: false}]}
      end)
      |> allow(self(), ctx.server)

      change = %Changes.NewRecord{
        relation: {"public", "test_table"},
        record: %{"id" => "2", "name" => "foo"}
      }

      1..@num_comparisons
      |> Enum.reduce({1, 0, 1, 0}, fn _, {xid, prev_xid, lsn_int, prev_lsn_int} ->
        # advance xid and lsn randomly along their potential values to simulate
        # trnasactions coming in at different points in the DBs lifetime
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
  end

  describe "handle_relation_msg/2" do
    setup :setup_log_collector

    setup ctx do
      parent = self()

      Mock.Inspector
      |> stub(:load_relation, fn {"public", "test_table"}, _ ->
        {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}
      end)
      |> allow(self(), ctx.server)

      consumers =
        Enum.map(1..3, fn id ->
          {:ok, consumer} =
            Support.TransactionConsumer.start_link(
              id: id,
              parent: parent,
              producer: ctx.server,
              shape: @shape
            )

          {id, consumer}
        end)

      %{consumers: consumers}
    end

    test "should handle new relations", ctx do
      id = @shape.root_table_id

      Mock.Inspector
      |> expect(:clean, 2, fn
        {"public", "test_table"}, _ ->
          :ok

        {"public", "bar"}, _ ->
          :ok
      end)
      |> stub(:load_relation, fn
        {"public", "test_table"}, _ ->
          {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}

        {"public", "bar"}, _ ->
          {:ok, %{id: 1235, schema: "public", name: "bar", parent: nil, children: nil}}
      end)
      |> allow(self(), ctx.server)

      relation1 = %Relation{id: id, table: "test_table", schema: "public", columns: []}

      assert :ok = ShapeLogCollector.handle_relation_msg(relation1, ctx.server)

      relation2 = %Relation{id: id, table: "bar", schema: "public", columns: []}

      assert :ok = ShapeLogCollector.handle_relation_msg(relation2, ctx.server)

      Support.TransactionConsumer.assert_consume(ctx.consumers, [relation1, relation2])
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
      inspector: {Mock.Inspector, []},
      persistent_kv: ctx.persistent_kv
    ]

    {:ok, pid} = start_supervised({ShapeLogCollector, opts})

    Repatch.patch(StatusMonitor, :mark_shape_log_collector_ready, [mode: :shared], fn _, _ ->
      :ok
    end)

    Repatch.allow(self(), pid)

    Mock.Inspector
    |> stub(:load_relation, fn {"public", "test_table"}, _ ->
      {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}
    end)
    |> stub(:load_column_info, fn {"public", "test_table"}, _ ->
      {:ok, [%{pk_position: 0, name: "id", is_generated: false}]}
    end)
    |> allow(self(), pid)

    consumer_id = "test_consumer"

    {:ok, consumer} =
      Support.TransactionConsumer.start_link(
        id: consumer_id,
        parent: self(),
        producer: pid,
        shape: @shape
      )

    consumers = [{consumer_id, consumer}]

    start_lsn = Lsn.from_integer(100)
    prev_lsn = Lsn.increment(start_lsn, -1)
    next_lsn = Lsn.increment(start_lsn, +1)

    ShapeLogCollector.start_processing(pid, start_lsn)

    assert start_lsn == LsnTracker.get_last_processed_lsn(ctx.stack_id)

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
end
