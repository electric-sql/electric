defmodule Electric.Replication.ShapeLogCollectorTest do
  use ExUnit.Case, async: false

  alias Electric.Postgres.Lsn
  alias Electric.Replication.ShapeLogCollector
  alias Electric.Replication.Changes.{Transaction, Relation}
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Shape

  alias Support.Mock
  alias Support.StubInspector

  import Support.ComponentSetup,
    only: [
      with_in_memory_storage: 1,
      with_stack_id_from_test: 1,
      with_noop_publication_manager: 1
    ]

  import Mox

  @moduletag :capture_log

  setup :verify_on_exit!
  setup [:with_stack_id_from_test, :with_in_memory_storage, :with_noop_publication_manager]

  setup(ctx) do
    # Start a test Registry
    registry_name = Module.concat(__MODULE__, Registry)
    start_link_supervised!({Registry, keys: :duplicate, name: registry_name})

    # Start the ShapeLogCollector process
    opts = [
      stack_id: ctx.stack_id,
      inspector: {Mock.Inspector, []},
      demand: :forward
    ]

    {:ok, pid} = start_supervised({ShapeLogCollector, opts})

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
    @inspector StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])
    @shape Shape.new!("test_table", where: "id = 2", inspector: @inspector)

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
      last_log_offset = LogOffset.new(lsn, 0)

      Mock.Inspector
      |> stub(:load_relation, fn
        {"public", "test_table"}, _ ->
          {:ok, %{id: 1234, schema: "public", name: "test_table", parent: nil, children: nil}}
      end)
      |> stub(:load_column_info, fn {"public", "test_table"}, _ ->
        {:ok, [%{pk_position: 0, name: "id"}]}
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
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2", "name" => "bar"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn2, ctx.server)

      xids = Support.TransactionConsumer.assert_consume(ctx.consumers, [txn2])

      assert xids == [xid]
    end
  end

  describe "handle_relation_msg/2" do
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
end
