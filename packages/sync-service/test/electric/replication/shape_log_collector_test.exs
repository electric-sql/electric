defmodule Electric.Replication.ShapeLogCollectorTest do
  use ExUnit.Case, async: true
  import Mox

  alias Electric.ShapeCache
  alias Electric.ShapeCache.Storage
  alias Support.StubInspector
  alias Electric.Replication.Eval.Parser
  alias Electric.Shapes.Shape
  alias Electric.Postgres.Lsn
  alias Electric.Replication.ShapeLogCollector
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset

  @moduletag :capture_log

  # Define mocks
  Mox.defmock(MockShapeCache, for: Electric.ShapeCacheBehaviour)
  Mox.defmock(MockStorage, for: Electric.ShapeCache.Storage)
  Mox.defmock(MockInspector, for: Electric.Postgres.Inspector)

  setup :verify_on_exit!

  @shape Shape.new!("public.test_table",
           inspector: StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])
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
        name: :test_shape_log_storage,
        registry: registry_name,
        shape_cache: {MockShapeCache, []},
        inspector: {MockInspector, []}
      ]

      {:ok, pid} = start_supervised({ShapeLogCollector, opts})
      %{server: pid, registry: registry_name}
    end

    test "appends to log when xid >= xmin", %{server: server} do
      shape_id = "shape1"
      shape = @shape
      xmin = 100
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      MockShapeCache
      |> expect(:list_active_shapes, 2, fn _ -> [{shape_id, shape, xmin}] end)
      |> expect(:append_to_log!, 2, fn ^shape_id, ^last_log_offset, _, _ -> :ok end)
      |> allow(self(), server)

      MockInspector
      |> expect(:load_column_info, 2, fn {"public", "test_table"}, _ ->
        {:ok, [%{pk_position: 0, name: "id"}]}
      end)
      |> allow(self(), server)

      txn =
        %Transaction{xid: xmin, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, server)

      txn2 = %{txn | xid: xid}

      assert :ok = ShapeLogCollector.store_transaction(txn2, server)
    end

    test "doesn't append to log when xid < xmin", %{server: server} do
      shape_id = "shape1"
      shape = @shape
      xmin = 200
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      MockShapeCache
      |> expect(:list_active_shapes, fn _ -> [{shape_id, shape, xmin}] end)
      |> allow(self(), server)

      MockInspector
      |> expect(:load_column_info, fn {"public", "test_table"}, _ ->
        {:ok, [%{pk_position: 0, name: "id"}]}
      end)
      |> allow(self(), server)

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, server)
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
      last_log_offset = LogOffset.new(lsn, 0)

      MockShapeCache
      |> expect(:list_active_shapes, fn _ -> [{shape_id, shape, xmin}] end)
      |> allow(self(), server)

      MockInspector
      |> expect(:load_column_info, fn {"public", "test_table"}, _ ->
        {:ok, [%{pk_position: 0, name: "id"}]}
      end)
      |> allow(self(), server)

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, server)
    end

    test "handles truncate without appending to log", %{server: server} do
      shape_id = "shape1"
      shape = @shape
      xmin = 100
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      # The fact that we don't expect `append_to_log` is enough to prove that it wasn't called.
      MockShapeCache
      |> expect(:list_active_shapes, fn _ -> [{shape_id, shape, xmin}] end)
      |> expect(:handle_truncate, fn _, ^shape_id -> :ok end)
      |> allow(self(), server)

      MockInspector
      |> expect(:load_column_info, fn {"public", "test_table"}, _ ->
        {:ok, [%{pk_position: 0, name: "id"}]}
      end)
      |> allow(self(), server)

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.TruncatedRelation{
          relation: {"public", "test_table"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, server)
    end

    test "handles truncate when shape has a where clause", %{server: server} do
      shape_id = "shape1"

      shape =
        Shape.new!("test_table",
          where: "id LIKE 'test'",
          inspector: StubInspector.new([%{pk_position: 0, name: "id"}])
        )

      xmin = 100
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      # The fact that we don't expect `append_to_log` is enough to prove that it wasn't called.
      MockShapeCache
      |> expect(:list_active_shapes, fn _ -> [{shape_id, shape, xmin}] end)
      |> expect(:handle_truncate, fn _, ^shape_id -> :ok end)
      |> allow(self(), server)

      MockInspector
      |> expect(:load_column_info, fn {"public", "test_table"}, _ ->
        {:ok, [%{pk_position: 0, name: "id"}]}
      end)
      |> allow(self(), server)

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.TruncatedRelation{
          relation: {"public", "test_table"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, server)
    end

    test "notifies listeners of new changes", %{server: server, registry: registry} do
      shape_id = "shape1"
      shape = @shape
      xmin = 100
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      MockShapeCache
      |> expect(:list_active_shapes, fn _ -> [{shape_id, shape, xmin}] end)
      |> expect(:append_to_log!, fn ^shape_id, ^last_log_offset, _, _ -> :ok end)
      |> allow(self(), server)

      MockInspector
      |> expect(:load_column_info, fn {"public", "test_table"}, _ ->
        {:ok, [%{pk_position: 0, name: "id"}]}
      end)
      |> allow(self(), server)

      ref = make_ref()
      Registry.register(registry, shape_id, ref)

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, server)
      assert_receive {^ref, :new_changes, ^last_log_offset}, 1000
    end

    test "correctly writes only relevant changes to multiple shape logs", %{server: server} do
      shape1 = "shape1"
      shape2 = "shape2"
      xmin = 100
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      MockShapeCache
      |> expect(:list_active_shapes, fn _ ->
        [
          {shape1, @shape, xmin},
          {shape2, @other_shape, xmin}
        ]
      end)
      |> expect(:append_to_log!, fn ^shape1, ^last_log_offset, [%{value: record}], _ ->
        assert record["id"] == "1"
        :ok
      end)
      |> expect(:append_to_log!, fn ^shape2, ^last_log_offset, [%{value: record}], _ ->
        assert record["id"] == "2"
        :ok
      end)
      |> allow(self(), server)

      MockInspector
      |> expect(:load_column_info, 3, fn
        {"public", "test_table"}, _ -> {:ok, [%{pk_position: 0, name: "id"}]}
        {"public", "other_table"}, _ -> {:ok, [%{pk_position: 0, name: "id"}]}
        {"public", "something else"}, _ -> {:ok, [%{pk_position: 0, name: "id"}]}
      end)
      |> allow(self(), server)

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"}
        })
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "other_table"},
          record: %{"id" => "2"}
        })
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "something else"},
          record: %{"id" => "3"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, server)
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
            GenServer.cast(parent, {:snapshot_ready, shape_id})
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
      :ready = ShapeCache.wait_for_snapshot(Keyword.fetch!(shape_cache_opts, :server), shape_id)

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
               |> Enum.to_list()
               |> Enum.map(&:json.decode/1)
    end
  end
end
