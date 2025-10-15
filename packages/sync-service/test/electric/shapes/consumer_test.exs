defmodule Electric.Shapes.ConsumerTest do
  use ExUnit.Case, async: true
  use Support.Mock
  use Repatch.ExUnit

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

  alias Support.StubInspector

  import Support.ComponentSetup

  import Mox

  @receive_timeout 1_000
  @shape_cleanup_timeout 5_000

  @base_inspector StubInspector.new(
                    tables: [
                      "test_table",
                      "other_table",
                      "something else",
                      {"random", "definitely_different"}
                    ],
                    columns: [
                      %{name: "id", type: "int8", pk_position: 0}
                    ]
                  )
  @shape_handle1 "#{__MODULE__}-shape1"
  @shape1 Shape.new!("public.test_table", inspector: @base_inspector)

  @shape_handle2 "#{__MODULE__}-shape2"
  @shape2 Shape.new!("public.other_table", inspector: @base_inspector)

  @shape_handle3 "#{__MODULE__}-shape3"
  @shape3 Shape.new!("public.test_table",
            inspector: @base_inspector,
            where: "id = 1"
          )

  @shape_with_compaction Shape.new!("public.test_table",
                           inspector: @base_inspector,
                           storage: %{compaction: :enabled}
                         )

  @shape_position %{
    @shape_handle1 => %{
      latest_offset: LogOffset.new(Lsn.from_string("0/10"), 0),
      snapshot_xmin: 100
    },
    @shape_handle2 => %{
      latest_offset: LogOffset.new(Lsn.from_string("0/50"), 0),
      snapshot_xmin: 120
    },
    @shape_handle3 => %{
      latest_offset: LogOffset.new(Lsn.from_string("0/1"), 0),
      snapshot_xmin: 10
    }
  }

  setup :with_stack_id_from_test
  setup :set_mox_from_context
  setup :verify_on_exit!

  setup do
    stub_with(Mock.Inspector, StubInspector)

    :ok
  end

  defp shape_status(shape_handle, ctx) do
    get_in(ctx, [:shape_position, shape_handle]) || raise "invalid shape_handle #{shape_handle}"
  end

  defp log_offset(shape_handle, ctx) do
    get_in(ctx, [:shape_position, shape_handle, :latest_offset]) ||
      raise "invalid shape_handle #{shape_handle}"
  end

  defp snapshot_xmin(shape_handle, ctx) do
    get_in(ctx, [:shape_position, shape_handle, :snapshot_xmin]) ||
      raise "invalid shape_handle #{shape_handle}"
  end

  defp lsn(shape_handle, ctx) do
    %{tx_offset: offset} = log_offset(shape_handle, ctx)
    Lsn.from_integer(offset)
  end

  defp stub_shape_status_shutdown(shape_handle, ctx) do
    Mock.ShapeStatus
    |> stub(:get_existing_shape, fn _, _ -> {shape_handle, @shape1} end)
    |> stub(:set_shape_storage_state, fn _, _, _ -> :ok end)
    |> allow(self(), Consumer.whereis(ctx.stack_id, shape_handle))
  end

  describe "event handling" do
    setup [
      :with_in_memory_storage,
      :with_shape_status,
      :with_persistent_kv,
      :with_status_monitor,
      :with_shape_monitor,
      :with_noop_publication_manager,
      :with_consumer_registry
    ]

    setup(ctx) do
      shapes = Map.get(ctx, :shapes, %{@shape_handle1 => @shape1, @shape_handle2 => @shape2})
      shape_position = Map.get(ctx, :shape_position, @shape_position)
      [shape_position: shape_position, shapes: shapes]
    end

    setup(ctx) do
      registry_name = Module.concat(__MODULE__, Registry)
      start_link_supervised!({Registry, keys: :duplicate, name: registry_name})

      %{latest_offset: _offset1, snapshot_xmin: xmin1} = shape_status(@shape_handle1, ctx)
      %{latest_offset: _offset2, snapshot_xmin: xmin2} = shape_status(@shape_handle2, ctx)

      storage =
        Support.TestStorage.wrap(ctx.storage, %{
          @shape_handle1 => [
            {:mark_snapshot_as_started, []},
            {:set_pg_snapshot, [%{xmin: xmin1, xmax: xmin1 + 1, xip_list: [xmin1]}]}
          ],
          @shape_handle2 => [
            {:mark_snapshot_as_started, []},
            {:set_pg_snapshot, [%{xmin: xmin2, xmax: xmin2 + 1, xip_list: [xmin2]}]}
          ]
        })

      producer =
        start_link_supervised!({
          ShapeLogCollector,
          stack_id: ctx.stack_id, persistent_kv: ctx.persistent_kv, inspector: @base_inspector
        })

      ShapeLogCollector.set_last_processed_lsn(producer, Lsn.from_integer(0))

      consumers =
        for {shape_handle, shape} <- ctx.shapes do
          Mock.ShapeStatus
          |> stub(:consume_shape_storage_state, fn _, ^shape_handle -> nil end)
          |> expect(:initialise_shape, 1, fn _, ^shape_handle, _, _ -> :ok end)
          |> expect(:set_snapshot_xmin, 1, fn _, ^shape_handle, _ -> :ok end)
          |> expect(:mark_snapshot_started, 1, fn _, ^shape_handle -> :ok end)
          |> allow(self(), fn -> Consumer.whereis(ctx.stack_id, shape_handle) end)

          {:ok, consumer} =
            start_supervised(
              {Shapes.ConsumerSupervisor,
               shape_handle: shape_handle,
               shape: shape,
               stack_id: ctx.stack_id,
               inspector: {Mock.Inspector, []},
               db_pool: Electric.Connection.Manager.snapshot_pool(ctx.stack_id),
               registry: registry_name,
               shape_status_mod: Mock.ShapeStatus,
               publication_manager: ctx.publication_manager,
               hibernate_after: 1_000,
               storage: storage,
               otel_ctx: nil,
               chunk_bytes_threshold:
                 Electric.ShapeCache.LogChunker.default_chunk_size_threshold()},
              id: {Shapes.ConsumerSupervisor, shape_handle}
            )

          assert_receive {Support.TestStorage, :init_writer!, ^shape_handle, ^shape, _}
          # Wait for the virtual snapshot to have started to avoid overriding any of the
          # defined Mox expectations
          :started =
            GenServer.call(Consumer.name(ctx.stack_id, shape_handle), :await_snapshot_start)

          stub_shape_status_shutdown(shape_handle, ctx)

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
      xmin = snapshot_xmin(@shape_handle1, ctx)
      last_log_offset = log_offset(@shape_handle1, ctx)
      lsn = lsn(@shape_handle1, ctx)
      next_lsn = Lsn.increment(lsn, 1)
      next_log_offset = LogOffset.new(next_lsn, 0)

      Mock.ShapeStatus
      |> expect(:set_latest_offset, fn _, @shape_handle1, ^last_log_offset -> :ok end)
      |> expect(:set_latest_offset, fn _, @shape_handle1, ^next_log_offset -> :ok end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle1))

      ref = make_ref()

      Registry.register(ctx.registry, @shape_handle1, ref)

      txn =
        %Transaction{
          xid: xmin,
          lsn: lsn,
          last_log_offset: last_log_offset,
          commit_timestamp: DateTime.utc_now()
        }
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: last_log_offset
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)
      assert_receive {^ref, :new_changes, ^last_log_offset}, @receive_timeout
      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle1, _}
      refute_receive {Support.TestStorage, :append_to_log!, @shape_handle2, _}

      txn2 =
        %Transaction{
          xid: xid,
          lsn: next_lsn,
          last_log_offset: next_log_offset,
          commit_timestamp: DateTime.utc_now()
        }
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: next_log_offset
        })

      assert :ok = ShapeLogCollector.store_transaction(txn2, ctx.producer)
      assert_receive {^ref, :new_changes, ^next_log_offset}, @receive_timeout
      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle1, _}
      refute_receive {Support.TestStorage, :append_to_log!, @shape_handle2, _}
    end

    test "correctly writes only relevant changes to multiple shape logs", ctx do
      expected_log_offset = log_offset(@shape_handle1, ctx)
      lsn = lsn(@shape_handle1, ctx)

      change1_offset = expected_log_offset
      change2_offset = LogOffset.increment(expected_log_offset, 1)
      change3_offset = LogOffset.increment(expected_log_offset, 2)

      xid = 150

      Mock.ShapeStatus
      |> expect(:set_latest_offset, 2, fn
        _, @shape_handle1, ^change1_offset -> :ok
        _, @shape_handle2, ^change2_offset -> :ok
      end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle1))
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle2))

      ref1 = make_ref()
      ref2 = make_ref()

      Registry.register(ctx.registry, @shape_handle1, ref1)
      Registry.register(ctx.registry, @shape_handle2, ref2)

      txn =
        %Transaction{
          xid: xid,
          lsn: lsn,
          last_log_offset: expected_log_offset,
          commit_timestamp: DateTime.utc_now()
        }
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: change1_offset
        })
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "other_table"},
          record: %{"id" => "2"},
          log_offset: change2_offset
        })
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "something else"},
          record: %{"id" => "3"},
          log_offset: change3_offset
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)

      assert_receive {^ref1, :new_changes, ^change1_offset}, @receive_timeout
      assert_receive {^ref2, :new_changes, ^change2_offset}, @receive_timeout

      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle1,
                      [{_offset, _key, _type, serialized_record}]}

      assert %{"value" => %{"id" => "1"}} = Jason.decode!(serialized_record)

      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle2,
                      [{_offset, _key, _type, serialized_record}]}

      assert %{"value" => %{"id" => "2"}} = Jason.decode!(serialized_record)
    end

    @tag shapes: %{
           @shape_handle1 =>
             Shape.new!("public.test_table", where: "id != 1", inspector: @base_inspector),
           @shape_handle2 =>
             Shape.new!("public.test_table", where: "id = 1", inspector: @base_inspector)
         }
    test "doesn't append to log when change is irrelevant for active shapes", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      ref1 = Shapes.Consumer.monitor(ctx.stack_id, @shape_handle1)
      ref2 = Shapes.Consumer.monitor(ctx.stack_id, @shape_handle2)

      Mock.ShapeStatus
      |> expect(:set_latest_offset, fn _, @shape_handle2, _offset -> :ok end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle2))

      txn =
        %Transaction{
          xid: xid,
          lsn: lsn,
          last_log_offset: last_log_offset,
          commit_timestamp: DateTime.utc_now()
        }
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: LogOffset.first()
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)

      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle2, _}
      refute_receive {Support.TestStorage, :append_to_log!, @shape_handle1, _}

      refute_receive {Shapes.Consumer, ^ref1, 150}
      assert_receive {Shapes.Consumer, ^ref2, 150}
    end

    test "handles truncate without appending to log", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      Mock.ShapeStatus
      |> expect(:remove_shape, 1, fn _, @shape_handle1 -> :ok end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle1))

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.TruncatedRelation{
          relation: {"public", "test_table"}
        })

      assert_consumer_shutdown(ctx.stack_id, @shape_handle1, fn ->
        assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)
      end)

      assert_receive {Electric.Shapes.Monitor, :cleanup, @shape_handle1}, @shape_cleanup_timeout
      refute_receive {Electric.Shapes.Monitor, :cleanup, @shape_handle2}
    end

    defp assert_consumer_shutdown(stack_id, shape_handle, fun) do
      monitors =
        for name <- [
              Shapes.ConsumerSupervisor.name(stack_id, shape_handle),
              Shapes.Consumer.name(stack_id, shape_handle),
              Shapes.Consumer.Snapshotter.name(stack_id, shape_handle)
            ],
            pid = GenServer.whereis(name) do
          ref = Process.monitor(pid)
          {ref, pid}
        end

      fun.()

      for {ref, pid} <- monitors do
        assert_receive {:DOWN, ^ref, :process, ^pid, reason}
                       when reason in [:shutdown, {:shutdown, :cleanup}]
      end
    end

    @tag shapes: %{
           @shape_handle1 =>
             Shape.new!("test_table",
               where: "id LIKE 'test'",
               inspector:
                 StubInspector.new(%{
                   {"public", "test_table"} => %{
                     columns: [%{name: "id", type: "text", pk_position: 0}]
                   }
                 })
             )
         }
    test "handles truncate when shape has a where clause", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      Mock.ShapeStatus
      |> expect(:remove_shape, fn _, @shape_handle1 -> :ok end)
      |> stub(:get_existing_shape, fn _, @shape_handle1 -> {@shape_handle1, @shape1} end)
      |> stub(:set_shape_storage_state, fn _, @shape_handle1, _ -> :ok end)
      |> allow(
        self(),
        Shapes.Consumer.whereis(ctx.stack_id, @shape_handle1)
      )

      txn =
        %Transaction{
          xid: xid,
          lsn: lsn,
          last_log_offset: last_log_offset,
          commit_timestamp: DateTime.utc_now()
        }
        |> Transaction.prepend_change(%Changes.TruncatedRelation{
          relation: {"public", "test_table"}
        })

      assert_consumer_shutdown(ctx.stack_id, @shape_handle1, fn ->
        assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)
      end)

      refute_receive {Support.TestStorage, :append_to_log!, @shape_handle1, _}
      assert_receive {Electric.Shapes.Monitor, :cleanup, @shape_handle1}, @shape_cleanup_timeout
      refute_receive {Electric.Shapes.Monitor, :cleanup, @shape_handle2}
    end

    test "notifies listeners of new changes", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      Mock.ShapeStatus
      |> expect(:set_latest_offset, fn _, @shape_handle1, ^last_log_offset -> :ok end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle1))

      ref = make_ref()
      Registry.register(ctx.registry, @shape_handle1, ref)

      txn =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: last_log_offset
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)
      assert_receive {^ref, :new_changes, ^last_log_offset}, @receive_timeout
      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle1, _}
    end

    test "does not clean shapes if relation didn't change", ctx do
      rel =
        %Relation{
          id: :erlang.phash2({"random", "definitely_different"}),
          schema: "random",
          table: "definitely_different",
          columns: []
        }

      ref1 =
        Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))

      ref2 =
        Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle2))

      Mock.ShapeStatus
      |> expect(:remove_shape, 0, fn _, _ -> :ok end)
      |> expect(:set_shape_storage_state, 0, fn _, _, _ -> :ok end)
      |> stub(:get_existing_shape, fn _, _ -> {@shape_handle1, @shape1} end)
      |> stub(:set_shape_storage_state, fn _, _, _ -> :ok end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle1))
      |> expect(:remove_shape, 0, fn _, _ -> :ok end)
      |> stub(:get_existing_shape, fn _, _ -> {@shape_handle2, @shape2} end)
      |> stub(:set_shape_storage_state, fn _, _, _ -> :ok end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle2))

      assert :ok = ShapeLogCollector.handle_relation_msg(rel, ctx.producer)

      refute_receive {:DOWN, ^ref1, :process, _, _}
      refute_receive {:DOWN, ^ref2, :process, _, _}
    end

    test "cleans shapes affected by a relation rename", ctx do
      {orig_schema, _} = @shape1.root_table
      cleaned_oid = @shape1.root_table_id

      rel = %Relation{
        id: cleaned_oid,
        schema: orig_schema,
        table: "definitely_different",
        columns: []
      }

      ref1 =
        Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))

      ref2 =
        Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle2))

      # also cleans up inspector cache and shape status cache
      Mock.Inspector
      |> expect(:clean, 1, fn ^cleaned_oid, _ -> true end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle1))
      |> expect(:clean, 0, fn _, _ -> true end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle2))

      Mock.ShapeStatus
      |> expect(:remove_shape, 1, fn _, @shape_handle1 -> :ok end)
      |> stub(:get_existing_shape, fn _, @shape_handle1 -> {@shape_handle1, @shape1} end)
      |> expect(:set_shape_storage_state, 1, fn _, @shape_handle1, _ -> :ok end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle1))
      |> expect(:remove_shape, 0, fn _, _ -> :ok end)
      |> stub(:get_existing_shape, fn _, _ -> {@shape_handle2, @shape2} end)
      |> stub(:set_shape_storage_state, fn _, _, _ -> :ok end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle2))

      assert :ok = ShapeLogCollector.handle_relation_msg(rel, ctx.producer)

      assert_receive {:DOWN, ^ref1, :process, _, {:shutdown, :cleanup}}
      refute_receive {:DOWN, ^ref2, :process, _, _}
      assert_receive {Electric.Shapes.Monitor, :cleanup, @shape_handle1}, @shape_cleanup_timeout
    end

    test "cleans shapes affected by a relation change", ctx do
      ref1 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))
      ref2 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle2))

      {orig_schema, orig_table} = @shape1.root_table

      rel_before = %Relation{
        id: @shape1.root_table_id,
        schema: orig_schema,
        table: orig_table,
        columns: [%{name: "id", type_oid: {1, 1}}]
      }

      assert :ok = ShapeLogCollector.handle_relation_msg(rel_before, ctx.producer)

      refute_receive {:DOWN, _, :process, _, _}

      rel_changed = %{rel_before | columns: [%{name: "id", type_oid: {999, 1}}]}

      # also cleans up inspector cache and shape status cache
      Mock.Inspector
      |> expect(:clean, 1, fn _, _ -> true end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle1))
      |> expect(:clean, 0, fn _, _ -> true end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle2))

      Mock.ShapeStatus
      |> expect(:remove_shape, 1, fn _, _ -> :ok end)
      |> stub(:get_existing_shape, fn _, @shape_handle1 -> {@shape_handle1, @shape1} end)
      |> expect(:set_shape_storage_state, 1, fn _, @shape_handle1, _ -> :ok end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle1))
      |> expect(:remove_shape, 0, fn _, _ -> :ok end)
      |> stub(:get_existing_shape, fn _, _ -> {@shape_handle2, @shape2} end)
      |> stub(:set_shape_storage_state, fn _, _, _ -> :ok end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle2))

      assert :ok = ShapeLogCollector.handle_relation_msg(rel_changed, ctx.producer)

      assert_receive {:DOWN, ^ref1, :process, _, {:shutdown, :cleanup}}
      refute_receive {:DOWN, ^ref2, :process, _, _}
      assert_receive {Electric.Shapes.Monitor, :cleanup, @shape_handle1}, @shape_cleanup_timeout
      refute_receive {Electric.Shapes.Monitor, :cleanup, @shape_handle2}
    end

    test "notifies live listeners when invalidated", ctx do
      ref1 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))

      {orig_schema, orig_table} = @shape1.root_table

      rel_before = %Relation{
        id: @shape1.root_table_id,
        schema: orig_schema,
        table: orig_table,
        columns: [%{name: "id", type_oid: {1, 1}}]
      }

      assert :ok = ShapeLogCollector.handle_relation_msg(rel_before, ctx.producer)

      refute_receive {:DOWN, _, :process, _, _}

      live_ref = make_ref()
      Registry.register(ctx.registry, @shape_handle1, live_ref)

      rel_changed = %{rel_before | columns: [%{name: "id", type_oid: {999, 1}}]}

      Mock.Inspector
      |> expect(:clean, 1, fn _, _ -> true end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle1))

      Mock.ShapeStatus
      |> expect(:remove_shape, 1, fn _, _ -> :ok end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle1))

      assert :ok = ShapeLogCollector.handle_relation_msg(rel_changed, ctx.producer)

      assert_receive {:DOWN, ^ref1, :process, _, {:shutdown, :cleanup}}
      assert_receive {^live_ref, :shape_rotation}
      refute_receive {Electric.Shapes.Monitor, :cleanup, @shape_handle2}
    end

    test "unexpected error while handling events stops affected consumer and cleans affected shape",
         ctx do
      Mock.ShapeStatus
      |> expect(:set_latest_offset, fn _, @shape_handle1, _ ->
        raise "The unexpected error"
      end)
      |> allow(self(), Consumer.whereis(ctx.stack_id, @shape_handle1))

      lsn = Lsn.from_string("0/10")

      txn =
        %Transaction{
          xid: 150,
          lsn: lsn,
          last_log_offset: LogOffset.new(lsn, 0),
          commit_timestamp: DateTime.utc_now()
        }
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: LogOffset.first()
        })

      ref1 =
        Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))

      ref2 =
        Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle2))

      :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)

      assert_receive {:DOWN, ^ref1, :process, _, _}
      refute_receive {:DOWN, ^ref2, :process, _, _}

      assert_receive {Electric.Shapes.Monitor, :cleanup, @shape_handle1}, @shape_cleanup_timeout
      refute_receive {Electric.Shapes.Monitor, :cleanup, @shape_handle2}
    end

    test "consumer crashing stops affected consumer", ctx do
      ref1 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))

      ref2 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle2))

      GenServer.cast(Consumer.whereis(ctx.stack_id, @shape_handle1), :unexpected_cast)

      assert_receive {Electric.Shapes.Monitor, :cleanup, @shape_handle1}, @shape_cleanup_timeout
      refute_receive {Electric.Shapes.Monitor, :cleanup, @shape_handle2}

      assert_receive {:DOWN, ^ref1, :process, _, _}
      refute_receive {:DOWN, ^ref2, :process, _, _}
    end
  end

  describe "transaction handling with real storage" do
    @describetag :tmp_dir
    setup do
      %{inspector: @base_inspector, pool: nil}
    end

    setup [
      :with_registry,
      :with_pure_file_storage,
      :with_shape_status,
      :with_log_chunking,
      :with_persistent_kv,
      :with_async_deleter,
      :with_shape_cleaner,
      :with_shape_log_collector,
      :with_noop_publication_manager,
      :with_status_monitor,
      :with_shape_monitor
    ]

    setup(ctx) do
      snapshot_delay = Map.get(ctx, :snapshot_delay, nil)

      Support.TestUtils.patch_snapshotter(fn parent, shape_handle, _shape, %{storage: storage} ->
        if is_integer(snapshot_delay), do: Process.sleep(snapshot_delay)
        pg_snapshot = ctx[:pg_snapshot] || {10, 11, [10]}
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, pg_snapshot})
        GenServer.cast(parent, {:snapshot_started, shape_handle})
        Storage.make_new_snapshot!([], storage)
      end)

      %{shape_cache_opts: shape_cache_opts, consumer_supervisor: consumer_supervisor} =
        Support.ComponentSetup.with_shape_cache(ctx,
          shape_hibernate_after: Map.get(ctx, :hibernate_after, 10_000)
        )

      [
        producer: ctx.shape_log_collector,
        shape_cache_opts: shape_cache_opts,
        consumer_supervisor: consumer_supervisor
      ]
    end

    test "duplicate transactions storage is idempotent", ctx do
      %{
        storage: storage,
        shape_cache_opts: shape_cache_opts
      } = ctx

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, shape_cache_opts)

      :started =
        ShapeCache.await_snapshot_start(
          shape_handle,
          shape_cache_opts
        )

      lsn = Lsn.from_integer(10)

      ref = Shapes.Consumer.monitor(ctx.stack_id, shape_handle)

      txn =
        %Transaction{
          xid: 11,
          lsn: lsn,
          last_log_offset: LogOffset.new(lsn, 2),
          commit_timestamp: DateTime.utc_now()
        }
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

      shape_storage = Storage.for_shape(shape_handle, storage)

      assert [op1, op2] =
               Storage.get_log_stream(LogOffset.last_before_real_offsets(), shape_storage)
               |> Enum.map(&Jason.decode!/1)

      # If we encounter & store the same transaction, log stream should be stable
      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)

      # We should not re-process the same transaction
      refute_receive {Shapes.Consumer, ^ref, 11}

      assert [^op1, ^op2] =
               Storage.get_log_stream(LogOffset.last_before_real_offsets(), shape_storage)
               |> Enum.map(&Jason.decode!/1)

      stop_supervised!(ctx.consumer_supervisor)
    end

    @tag snapshot_delay: 100
    test "transactions are buffered until snapshot xmin is known", ctx do
      %{
        storage: storage,
        shape_cache_opts: shape_cache_opts
      } = ctx

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, shape_cache_opts)

      lsn1 = Lsn.from_integer(9)
      lsn2 = Lsn.from_integer(10)

      ref = Shapes.Consumer.monitor(ctx.stack_id, shape_handle)

      txn1 =
        %Transaction{
          xid: 9,
          lsn: lsn1,
          last_log_offset: LogOffset.new(lsn1, 2),
          commit_timestamp: DateTime.utc_now()
        }
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
        %Transaction{
          xid: 10,
          lsn: lsn2,
          last_log_offset: LogOffset.new(lsn2, 2),
          commit_timestamp: DateTime.utc_now()
        }
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

      :started = ShapeCache.await_snapshot_start(shape_handle, shape_cache_opts)

      assert_receive {Shapes.Consumer, ^ref, 10}

      shape_storage = Storage.for_shape(shape_handle, storage)

      assert [_op1, _op2] =
               Storage.get_log_stream(LogOffset.last_before_real_offsets(), shape_storage)
               |> Enum.map(&Jason.decode!/1)

      stop_supervised!(ctx.consumer_supervisor)
    end

    test "restarting a consumer doesn't lower the last known offset when only snapshot is present",
         ctx do
      %{
        shape_cache_opts: shape_cache_opts
      } = ctx

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, shape_cache_opts)

      :started =
        ShapeCache.await_snapshot_start(
          shape_handle,
          shape_cache_opts
        )

      assert {_, offset1} = ShapeCache.get_shape(shape_handle, shape_cache_opts)
      assert offset1 == LogOffset.last_before_real_offsets()

      ref = ctx.consumer_supervisor |> GenServer.whereis() |> Process.monitor()
      # Stop the consumer and the shape cache server to simulate a restart
      stop_supervised!(ctx.consumer_supervisor)
      assert_receive {:DOWN, ^ref, :process, _pid, _reason}, 1000

      ref = shape_cache_opts[:server] |> GenServer.whereis() |> Process.monitor()
      stop_supervised!(shape_cache_opts[:server])
      assert_receive {:DOWN, ^ref, :process, _pid, _reason}, 1000

      stop_supervised!("shape_task_supervisor")

      # Restart the shape cache and the consumers
      Support.ComponentSetup.with_shape_cache(ctx)

      :started = ShapeCache.await_snapshot_start(shape_handle, shape_cache_opts)
      assert {_, offset2} = ShapeCache.get_shape(shape_handle, shape_cache_opts)

      assert LogOffset.compare(offset2, offset1) != :lt
    end

    @tag with_pure_file_storage_opts: [flush_period: 50]
    test "should correctly normalize a flush boundary to txn", ctx do
      {:via, Registry, {name, key}} = Electric.Postgres.ReplicationClient.name(ctx.stack_id)
      Registry.register(name, key, nil)

      %{
        shape_cache_opts: shape_cache_opts
      } = ctx

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape3, shape_cache_opts)

      :started =
        ShapeCache.await_snapshot_start(
          shape_handle,
          shape_cache_opts
        )

      lsn = Lsn.from_integer(10)

      txn =
        %Transaction{
          xid: 10,
          lsn: lsn,
          commit_timestamp: DateTime.utc_now()
        }
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "21"},
          log_offset: LogOffset.new(lsn, 0)
        })
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"},
          log_offset: LogOffset.new(lsn, 2)
        })
        |> Transaction.finalize()

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)

      assert_receive {:flush_boundary_updated, 10}, 1_000
    end

    @tag pg_snapshot: {10, 15, [12]}
    test "should notify txns skipped because of xmin/xip as flushed", ctx do
      {:via, Registry, {name, key}} = Electric.Postgres.ReplicationClient.name(ctx.stack_id)
      Registry.register(name, key, nil)

      %{shape_cache_opts: shape_cache_opts} = ctx

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, shape_cache_opts)
      lsn1 = Lsn.from_integer(300)
      lsn2 = Lsn.from_integer(301)

      :started = ShapeCache.await_snapshot_start(shape_handle, shape_cache_opts)

      txn =
        %Transaction{
          xid: 2,
          lsn: lsn1,
          commit_timestamp: DateTime.utc_now()
        }
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "21"},
          log_offset: LogOffset.new(lsn1, 0)
        })
        |> Transaction.finalize()

      txn2 =
        %Transaction{
          xid: 11,
          lsn: lsn2,
          commit_timestamp: DateTime.utc_now()
        }
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "21"},
          log_offset: LogOffset.new(lsn2, 0)
        })
        |> Transaction.finalize()

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)
      assert :ok = ShapeLogCollector.store_transaction(txn2, ctx.producer)

      assert_receive {:flush_boundary_updated, 300}, 1_000
      assert_receive {:flush_boundary_updated, 301}, 1_000
    end

    @tag hibernate_after: 1, with_pure_file_storage_opts: [flush_period: 1]
    test "should hibernate after :hibernate_after ms", ctx do
      {:via, Registry, {name, key}} = Electric.Postgres.ReplicationClient.name(ctx.stack_id)
      Registry.register(name, key, nil)

      %{shape_cache_opts: shape_cache_opts} = ctx

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, shape_cache_opts)
      lsn1 = Lsn.from_integer(300)

      :started = ShapeCache.await_snapshot_start(shape_handle, shape_cache_opts)

      txn =
        %Transaction{
          xid: 2,
          lsn: lsn1,
          commit_timestamp: DateTime.utc_now()
        }
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "21"},
          log_offset: LogOffset.new(lsn1, 0)
        })
        |> Transaction.finalize()

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.producer)

      assert_receive {:flush_boundary_updated, 300}, 1_000

      Process.sleep(20)

      consumer_pid = Consumer.name(ctx.stack_id, shape_handle) |> GenServer.whereis()

      assert {:current_function, {:gen_server, :loop_hibernate, 4}} =
               Process.info(consumer_pid, :current_function)

      Process.sleep(20)

      assert {:current_function, {:gen_server, :loop_hibernate, 4}} =
               Process.info(consumer_pid, :current_function)
    end

    @tag with_pure_file_storage_opts: [compaction_period: 5, keep_complete_chunks: 133]
    test "compaction is scheduled and invoked for a shape that has compaction enabled", ctx do
      parent = self()
      ref = make_ref()

      fun = fn _shape_opts, 133 ->
        send(parent, {:consumer_did_invoke_compact, ref})
        :ok
      end

      Repatch.patch(Electric.ShapeCache.PureFileStorage, :compact, [mode: :shared], fun)
      Support.TestUtils.activate_mocks_for_descendant_procs(Consumer)

      {_shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_compaction, ctx.shape_cache_opts)

      assert_receive {:consumer_did_invoke_compact, ^ref}
    end
  end
end
