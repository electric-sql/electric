defmodule Electric.Shapes.ConsumerTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes
  alias Electric.Shapes.Shape
  alias Electric.Shapes.Consumer

  alias Support.Mock
  alias Support.StubInspector

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

  setup :set_mox_from_context
  setup :verify_on_exit!

  setup(ctx) do
    shapes = Map.get(ctx, :shapes, %{@shape_id1 => @shape1, @shape_id2 => @shape2})
    shape_position = Map.get(ctx, :shape_position, @shape_position)
    [shape_position: shape_position, shapes: shapes]
  end

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
    setup(ctx) do
      registry_name = Module.concat(__MODULE__, Registry)
      start_link_supervised!({Registry, keys: :duplicate, name: registry_name})

      {:ok, producer} = Support.TransactionProducer.start_link([])

      count = map_size(ctx.shapes)

      Mock.Storage
      |> stub(:for_shape, fn shape_id, opts -> {shape_id, opts} end)
      |> expect(:start_link, count, fn {_shape_id, _opts} -> :ignore end)

      Mock.Storage
      |> expect(:add_shape, count, fn shape_id, _shape, {shape_id, _opts} -> :ok end)
      |> expect(:initialise, count, fn {_shape_id, _opts} -> :ok end)
      |> expect(:list_shapes, count, fn {shape_id, _opts} -> [shape_status(shape_id, ctx)] end)
      |> stub(:snapshot_started?, fn _, _ -> true end)

      consumers =
        for {shape_id, shape} <- ctx.shapes do
          allow(Mock.Storage, self(), fn ->
            Shapes.Supervisor.name(shape_id) |> GenServer.whereis()
          end)

          allow(Mock.Storage, self(), fn ->
            Shapes.Consumer.name(shape_id) |> GenServer.whereis()
          end)

          allow(Mock.Storage, self(), fn ->
            Shapes.Snapshotter.name(shape_id) |> GenServer.whereis()
          end)

          {:ok, consumer} =
            start_supervised(
              {Shapes.Supervisor,
               shape_id: shape_id,
               shape: shape,
               log_producer: producer,
               registry: registry_name,
               shape_cache: {Mock.ShapeCache, []},
               storage: {Mock.Storage, []},
               prepare_tables_fn: &prepare_tables_fn/2},
              id: {Shapes.Supervisor, shape_id}
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
      |> allow(self(), Consumer.name(@shape_id1))

      Mock.Storage
      |> expect(:append_to_log!, 2, fn @shape_id1, _changes, _, _ -> :ok end)
      |> allow(self(), Consumer.name(@shape_id1))

      Mock.Storage
      |> expect(:append_to_log!, 0, fn @shape_id2, _changes, _, _ -> :ok end)
      |> allow(self(), Consumer.name(@shape_id2))

      ref = make_ref()

      Registry.register(ctx.registry, @shape_id1, ref)

      txn =
        %Transaction{xid: xmin, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"}
        })

      assert :ok = Support.TransactionProducer.emit(ctx.producer, [txn])
      assert_receive {^ref, :new_changes, ^last_log_offset}, 1000

      txn2 = %{txn | xid: xid}

      assert :ok = Support.TransactionProducer.emit(ctx.producer, [txn2])
      assert_receive {^ref, :new_changes, ^last_log_offset}, 1000
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
      |> allow(self(), Consumer.name(@shape_id1))
      |> allow(self(), Consumer.name(@shape_id2))

      Mock.Storage
      |> expect(:append_to_log!, 2, fn
        @shape_id1, [%{value: record}], _, {@shape_id1, _} ->
          assert record["id"] == "1"
          :ok

        @shape_id2, [%{value: record}], _, {@shape_id2, _} ->
          assert record["id"] == "2"
          :ok
      end)
      |> allow(self(), Consumer.name(@shape_id1))
      |> allow(self(), Consumer.name(@shape_id2))

      ref1 = make_ref()
      ref2 = make_ref()

      Registry.register(ctx.registry, @shape_id1, ref1)
      Registry.register(ctx.registry, @shape_id2, ref2)

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

      assert :ok = Support.TransactionProducer.emit(ctx.producer, [txn])

      assert_receive {^ref1, :new_changes, ^last_log_offset}, 1000
      assert_receive {^ref2, :new_changes, ^last_log_offset}, 1000
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

      ref1 = Shapes.Consumer.monitor(@shape_id1)
      ref2 = Shapes.Consumer.monitor(@shape_id2)

      Mock.ShapeCache
      |> expect(:update_shape_latest_offset, fn @shape_id2, _offset, _ -> :ok end)
      |> allow(self(), Shapes.Consumer.name(@shape_id2))

      Mock.Storage
      |> expect(:append_to_log!, fn @shape_id2, _, _, _ -> :ok end)

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"}
        })

      assert :ok = Support.TransactionProducer.emit(ctx.producer, [txn])

      refute_receive {Shapes.Consumer, ^ref1, 150}
      assert_receive {Shapes.Consumer, ^ref2, 150}
    end

    test "handles truncate without appending to log", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      Mock.ShapeCache
      |> expect(:handle_truncate, fn @shape_id1, _ -> :ok end)
      |> allow(self(), Shapes.Consumer.name(@shape_id1))

      Mock.Storage
      |> expect(:cleanup!, fn @shape_id1, _ -> :ok end)

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.TruncatedRelation{
          relation: {"public", "test_table"}
        })

      assert_consumer_shutdown(@shape_id1, fn ->
        assert :ok = Support.TransactionProducer.emit(ctx.producer, [txn])
      end)
    end

    defp assert_consumer_shutdown(shape_id, fun) do
      monitors =
        for name <- [
              Shapes.Supervisor.name(shape_id),
              Shapes.Consumer.name(shape_id),
              Shapes.Snapshotter.name(shape_id)
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

      # The fact that we don't expect `append_to_log` is enough to prove that it wasn't called.
      Mock.ShapeCache
      |> expect(:handle_truncate, fn @shape_id1, _ -> :ok end)
      |> allow(self(), Shapes.Consumer.name(@shape_id1))

      Mock.Storage
      |> expect(:cleanup!, fn @shape_id1, _ -> :ok end)

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.TruncatedRelation{
          relation: {"public", "test_table"}
        })

      assert_consumer_shutdown(@shape_id1, fn ->
        assert :ok = Support.TransactionProducer.emit(ctx.producer, [txn])
      end)
    end

    test "notifies listeners of new changes", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      Mock.ShapeCache
      |> expect(:update_shape_latest_offset, fn @shape_id1, ^last_log_offset, _ -> :ok end)
      |> allow(self(), Consumer.name(@shape_id1))

      Mock.Storage
      |> expect(:append_to_log!, fn @shape_id1, _, _, _ -> :ok end)

      ref = make_ref()
      Registry.register(ctx.registry, @shape_id1, ref)

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"}
        })

      assert :ok = Support.TransactionProducer.emit(ctx.producer, [txn])
      assert_receive {^ref, :new_changes, ^last_log_offset}, 1000
    end
  end

  describe "transaction handling with real storage" do
    setup [
      {Support.ComponentSetup, :with_registry},
      {Support.ComponentSetup, :with_in_memory_storage},
      {Support.ComponentSetup, :with_persistent_kv},
      {Support.ComponentSetup, :with_transaction_producer}
    ]

    setup(ctx) do
      {:ok, producer} = Support.TransactionProducer.start_link([])
      snapshot_delay = Map.get(ctx, :snapshot_delay, nil)

      %{shape_cache_opts: shape_cache_opts} =
        Support.ComponentSetup.with_shape_cache(
          Map.merge(ctx, %{
            pool: nil,
            inspector: StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])
          }),
          log_producer: producer,
          prepare_tables_fn: fn _, _ -> :ok end,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            if is_integer(snapshot_delay), do: Process.sleep(snapshot_delay)
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!(shape_id, [["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      [
        producer: producer,
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

      ref = Shapes.Consumer.monitor(shape_id)

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

      assert :ok = Support.TransactionProducer.emit(ctx.producer, [txn])

      assert_receive {Shapes.Consumer, ^ref, 11}

      shape_storage = Storage.for_shape(shape_id, storage)

      assert [op1, op2] =
               Storage.get_log_stream(shape_id, LogOffset.before_all(), shape_storage)
               |> Enum.map(&:json.decode/1)

      # If we encounter & store the same transaction, log stream should be stable
      assert :ok = Support.TransactionProducer.emit(ctx.producer, [txn])

      assert_receive {Shapes.Consumer, ^ref, 11}

      assert [^op1, ^op2] =
               Storage.get_log_stream(shape_id, LogOffset.before_all(), shape_storage)
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

      ref = Shapes.Consumer.monitor(shape_id)

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

      assert :ok = Support.TransactionProducer.emit(ctx.producer, [txn1, txn2])

      :started = ShapeCache.await_snapshot_start(shape_id, shape_cache_opts)

      assert_receive {Shapes.Consumer, ^ref, 10}

      shape_storage = Storage.for_shape(shape_id, storage)

      assert [_op1, _op2] =
               Storage.get_log_stream(shape_id, LogOffset.before_all(), shape_storage)
               |> Enum.map(&:json.decode/1)
    end
  end
end
