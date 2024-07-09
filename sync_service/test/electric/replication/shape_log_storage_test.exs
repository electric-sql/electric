defmodule Electric.Replication.ShapeLogStorageTest do
  use ExUnit.Case, async: true
  import Mox

  alias Electric.Replication.Eval.Parser
  alias Electric.Shapes.Shape
  alias Electric.Postgres.Lsn
  alias Electric.Replication.ShapeLogStorage
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes

  @moduletag :capture_log

  # Define mocks
  Mox.defmock(MockShapeCache, for: Electric.ShapeCacheBehaviour)
  Mox.defmock(MockStorage, for: Electric.ShapeCache.Storage)

  setup :verify_on_exit!

  setup do
    # Start a test Registry
    registry_name = Module.concat(__MODULE__, Registry)
    start_link_supervised!({Registry, keys: :duplicate, name: registry_name})

    # Start the ShapeLogStorage process
    opts = [
      name: :test_shape_log_storage,
      storage: {MockStorage, []},
      registry: registry_name,
      shape_cache: {MockShapeCache, []}
    ]

    {:ok, pid} = start_supervised({ShapeLogStorage, opts})
    %{server: pid, registry: registry_name}
  end

  describe "store_transaction/2" do
    test "appends to log when xid >= xmin", %{server: server} do
      shape_id = "shape1"
      shape = %Shape{root_table: {"public", "test_table"}}
      xmin = 100
      xid = 150
      lsn = Lsn.from_string("0/10")

      MockShapeCache
      |> expect(:list_active_shapes, 2, fn _ -> [{shape_id, shape, xmin}] end)
      |> allow(self(), server)

      MockStorage
      |> expect(:append_to_log!, fn ^shape_id, ^lsn, ^xmin, _, _ -> :ok end)
      |> expect(:append_to_log!, fn ^shape_id, ^lsn, ^xid, _, _ -> :ok end)
      |> allow(self(), server)

      txn = %Transaction{
        xid: xmin,
        changes: [%Changes.NewRecord{relation: {"public", "test_table"}, record: %{"id" => "1"}}],
        lsn: lsn
      }

      assert :ok = ShapeLogStorage.store_transaction(txn, server)

      txn = %Transaction{
        xid: xid,
        changes: [%Changes.NewRecord{relation: {"public", "test_table"}, record: %{"id" => "1"}}],
        lsn: lsn
      }

      assert :ok = ShapeLogStorage.store_transaction(txn, server)
    end

    test "doesn't append to log when xid < xmin", %{server: server} do
      shape_id = "shape1"
      shape = %Shape{root_table: {"public", "test_table"}}
      xmin = 200
      xid = 150
      lsn = Lsn.from_string("0/10")

      MockShapeCache
      |> expect(:list_active_shapes, fn _ -> [{shape_id, shape, xmin}] end)
      |> allow(self(), server)

      txn = %Transaction{
        xid: xid,
        changes: [%Changes.NewRecord{relation: {"public", "test_table"}, record: %{"id" => "1"}}],
        lsn: lsn
      }

      assert :ok = ShapeLogStorage.store_transaction(txn, server)
    end

    test "doesn't append to log when change is irrelevant for active shapes", %{server: server} do
      shape_id = "shape1"

      shape = %Shape{
        root_table: {"public", "test_table"},
        where: Parser.parse_and_validate_expression!("id != 1", %{["id"] => :int4})
      }

      xmin = 100
      xid = 150
      lsn = Lsn.from_string("0/10")

      MockShapeCache
      |> expect(:list_active_shapes, fn _ -> [{shape_id, shape, xmin}] end)
      |> allow(self(), server)

      txn = %Transaction{
        xid: xid,
        changes: [%Changes.NewRecord{relation: {"public", "test_table"}, record: %{"id" => "1"}}],
        lsn: lsn
      }

      assert :ok = ShapeLogStorage.store_transaction(txn, server)
    end

    test "handles truncate without appending to log", %{server: server} do
      shape_id = "shape1"
      shape = %Shape{root_table: {"public", "test_table"}}
      xmin = 100
      xid = 150
      lsn = Lsn.from_string("0/10")

      # The fact that we don't expect `append_to_log` is enough to prove that it wasn't called.
      MockShapeCache
      |> expect(:list_active_shapes, fn _ -> [{shape_id, shape, xmin}] end)
      |> expect(:handle_truncate, fn _, ^shape_id -> :ok end)
      |> allow(self(), server)

      txn = %Transaction{
        xid: xid,
        changes: [%Changes.TruncatedRelation{relation: {"public", "test_table"}}],
        lsn: lsn
      }

      assert :ok = ShapeLogStorage.store_transaction(txn, server)
    end

    test "notifies listeners of new changes", %{server: server, registry: registry} do
      shape_id = "shape1"
      shape = %Shape{root_table: {"public", "test_table"}}
      xmin = 100
      xid = 150
      lsn = Lsn.from_string("0/10")

      MockShapeCache
      |> expect(:list_active_shapes, fn _ -> [{shape_id, shape, xmin}] end)
      |> allow(self(), server)

      MockStorage
      |> expect(:append_to_log!, fn ^shape_id, ^lsn, ^xid, _, _ -> :ok end)
      |> allow(self(), server)

      ref = make_ref()
      Registry.register(registry, shape_id, ref)

      txn = %Transaction{
        xid: xid,
        changes: [%Changes.NewRecord{relation: {"public", "test_table"}, record: %{"id" => "1"}}],
        lsn: lsn
      }

      assert :ok = ShapeLogStorage.store_transaction(txn, server)
      assert_receive {^ref, :new_changes, ^lsn}, 1000
    end

    test "correctly writes only relevant changes to multiple shape logs", %{server: server} do
      shape1 = "shape1"
      shape2 = "shape2"
      xmin = 100
      xid = 150
      lsn = Lsn.from_string("0/10")

      MockShapeCache
      |> expect(:list_active_shapes, fn _ ->
        [
          {shape1, %Shape{root_table: {"public", "test_table"}}, xmin},
          {shape2, %Shape{root_table: {"public", "other_table"}}, xmin}
        ]
      end)
      |> allow(self(), server)

      MockStorage
      |> expect(:append_to_log!, fn ^shape1, ^lsn, ^xid, [change], _ ->
        assert change.record["id"] == "1"
        :ok
      end)
      |> expect(:append_to_log!, fn ^shape2, ^lsn, ^xid, [change], _ ->
        assert change.record["id"] == "2"
        :ok
      end)
      |> allow(self(), server)

      txn = %Transaction{
        xid: xid,
        changes: [
          %Changes.NewRecord{relation: {"public", "test_table"}, record: %{"id" => "1"}},
          %Changes.NewRecord{relation: {"public", "other_table"}, record: %{"id" => "2"}},
          %Changes.NewRecord{relation: {"public", "something else"}, record: %{"id" => "3"}}
        ],
        lsn: lsn
      }

      assert :ok = ShapeLogStorage.store_transaction(txn, server)
    end
  end
end
