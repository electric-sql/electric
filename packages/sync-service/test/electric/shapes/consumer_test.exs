defmodule Electric.Shapes.ConsumerTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes.{Transaction, Relation}
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
  import Support.TestUtils, only: [with_electric_instance_id: 1]

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

  stub(Mock.Inspector, :load_relation, fn
    tbl, _ -> StubInspector.load_relation(tbl, nil)
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

  defp run_with_conn_noop(conn, cb), do: cb.(conn)

  describe "event handling" do
    setup [:with_in_memory_storage]

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

      consumers =
        for {shape_id, shape} <- ctx.shapes do
          Mock.ShapeStatus
          |> expect(:initialise_shape, 1, fn _, ^shape_id, _, _ -> :ok end)
          |> expect(:set_snapshot_xmin, 1, fn _, ^shape_id, _ -> :ok end)
          |> expect(:mark_snapshot_started, 1, fn _, ^shape_id -> :ok end)
          |> allow(self(), fn ->
            Shapes.Consumer.whereis(ctx.electric_instance_id, shape_id)
          end)

          Mock.ShapeCache
          |> allow(self(), fn ->
            Shapes.Consumer.whereis(ctx.electric_instance_id, shape_id)
          end)

          {:ok, consumer} =
            start_supervised(
              {Shapes.Consumer.Supervisor,
               shape_id: shape_id,
               shape: shape,
               electric_instance_id: ctx.electric_instance_id,
               inspector: {Mock.Inspector, []},
               log_producer: ShapeLogCollector.name(ctx.electric_instance_id),
               registry: registry_name,
               shape_cache: {Mock.ShapeCache, []},
               shape_status: {Mock.ShapeStatus, []},
               storage: storage,
               chunk_bytes_threshold:
                 Electric.ShapeCache.LogChunker.default_chunk_size_threshold(),
               run_with_conn_fn: &run_with_conn_noop/2,
               prepare_tables_fn: &prepare_tables_fn/2},
              id: {Shapes.Consumer.Supervisor, shape_id}
            )

          assert_receive {Support.TestStorage, :set_shape_definition, ^shape_id, ^shape}

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
      |> allow(self(), Consumer.name(ctx.electric_instance_id, @shape_id1))

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

    test "does not clean shapes if relation didn't change", ctx do
      rel = %Relation{
        # ensure relation OID does not match any of the shapes
        id: @shape1.root_table_id + @shape2.root_table_id,
        schema: "ranndom",
        table: "definitely_different",
        columns: []
      }

      ref1 =
        Process.monitor(GenServer.whereis(Consumer.name(ctx.electric_instance_id, @shape_id1)))

      ref2 =
        Process.monitor(GenServer.whereis(Consumer.name(ctx.electric_instance_id, @shape_id2)))

      Mock.ShapeStatus
      |> expect(:remove_shape, 0, fn _, _ -> :ok end)
      |> allow(self(), Consumer.name(ctx.electric_instance_id, @shape_id1))
      |> expect(:remove_shape, 0, fn _, _ -> :ok end)
      |> allow(self(), Consumer.name(ctx.electric_instance_id, @shape_id2))

      assert :ok = ShapeLogCollector.handle_relation_msg(rel, ctx.producer)

      refute_receive {:DOWN, ^ref1, :process, _, _}
      refute_receive {:DOWN, ^ref2, :process, _, _}
    end

    test "cleans shapes affected by a relation rename", ctx do
      {orig_schema, _} = @shape1.root_table

      rel = %Relation{
        id: @shape1.root_table_id,
        schema: orig_schema,
        table: "definitely_different",
        columns: []
      }

      ref1 =
        Process.monitor(GenServer.whereis(Consumer.name(ctx.electric_instance_id, @shape_id1)))

      ref2 =
        Process.monitor(GenServer.whereis(Consumer.name(ctx.electric_instance_id, @shape_id2)))

      # also cleans up inspector cache and shape status cache
      Mock.Inspector
      |> expect(:clean, 1, fn _, _ -> true end)
      |> allow(self(), Consumer.name(ctx.electric_instance_id, @shape_id1))
      |> expect(:clean, 0, fn _, _ -> true end)
      |> allow(self(), Consumer.name(ctx.electric_instance_id, @shape_id2))

      Mock.ShapeStatus
      |> expect(:remove_shape, 1, fn _, _ -> :ok end)
      |> allow(self(), Consumer.name(ctx.electric_instance_id, @shape_id1))
      |> expect(:remove_shape, 0, fn _, _ -> :ok end)
      |> allow(self(), Consumer.name(ctx.electric_instance_id, @shape_id2))

      assert :ok = ShapeLogCollector.handle_relation_msg(rel, ctx.producer)

      assert_receive {:DOWN, ^ref1, :process, _, _}
      refute_receive {:DOWN, ^ref2, :process, _, _}
    end

    test "cleans shapes affected by a relation change", ctx do
      {orig_schema, orig_table} = @shape1.root_table

      rel = %Relation{
        id: @shape1.root_table_id,
        schema: orig_schema,
        table: orig_table,
        columns: [
          # specify different columns
          %{name: "id", type_oid: {999, 1}}
        ]
      }

      ref1 =
        Process.monitor(GenServer.whereis(Consumer.name(ctx.electric_instance_id, @shape_id1)))

      ref2 =
        Process.monitor(GenServer.whereis(Consumer.name(ctx.electric_instance_id, @shape_id2)))

      # also cleans up inspector cache and shape status cache
      Mock.Inspector
      |> expect(:clean, 1, fn _, _ -> true end)
      |> allow(self(), Consumer.name(ctx.electric_instance_id, @shape_id1))
      |> expect(:clean, 0, fn _, _ -> true end)
      |> allow(self(), Consumer.name(ctx.electric_instance_id, @shape_id2))

      Mock.ShapeStatus
      |> expect(:remove_shape, 1, fn _, _ -> :ok end)
      |> allow(self(), Consumer.name(ctx.electric_instance_id, @shape_id1))
      |> expect(:remove_shape, 0, fn _, _ -> :ok end)
      |> allow(self(), Consumer.name(ctx.electric_instance_id, @shape_id2))

      assert :ok = ShapeLogCollector.handle_relation_msg(rel, ctx.producer)

      assert_receive {:DOWN, ^ref1, :process, _, _}
      refute_receive {:DOWN, ^ref2, :process, _, _}
    end
  end

  describe "transaction handling with real storage" do
    setup do
      %{inspector: Support.StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])}
    end

    setup [
      {Support.ComponentSetup, :with_registry},
      {Support.ComponentSetup, :with_in_memory_storage},
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
          run_with_conn_fn: &run_with_conn_noop/2,
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
end
