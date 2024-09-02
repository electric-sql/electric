defmodule Electric.Replication.ShapeLogCollectorTest do
  use ExUnit.Case, async: false
  import ExUnit.CaptureLog

  import Mox

  alias Electric.Postgres.Lsn
  alias Electric.Shapes.Shape
  alias Electric.Replication.ShapeLogCollector
  alias Electric.Replication.Changes.{Transaction, Relation}
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset

  alias Support.Mock
  alias Support.StubInspector

  @moduletag :capture_log

  # Define mocks
  Mox.defmock(MockShapeStatus, for: Electric.ShapeCache.ShapeStatusBehaviour)
  Mox.defmock(MockShapeCache, for: Electric.ShapeCacheBehaviour)
  Mox.defmock(MockInspector, for: Electric.Postgres.Inspector)
  Mox.defmock(MockStorage, for: Electric.ShapeCache.Storage)

  setup :verify_on_exit!

  @shape Shape.new!("public.test_table",
           inspector: StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])
         )

  @similar_shape Shape.new!("public.test_table",
                   inspector: StubInspector.new([%{name: "id", type: "int8", pk_position: 0}]),
                   where: "id > 5"
                 )

  @other_shape Shape.new!("public.other_table",
                 inspector: StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])
               )

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

      MockShapeStatus
      |> expect(:initialise, 1, fn opts -> {:ok, opts} end)
      |> expect(:list_shapes, 1, fn _ -> [] end)
      # allow the ShapeCache to call this mock
      |> allow(self(), fn -> GenServer.whereis(Electric.ShapeCache) end)

      # We need a ShapeCache process because it is a GenStage consumer
      # that handles the Relation events produced by ShapeLogCollector
      shape_cache_opts =
        [
          storage: {MockStorage, []},
          inspector: {MockInspector, []},
          shape_status: MockShapeStatus,
          persistent_kv: Electric.PersistentKV.Memory.new!(),
          prepare_tables_fn: fn _, _ -> {:ok, [:ok]} end,
          log_producer: __MODULE__.ShapeLogCollector,
          registry: registry_name
        ]

      {:ok, shape_cache_pid} = Electric.ShapeCache.start_link(shape_cache_opts)

      %{server: pid, registry: registry_name, consumers: consumers, shape_cache: shape_cache_pid}
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

    test "stores relation if it is not known", %{server: server, shape_cache: shape_cache} do
      relation_id = "rel1"

      rel = %Relation{
        id: relation_id,
        schema: "public",
        table: "test_table",
        columns: []
      }

      pid = self()

      MockShapeStatus
      |> expect(:get_relation, 1, fn _, ^relation_id -> nil end)
      |> expect(:store_relation, 1, fn _, ^rel -> :ok end)
      |> allow(self(), server)

      MockInspector
      |> expect(:clean_column_info, 1, fn {"public", "test_table"}, _ ->
        send(pid, :cleaned)
        true
      end)
      |> allow(self(), shape_cache)

      assert :ok = ShapeLogCollector.handle_relation_msg(rel, server)
      assert_receive :cleaned
    end

    test "does not clean shapes if relation didn't change", %{
      server: server,
      shape_cache: shape_cache
    } do
      relation_id = "rel1"

      rel = %Relation{
        id: relation_id,
        schema: "public",
        table: "test_table",
        columns: []
      }

      pid = self()

      MockShapeStatus
      |> expect(:get_relation, 1, fn _, ^relation_id -> rel end)
      |> expect(:remove_shape, 0, fn _, _ -> :ok end)

      MockInspector
      |> expect(:clean_column_info, 0, fn _, _ ->
        send(pid, :cleaned)
        true
      end)
      |> allow(self(), shape_cache)

      assert :ok = ShapeLogCollector.handle_relation_msg(rel, server)
      refute_receive :cleaned
    end

    test "cleans shapes affected by table renaming and logs a warning", %{
      server: server,
      shape_cache: shape_cache
    } do
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

      pid = self()

      MockShapeStatus
      |> expect(:get_relation, 1, fn _, ^relation_id -> old_rel end)
      |> expect(:store_relation, 1, fn _, ^new_rel -> :ok end)
      |> expect(:list_active_shapes, 1, fn _ ->
        [{shape_id1, shape1, xmin}, {shape_id2, shape2, xmin}, {shape_id3, shape3, xmin}]
      end)
      |> expect(:remove_shape, 1, fn state, ^shape_id1 -> {:ok, state} end)
      |> expect(:remove_shape, 1, fn state, ^shape_id2 -> {:ok, state} end)

      MockInspector
      |> expect(:clean_column_info, 1, fn {"public", "test_table"}, _ ->
        send(pid, :cleaned)
        true
      end)
      |> allow(self(), shape_cache)

      log =
        capture_log(fn ->
          ShapeLogCollector.handle_relation_msg(new_rel, server)
          # assert here such that we capture the log until we receive this message
          assert_receive :cleaned
        end)

      assert log =~ "Schema for the table public.test_table changed"
    end

    test "cleans shapes affected by a relation change", %{
      server: server,
      shape_cache: shape_cache
    } do
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

      pid = self()

      MockShapeStatus
      |> expect(:get_relation, 1, fn _, ^relation_id -> old_rel end)
      |> expect(:store_relation, 1, fn _, ^new_rel -> :ok end)
      |> expect(:list_active_shapes, fn _ ->
        [{shape_id1, shape1, xmin}, {shape_id2, shape2, xmin}, {shape_id3, shape3, xmin}]
      end)
      |> expect(:remove_shape, 1, fn state, ^shape_id1 -> {:ok, state} end)
      |> expect(:remove_shape, 1, fn state, ^shape_id2 -> {:ok, state} end)

      MockInspector
      |> expect(:clean_column_info, 1, fn {"public", "test_table"}, _ ->
        send(pid, :cleaned)
        true
      end)
      |> allow(self(), shape_cache)

      assert :ok = ShapeLogCollector.handle_relation_msg(new_rel, server)
      assert_receive :cleaned
    end
  end
end
