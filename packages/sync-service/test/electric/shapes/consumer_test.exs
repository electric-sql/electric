defmodule Electric.Shapes.ConsumerTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes
  alias Electric.Shapes.Shape
  alias Electric.Shapes.Consumer

  alias Support.Mock
  alias Support.StubInspector

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup

  import Mox

  @shape_id1 "#{__MODULE__}-shape1"
  @shape1 Shape.new!("public.test_table",
            inspector: StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])
          )

  @shape_id2 "#{__MODULE__}-shape2"
  @shape2 Shape.new!("public.other_table",
            inspector: StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])
          )

  @shape_position %{
    @shape_id1 => %{
      latest_offset: LogOffset.new(Lsn.from_string("0/10"), 0),
      snapshot_xmin: 100
    },
    @shape_id2 => %{
      latest_offset: LogOffset.new(Lsn.from_string("0/50"), 0),
      snapshot_xmin: 120
    }
  }

  @moduletag :capture_log

  stub(Mock.Inspector, :load_column_info, fn
    {"public", "test_table"}, _ -> {:ok, [%{name: "id", type: "int8", pk_position: 0}]}
  end)

  stub(Mock.Inspector, :get_namespace_and_tablename, fn
    "public.test_table", _ -> {"public", "test_table"}
  end)

  setup :with_electric_instance_id
  setup :set_mox_from_context
  setup :verify_on_exit!

  defp shape_status(shape_id, ctx) do
    get_in(ctx, [:shape_position, shape_id]) || raise "invalid shape_id #{shape_id}"
  end

  defp log_offset(shape_id, ctx) do
    get_in(ctx, [:shape_position, shape_id, :latest_offset]) ||
      raise "invalid shape_id #{shape_id}"
  end

  defp snapshot_xmin(shape_id, ctx) do
    get_in(ctx, [:shape_position, shape_id, :snapshot_xmin]) ||
      raise "invalid shape_id #{shape_id}"
  end

  defp lsn(shape_id, ctx) do
    %{tx_offset: offset} = log_offset(shape_id, ctx)
    Lsn.from_integer(offset)
  end

  defp prepare_tables_fn(_pool, _affected_tables), do: :ok

  describe "transaction handling" do
    setup :with_in_memory_storage

    setup(ctx) do
      shapes = Map.get(ctx, :shapes, %{@shape_id1 => @shape1, @shape_id2 => @shape2})
      shape_position = Map.get(ctx, :shape_position, @shape_position)
      [shape_position: shape_position, shapes: shapes]
    end

    setup(ctx) do
      registry_name = Module.concat(__MODULE__, Registry)
      start_link_supervised!({Registry, keys: :duplicate, name: registry_name})

      %{latest_offset: _offset1, snapshot_xmin: xmin1} = shape_status(@shape_id1, ctx)
      %{latest_offset: _offset2, snapshot_xmin: xmin2} = shape_status(@shape_id2, ctx)

      storage =
        Support.TestStorage.wrap(ctx.storage, %{
          @shape_id1 => [
            {:mark_snapshot_as_started, []},
            {:set_snapshot_xmin, [xmin1]}
          ],
          @shape_id2 => [
            {:mark_snapshot_as_started, []},
            {:set_snapshot_xmin, [xmin2]}
          ]
        })

      {:ok, producer} =
        ShapeLogCollector.start_link(
          electric_instance_id: ctx.electric_instance_id,
          demand: :forward,
          inspector:
            Support.StubInspector.new([
              %{name: "id", type: "int8", pk_position: 0}
            ])
        )

      Mock.ShapeCache
      |> stub(:cast, fn _msg, _ -> :ok end)

      consumers =
        for {shape_id, shape} <- ctx.shapes do
          allow(Mock.ShapeCache, self(), fn ->
            Shapes.Consumer.whereis(ctx.electric_instance_id, shape_id)
          end)

          {:ok, consumer} =
            start_supervised(
              {Shapes.Consumer.Supervisor,
               shape_id: shape_id,
               shape: shape,
               electric_instance_id: ctx.electric_instance_id,
               log_producer: ShapeLogCollector.name(ctx.electric_instance_id),
               registry: registry_name,
               shape_cache: {Mock.ShapeCache, []},
               storage: storage,
               chunk_bytes_threshold:
                 Electric.ShapeCache.LogChunker.default_chunk_size_threshold(),
               prepare_tables_fn: &prepare_tables_fn/2},
              id: {Shapes.Consumer.Supervisor, shape_id}
            )

          consumer
        end

      [
        producer: producer,
        registry: registry_name,
        consumers: consumers
      ]
    end

    test "appends to log when xid >= xmin", ctx do
      xid = 150
      xmin = snapshot_xmin(@shape_id1, ctx)
      last_log_offset = log_offset(@shape_id1, ctx)
      lsn = lsn(@shape_id1, ctx)

      Mock.ShapeCache
      |> expect(:update_shape_latest_offset, 2, fn @shape_id1, ^last_log_offset, _ -> :ok end)

      ref = make_ref()

      Registry.register(ctx.registry, @shape_id1, ref)

      txn =
        %Transaction{xid: xmin, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: LogOffset.first()
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)
      assert_receive {^ref, :new_changes, ^last_log_offset}, 1000
      assert_receive {Support.TestStorage, :append_to_log!, @shape_id1, _}
      refute_receive {Support.TestStorage, :append_to_log!, @shape_id2, _}

      txn2 = %{txn | xid: xid}

      assert :ok = ShapeLogCollector.store_transaction(txn2, ctx.producer)
      assert_receive {^ref, :new_changes, ^last_log_offset}, 1000
      assert_receive {Support.TestStorage, :append_to_log!, @shape_id1, _}
      refute_receive {Support.TestStorage, :append_to_log!, @shape_id2, _}
    end

    test "correctly writes only relevant changes to multiple shape logs", ctx do
      last_log_offset = log_offset(@shape_id1, ctx)
      lsn = lsn(@shape_id1, ctx)

      xid = 150

      Mock.ShapeCache
      |> expect(:update_shape_latest_offset, 2, fn
        @shape_id1, ^last_log_offset, _ -> :ok
        @shape_id2, ^last_log_offset, _ -> :ok
      end)
      |> allow(self(), Consumer.name(ctx.electric_instance_id, @shape_id1))
      |> allow(self(), Consumer.name(ctx.electric_instance_id, @shape_id2))

      ref1 = make_ref()
      ref2 = make_ref()

      Registry.register(ctx.registry, @shape_id1, ref1)
      Registry.register(ctx.registry, @shape_id2, ref2)

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: LogOffset.first()
        })
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "other_table"},
          record: %{"id" => "2"},
          log_offset: LogOffset.increment(LogOffset.first(), 1)
        })
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "something else"},
          record: %{"id" => "3"},
          log_offset: LogOffset.increment(LogOffset.first(), 2)
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)

      assert_receive {^ref1, :new_changes, ^last_log_offset}, 1000
      assert_receive {^ref2, :new_changes, ^last_log_offset}, 1000

      assert_receive {Support.TestStorage, :append_to_log!, @shape_id1,
                      [{_offset, serialized_record}]}

      assert %{"value" => %{"id" => "1"}} = Jason.decode!(serialized_record)

      assert_receive {Support.TestStorage, :append_to_log!, @shape_id2,
                      [{_offset, serialized_record}]}

      assert %{"value" => %{"id" => "2"}} = Jason.decode!(serialized_record)
    end

    @tag shapes: %{
           @shape_id1 =>
             Shape.new!("public.test_table", where: "id != 1", inspector: {Mock.Inspector, []}),
           @shape_id2 =>
             Shape.new!("public.test_table", where: "id = 1", inspector: {Mock.Inspector, []})
         }
    test "doesn't append to log when change is irrelevant for active shapes", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      ref1 = Shapes.Consumer.monitor(ctx.electric_instance_id, @shape_id1)
      ref2 = Shapes.Consumer.monitor(ctx.electric_instance_id, @shape_id2)

      Mock.ShapeCache
      |> expect(:update_shape_latest_offset, fn @shape_id2, _offset, _ -> :ok end)
      |> allow(self(), Shapes.Consumer.name(ctx.electric_instance_id, @shape_id2))

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: LogOffset.first()
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)

      assert_receive {Support.TestStorage, :append_to_log!, @shape_id2, _}
      refute_receive {Support.TestStorage, :append_to_log!, @shape_id1, _}

      refute_receive {Shapes.Consumer, ^ref1, 150}
      assert_receive {Shapes.Consumer, ^ref2, 150}
    end

    test "handles truncate without appending to log", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      Mock.ShapeCache
      |> expect(:handle_truncate, fn @shape_id1, _ -> :ok end)
      |> allow(self(), Shapes.Consumer.name(ctx.electric_instance_id, @shape_id1))

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.TruncatedRelation{
          relation: {"public", "test_table"}
        })

      assert_consumer_shutdown(ctx.electric_instance_id, @shape_id1, fn ->
        assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)
      end)

      assert_receive {Support.TestStorage, :cleanup!, @shape_id1}
      refute_receive {Support.TestStorage, :cleanup!, @shape_id2}
    end

    defp assert_consumer_shutdown(electric_instance_id, shape_id, fun) do
      monitors =
        for name <- [
              Shapes.Consumer.Supervisor.name(electric_instance_id, shape_id),
              Shapes.Consumer.name(electric_instance_id, shape_id),
              Shapes.Consumer.Snapshotter.name(electric_instance_id, shape_id)
            ],
            pid = GenServer.whereis(name) do
          ref = Process.monitor(pid)
          {ref, pid}
        end

      fun.()

      for {ref, pid} <- monitors do
        assert_receive {:DOWN, ^ref, :process, ^pid, reason}
                       when reason in [:shutdown, {:shutdown, :truncate}]
      end
    end

    @tag shapes: %{
           @shape_id1 =>
             Shape.new!("test_table",
               where: "id LIKE 'test'",
               inspector: StubInspector.new([%{pk_position: 0, name: "id"}])
             )
         }
    test "handles truncate when shape has a where clause", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      Mock.ShapeCache
      |> expect(:handle_truncate, fn @shape_id1, _ -> :ok end)
      |> allow(self(), Shapes.Consumer.name(ctx.electric_instance_id, @shape_id1))

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.TruncatedRelation{
          relation: {"public", "test_table"}
        })

      assert_consumer_shutdown(ctx.electric_instance_id, @shape_id1, fn ->
        assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)
      end)

      refute_receive {Support.TestStorage, :append_to_log!, @shape_id1, _}
      assert_receive {Support.TestStorage, :cleanup!, @shape_id1}
      refute_receive {Support.TestStorage, :cleanup!, @shape_id2}
    end

    test "notifies listeners of new changes", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      Mock.ShapeCache
      |> expect(:update_shape_latest_offset, fn @shape_id1, ^last_log_offset, _ -> :ok end)
      |> allow(self(), Consumer.name(ctx.electric_instance_id, @shape_id1))

      ref = make_ref()
      Registry.register(ctx.registry, @shape_id1, ref)

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: LogOffset.first()
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)
      assert_receive {Support.TestStorage, :append_to_log!, @shape_id1, _}
      assert_receive {^ref, :new_changes, ^last_log_offset}, 1000
    end
  end

  describe "transaction handling with real storage" do
    setup do
      %{inspector: Support.StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])}
    end

    setup [
      {Support.ComponentSetup, :with_registry},
      {Support.ComponentSetup, :with_in_memory_storage},
      {Support.ComponentSetup, :with_persistent_kv},
      {Support.ComponentSetup, :with_log_chunking},
      {Support.ComponentSetup, :with_shape_log_collector}
    ]

    setup(ctx) do
      snapshot_delay = Map.get(ctx, :snapshot_delay, nil)

      %{shape_cache_opts: shape_cache_opts} =
        Support.ComponentSetup.with_shape_cache(
          Map.merge(ctx, %{
            pool: nil,
            inspector: StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])
          }),
          log_producer: ctx.shape_log_collector,
          prepare_tables_fn: fn _, _ -> :ok end,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            if is_integer(snapshot_delay), do: Process.sleep(snapshot_delay)
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      [
        producer: ctx.shape_log_collector,
        shape_cache_opts: shape_cache_opts
      ]
    end

    test "duplicate transactions storage is idempotent", ctx do
      %{
        storage: storage,
        shape_cache_opts: shape_cache_opts
      } = ctx

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape1, shape_cache_opts)

      :started =
        ShapeCache.await_snapshot_start(
          shape_id,
          shape_cache_opts
        )

      lsn = Lsn.from_integer(10)

      ref = Shapes.Consumer.monitor(ctx.electric_instance_id, shape_id)

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

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)

      assert_receive {Shapes.Consumer, ^ref, 11}

      shape_storage = Storage.for_shape(shape_id, storage)

      assert [op1, op2] =
               Storage.get_log_stream(LogOffset.before_all(), shape_storage)
               |> Enum.map(&:json.decode/1)

      # If we encounter & store the same transaction, log stream should be stable
      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)

      assert_receive {Shapes.Consumer, ^ref, 11}

      assert [^op1, ^op2] =
               Storage.get_log_stream(LogOffset.before_all(), shape_storage)
               |> Enum.map(&:json.decode/1)
    end

    @tag snapshot_delay: 100
    test "transactions are buffered until snapshot xmin is known", ctx do
      %{
        storage: storage,
        shape_cache_opts: shape_cache_opts
      } = ctx

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape1, shape_cache_opts)

      lsn1 = Lsn.from_integer(9)
      lsn2 = Lsn.from_integer(10)

      ref = Shapes.Consumer.monitor(ctx.electric_instance_id, shape_id)

      txn1 =
        %Transaction{xid: 9, lsn: lsn1, last_log_offset: LogOffset.new(lsn1, 2)}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2"},
          log_offset: LogOffset.new(lsn1, 2)
        })
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: LogOffset.new(lsn1, 0)
        })

      txn2 =
        %Transaction{xid: 10, lsn: lsn2, last_log_offset: LogOffset.new(lsn2, 2)}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2"},
          log_offset: LogOffset.new(lsn2, 2)
        })
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: LogOffset.new(lsn2, 0)
        })

      assert :ok = ShapeLogCollector.store_transaction(txn1, ctx.producer)
      assert :ok = ShapeLogCollector.store_transaction(txn2, ctx.producer)

      :started = ShapeCache.await_snapshot_start(shape_id, shape_cache_opts)

      assert_receive {Shapes.Consumer, ^ref, 10}

      shape_storage = Storage.for_shape(shape_id, storage)

      assert [_op1, _op2] =
               Storage.get_log_stream(LogOffset.before_all(), shape_storage)
               |> Enum.map(&:json.decode/1)
    end
  end

  defmodule CrashingStorageBackend do
    use GenServer

    alias Electric.Replication.LogOffset

    def start_link(_opts) do
      GenServer.start_link(__MODULE__, [], name: __MODULE__)
    end

    def crash_once(pid, shape_id) do
      GenServer.call(pid, {:crash_once, shape_id})
    end

    def crash?(pid, shape_id) do
      GenServer.call(pid, {:crash?, shape_id})
    end

    def init(_opts) do
      {:ok, %{shapes: %{}, crashing: %{}}}
    end

    def handle_call({:crash_once, shape_id}, _from, state) do
      {:reply, :ok, Map.update!(state, :crashing, &Map.put(&1, shape_id, true))}
    end

    def handle_call({:crash?, shape_id}, _from, state) do
      {crash?, crashing} = Map.pop(state.crashing, shape_id, false)

      {:reply, crash?, %{state | crashing: crashing}}
    end

    def handle_call({:get_current_position, shape_id}, _from, state) do
      %{latest_offset: offset, snapshot_xmin: xmin} =
        Map.get(state.shapes, shape_id, %{latest_offset: LogOffset.first(), snapshot_xmin: nil})

      {:reply, {:ok, offset, xmin}, state}
    end

    def handle_call({:snapshot_started?, shape_id}, _from, state) do
      {:reply, Map.has_key?(state.shapes, shape_id), state}
    end

    def handle_call({:set_snapshot_xmin, shape_id, xmin}, _from, state) do
      {:reply, :ok,
       %{
         state
         | shapes:
             Map.put(state.shapes, shape_id, %{
               snapshot_xmin: xmin,
               latest_offset: LogOffset.first()
             })
       }}
    end
  end

  defmodule CrashingStorage do
    # Between this module and the CrashingStorageBackend above, implement
    # enough of the storage api to:
    #
    # 1. Only snapshot a given shape_id once
    # 2. Allow for writing to the tx log of a given shape to crash

    def start_link(%{} = _opts) do
      :ignore
    end

    def for_shape(shape_id, opts) do
      Map.put(opts, :shape_id, shape_id)
    end

    def initialise(_opts) do
      :ok
    end

    def snapshot_started?(opts) do
      GenServer.call(opts.backend, {:snapshot_started?, opts.shape_id})
    end

    def get_current_position(opts) do
      GenServer.call(opts.backend, {:get_current_position, opts.shape_id})
    end

    def append_to_log!(log_items, %{shape_id: shape_id} = opts) do
      if CrashingStorageBackend.crash?(opts.backend, shape_id) do
        send(opts.parent, {CrashingStorage, :crash, shape_id})
        raise "crash from #{shape_id}"
      else
        for {offset, _data} <- log_items do
          send(opts.parent, {CrashingStorage, :append_to_log, shape_id, offset})
        end
      end

      :ok
    end

    def set_snapshot_xmin(xmin, opts) do
      GenServer.call(opts.backend, {:set_snapshot_xmin, opts.shape_id, xmin})
    end

    def mark_snapshot_as_started(_opts) do
      :ok
    end

    def make_new_snapshot!(_data_stream, _opts) do
      :ok
    end
  end

  describe "replication consistency" do
    setup [
      :with_unique_db,
      :with_basic_tables,
      :with_publication,
      :with_registry,
      :with_inspector,
      :with_persistent_kv
    ]

    setup do
      %{slot_name: "electric_shapes_consumertest_replication_stream"}
    end

    test "crashing consumer resumes at a consistent point", ctx do
      {:ok, pid} = start_supervised(CrashingStorageBackend)
      parent = self()
      storage = {CrashingStorage, %{backend: pid, parent: parent, shape_id: nil}}

      shape_cache_name = __MODULE__.ShapeCache

      shape_cache_opts = [
        server: shape_cache_name,
        shape_meta_table: __MODULE__.ShapeMeta
      ]

      replication_opts = [
        publication_name: ctx.publication_name,
        try_creating_publication?: true,
        slot_name: ctx.slot_name,
        transaction_received: {
          ShapeLogCollector,
          :store_transaction,
          [ShapeLogCollector.name(ctx.electric_instance_id)]
        },
        relation_received: {
          ShapeLogCollector,
          :handle_relation_msg,
          [ShapeLogCollector.name(ctx.electric_instance_id)]
        }
      ]

      get_pg_version = fn -> Application.fetch_env!(:electric, :pg_version_for_tests) end

      shape_cache_config =
        [
          name: shape_cache_name,
          electric_instance_id: ctx.electric_instance_id,
          shape_meta_table: __MODULE__.ShapeMeta,
          storage: storage,
          db_pool: ctx.pool,
          persistent_kv: ctx.persistent_kv,
          registry: ctx.registry,
          inspector: ctx.inspector,
          chunk_bytes_threshold: Electric.ShapeCache.LogChunker.default_chunk_size_threshold(),
          log_producer: ShapeLogCollector.name(ctx.electric_instance_id),
          consumer_supervisor: Electric.Shapes.ConsumerSupervisor.name(ctx.electric_instance_id),
          prepare_tables_fn: {
            Electric.Postgres.Configuration,
            :configure_tables_for_replication!,
            [get_pg_version, ctx.publication_name]
          },
          create_snapshot_fn: fn parent, shape_id, _shape, _, _storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 0})
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        ]

      {:ok, _super} =
        Electric.Shapes.Supervisor.start_link(
          electric_instance_id: ctx.electric_instance_id,
          log_collector:
            {ShapeLogCollector,
             electric_instance_id: ctx.electric_instance_id, inspector: ctx.inspector},
          replication_client:
            {Electric.Postgres.ReplicationClient,
             connection_opts: ctx.db_config,
             replication_opts: replication_opts,
             connection_manager: nil},
          shape_cache: {Electric.ShapeCache, shape_cache_config},
          consumer_supervisor:
            {Electric.Shapes.ConsumerSupervisor, electric_instance_id: ctx.electric_instance_id}
        )

      %{db_conn: conn} = ctx

      shape1 = Shape.new!("public.items", inspector: ctx.inspector)

      shape2 =
        Shape.new!("public.items", where: "value != 'invalid'", inspector: ctx.inspector)

      assert {shape_id1, _} =
               Electric.ShapeCache.get_or_create_shape_id(shape1, shape_cache_opts)

      assert {shape_id2, _} =
               Electric.ShapeCache.get_or_create_shape_id(shape2, shape_cache_opts)

      assert :started = Electric.ShapeCache.await_snapshot_start(shape_id1, shape_cache_opts)
      assert :started = Electric.ShapeCache.await_snapshot_start(shape_id2, shape_cache_opts)

      insert_item(conn, "value 1")

      assert_receive {CrashingStorage, :append_to_log, ^shape_id1, offset1}
      assert_receive {CrashingStorage, :append_to_log, ^shape_id2, ^offset1}

      :ok = CrashingStorageBackend.crash_once(pid, shape_id2)

      insert_item(conn, "value 2")

      assert_receive {CrashingStorage, :append_to_log, ^shape_id1, offset2}
      assert_receive {CrashingStorage, :crash, ^shape_id2}

      # the whole stack has restarted, but we still get this message
      assert_receive {CrashingStorage, :append_to_log, ^shape_id1, ^offset2}, 5000
      assert_receive {CrashingStorage, :append_to_log, ^shape_id2, ^offset2}
    end

    defp insert_item(conn, val) do
      Postgrex.query!(conn, "INSERT INTO items (id, value) VALUES ($1, $2)", [
        Ecto.UUID.bingenerate(),
        val
      ])
    end
  end
end
