defmodule Electric.Replication.ShapeLogCollectorTest do
  use ExUnit.Case, async: false

  alias Electric.Postgres.Lsn
  alias Electric.Replication.ShapeLogCollector
  alias Electric.Replication.Changes.{Transaction}
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset

  alias Support.Mock
  import Support.ComponentSetup, only: [with_in_memory_storage: 1]
  import Support.TestUtils, only: [with_electric_instance_id: 1, full_test_name: 1]

  import Mox

  @moduletag :capture_log

  setup :verify_on_exit!
  setup [:with_electric_instance_id, :with_in_memory_storage]

  setup(ctx) do
    # Start a test Registry
    registry_name = Module.concat(__MODULE__, Registry)
    start_link_supervised!({Registry, keys: :duplicate, name: registry_name})

    # Start the ShapeLogCollector process
    opts = [
      electric_instance_id: ctx.electric_instance_id,
      inspector: {Mock.Inspector, []},
      demand: :forward
    ]

    {:ok, pid} = start_supervised({ShapeLogCollector, opts})

    Mock.ShapeStatus
    |> expect(:initialise, 1, fn _opts -> {:ok, %{}} end)
    |> expect(:list_shapes, 1, fn _ -> [] end)
    # allow the ShapeCache to call this mock
    |> allow(self(), fn -> GenServer.whereis(Electric.ShapeCache) end)

    # We need a ShapeCache process because it is a GenStage consumer
    # that handles the Relation events produced by ShapeLogCollector
    shape_meta_table = :"shape_meta_#{full_test_name(ctx)}"

    shape_cache_opts =
      [
        storage: {Mock.Storage, []},
        chunk_bytes_threshold: Electric.ShapeCache.LogChunker.default_chunk_size_threshold(),
        inspector: {Mock.Inspector, []},
        shape_status: Mock.ShapeStatus,
        shape_meta_table: shape_meta_table,
        prepare_tables_fn: fn _, _ -> {:ok, [:ok]} end,
        log_producer: ShapeLogCollector.name(ctx.electric_instance_id),
        electric_instance_id: ctx.electric_instance_id,
        consumer_supervisor: Electric.Shapes.ConsumerSupervisor.name(ctx.electric_instance_id),
        registry: registry_name
      ]

    {:ok, shape_cache_pid} = Electric.ShapeCache.start_link(shape_cache_opts)

    %{server: pid, registry: registry_name, shape_cache: shape_cache_pid}
  end

  describe "store_transaction/2" do
    setup ctx do
      parent = self()

      consumers =
        Enum.map(1..3, fn id ->
          {:ok, consumer} =
            Support.TransactionConsumer.start_link(id: id, parent: parent, producer: ctx.server)

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
      |> expect(:load_column_info, 2, fn {"public", "test_table"}, _ ->
        {:ok, [%{pk_position: 0, name: "id"}]}
      end)
      |> allow(self(), ctx.server)

      txn =
        %Transaction{xid: xmin, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.server)

      xids =
        Support.TransactionConsumer.assert_consume(ctx.consumers, [txn])

      assert xids == [xmin]

      txn2 =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn2, ctx.server)

      xids = Support.TransactionConsumer.assert_consume(ctx.consumers, [txn2])

      assert xids == [xid]
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
