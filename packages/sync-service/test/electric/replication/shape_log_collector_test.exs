defmodule Electric.Replication.ShapeLogCollectorTest do
  use ExUnit.Case, async: true
  import ExUnit.CaptureLog
  import Mox

  alias Electric.Postgres.Lsn
  alias Electric.Replication.ShapeLogCollector
  alias Electric.Replication.Changes.{Relation, Transaction}
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
  end

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

  # GARRY-TODO: is this right?
  describe "handle_relation_msg/2" do
    setup do
      # Start a test Registry
      registry_name = Module.concat(__MODULE__, Registry)
      start_link_supervised!({Registry, keys: :duplicate, name: registry_name})

      # Start the ShapeLogCollector process
      opts = [
        name: :test_shape_log_storage,
        registry: registry_name,
        shape_cache: {MockShapeCache, []},
        inspector: {MockInspector, []}
      ]

      {:ok, pid} = start_supervised({ShapeLogCollector, opts})
      %{server: pid, registry: registry_name}
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

      assert :ok = ShapeLogCollector.handle_relation_msg(new_rel, server)
    end
  end
end
