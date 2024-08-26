defmodule Electric.Replication.ShapeLogCollectorTest do
  use ExUnit.Case, async: true

  import Mox

  alias Electric.Postgres.Lsn
  alias Electric.Replication.ShapeLogCollector
  alias Electric.Replication.Changes.{Transaction, Relation}
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset

  alias Support.Mock

  @moduletag :capture_log

  setup :verify_on_exit!

  describe "store_transaction/2" do
    setup do
      # Start a test Registry
      registry_name = Module.concat(__MODULE__, Registry)
      start_link_supervised!({Registry, keys: :duplicate, name: registry_name})

      # Start the ShapeLogCollector process
      opts = [
        name: __MODULE__.ShapeLogCollector,
        inspector: {Mock.Inspector, []}
      ]

      {:ok, pid} = start_supervised({ShapeLogCollector, opts})
      parent = self()

      consumers =
        Enum.map(1..3, fn id ->
          {:ok, consumer} =
            Support.TransactionConsumer.start_link(id: id, parent: parent, producer: pid)

          {id, consumer}
        end)

      %{server: pid, registry: registry_name, consumers: consumers}
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

    test "stores relation if it is not known", %{server: server} do
      relation_id = "rel1"

      rel = %Relation{
        id: relation_id,
        schema: "public",
        table: "test_table",
        columns: []
      }

      MockShapeCache
      |> expect(:get_relation, 1, fn ^relation_id, _ -> nil end)
      |> expect(:store_relation, 1, fn ^rel, _ -> :ok end)
      |> allow(self(), server)

      MockInspector
      |> expect(:clean_column_info, 1, fn {"public", "test_table"}, _ -> true end)
      |> allow(self(), server)

      assert :ok = ShapeLogCollector.handle_relation_msg(rel, server)
    end

    test "does not clean shapes if relation didn't change", %{server: server} do
      relation_id = "rel1"

      rel = %Relation{
        id: relation_id,
        schema: "public",
        table: "test_table",
        columns: []
      }

      MockShapeCache
      |> expect(:get_relation, 1, fn ^relation_id, _ -> rel end)
      |> expect(:clean_shape, 0, fn _, _ -> :ok end)
      |> allow(self(), server)

      MockInspector
      |> expect(:clean_column_info, 0, fn _, _ -> true end)
      |> allow(self(), server)

      assert :ok = ShapeLogCollector.handle_relation_msg(rel, server)
    end

    test "cleans shapes affected by table renaming and logs a warning", %{server: server} do
      relation_id = "rel1"

      shape_id1 = "shape1"
      shape1 = @shape

      shape_id2 = "shape2"
      shape2 = @similar_shape

      shape_id3 = "shape3"
      shape3 = @other_shape

      # doesn't matter, isn't used for this test
      xmin = 100

      old_rel = %Relation{
        id: relation_id,
        schema: "public",
        table: "test_table",
        columns: []
      }

      new_rel = %Relation{
        id: relation_id,
        schema: "public",
        table: "renamed_test_table",
        columns: []
      }

      MockShapeCache
      |> expect(:get_relation, 1, fn ^relation_id, _ -> old_rel end)
      |> expect(:store_relation, 1, fn ^new_rel, _ -> :ok end)
      |> expect(:list_active_shapes, 1, fn _ ->
        [{shape_id1, shape1, xmin}, {shape_id2, shape2, xmin}, {shape_id3, shape3, xmin}]
      end)
      |> expect(:clean_shape, 1, fn _, ^shape_id1 -> :ok end)
      |> expect(:clean_shape, 1, fn _, ^shape_id2 -> :ok end)
      |> allow(self(), server)

      MockInspector
      |> expect(:clean_column_info, 1, fn {"public", "test_table"}, _ -> true end)
      |> allow(self(), server)

      log = capture_log(fn -> ShapeLogCollector.handle_relation_msg(new_rel, server) end)
      assert log =~ "Schema for the table public.test_table changed"
    end

    test "cleans shapes affected by a relation change", %{server: server} do
      relation_id = "rel1"

      shape_id1 = "shape1"
      shape1 = @shape

      shape_id2 = "shape2"
      shape2 = @similar_shape

      shape_id3 = "shape3"
      shape3 = @other_shape

      # doesn't matter, isn't used for this test
      xmin = 100

      old_rel = %Relation{
        id: relation_id,
        schema: "public",
        table: "test_table",
        columns: [{"id", "float4"}]
      }

      new_rel = %Relation{
        id: relation_id,
        schema: "public",
        table: "test_table",
        columns: [{"id", "int8"}]
      }

      MockShapeCache
      |> expect(:get_relation, 1, fn ^relation_id, _ -> old_rel end)
      |> expect(:store_relation, 1, fn ^new_rel, _ -> :ok end)
      |> expect(:list_active_shapes, fn _ ->
        [{shape_id1, shape1, xmin}, {shape_id2, shape2, xmin}, {shape_id3, shape3, xmin}]
      end)
      |> expect(:clean_shape, 1, fn _, ^shape_id1 -> :ok end)
      |> expect(:clean_shape, 1, fn _, ^shape_id2 -> :ok end)
      |> allow(self(), server)

      MockInspector
      |> expect(:clean_column_info, 1, fn {"public", "test_table"}, _ -> true end)
      |> allow(self(), server)

      assert :ok = ShapeLogCollector.handle_relation_msg(new_rel, server)
    end
  end

  @basic_query_meta %Postgrex.Query{columns: ["id"], result_types: [:text], name: "key_prefix"}

  describe "store_transaction/2 with real storage" do
    setup [
      {Support.ComponentSetup, :with_registry},
      {Support.ComponentSetup, :with_in_memory_storage}
    ]

    setup %{registry: registry} = ctx do
      %{shape_cache: shape_cache, shape_cache_opts: shape_cache_opts} =
        Support.ComponentSetup.with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: fn _, _ -> :ok end,
          create_snapshot_fn: fn parent, shape_id, shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!(shape_id, shape, @basic_query_meta, [["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {:ok, server} =
        ShapeLogCollector.start_link(
          name: :test_shape_log_storage,
          registry: registry,
          shape_cache: shape_cache,
          inspector: {MockInspector, []}
        )

      MockInspector
      |> stub(:load_column_info, fn {"public", "test_table"}, _ ->
        {:ok, [%{pk_position: 0, name: "id"}]}
      end)
      |> allow(self(), server)

      %{server: server, shape_cache_opts: shape_cache_opts}
    end

    test "duplicate transactions storage is idempotent", %{
      server: server,
      storage: storage,
      shape_cache_opts: shape_cache_opts
    } do
      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, shape_cache_opts)

      :started =
        ShapeCache.await_snapshot_start(Keyword.fetch!(shape_cache_opts, :server), shape_id)

      lsn = Lsn.from_integer(10)

      txn =
        %Transaction{xid: 11, lsn: lsn, last_log_offset: LogOffset.new(lsn, 2)}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2"},
          log_offset: LogOffset.new(lsn, 2)
        })
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: LogOffset.new(lsn, 0)
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, server)

      assert [op1, op2] =
               Storage.get_log_stream(shape_id, LogOffset.before_all(), storage)
               |> Enum.map(&:json.decode/1)

      # If we encounter & store the same transaction, log stream should be stable
      assert :ok = ShapeLogCollector.store_transaction(txn, server)

      assert [^op1, ^op2] =
               Storage.get_log_stream(shape_id, LogOffset.before_all(), storage)
               |> Enum.map(&:json.decode/1)
    end
  end
end
