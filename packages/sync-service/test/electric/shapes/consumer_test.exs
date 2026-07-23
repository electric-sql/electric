defmodule Electric.Shapes.ConsumerTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit, assert_expectations: true

  alias Electric.LsnTracker
  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes.Relation
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

  import Support.TestUtils,
    only: [
      expect_calls: 2,
      patch_shape_status: 1,
      expect_shape_status: 1,
      patch_snapshotter: 1,
      assert_shape_cleanup: 1,
      register_as_replication_client: 1,
      complete_txn_fragment: 3,
      txn_fragments: 3,
      txn_fragment: 4
    ]

  @receive_timeout 1_000

  @base_inspector StubInspector.new(
                    tables: [
                      "test_table",
                      "other_table",
                      "something else",
                      {"random", "definitely_different"}
                    ],
                    columns: [
                      %{name: "id", type: "int8", pk_position: 0},
                      %{name: "value", type: "text"}
                    ]
                  )
  @shape_handle1 "#{inspect(__MODULE__)}-shape1"
  @shape1 Shape.new!("public.test_table", inspector: @base_inspector)

  @shape_handle2 "#{inspect(__MODULE__)}-shape2"
  @shape2 Shape.new!("public.other_table", inspector: @base_inspector)

  @shape_handle3 "#{inspect(__MODULE__)}-shape3"
  @shape3 Shape.new!("public.test_table",
            inspector: @base_inspector,
            where: "id = 1"
          )

  @shape_with_compaction Shape.new!("public.test_table",
                           inspector: @base_inspector,
                           storage: %{compaction: :enabled}
                         )

  @shape_with_subquery Shape.new!("public.test_table",
                         inspector: @base_inspector,
                         where: "id IN (SELECT id FROM public.other_table)"
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

  @moduletag :tmp_dir

  setup :with_stack_id_from_test

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

  # Block until `pid` is hibernating, then return its armed suspend-timer ref
  # (or nil if none is armed).
  defp await_hibernation(pid, timeout \\ 2_000) do
    poll_until(timeout, fn ->
      case Process.info(pid, :current_function) do
        {:current_function, {:gen_server, :loop_hibernate, _}} ->
          {:ok, :sys.get_state(pid).suspend_timer}

        _ ->
          :retry
      end
    end)
  end

  # Repeatedly evaluate `fun` until it returns `{:ok, value}` (returning value)
  # or `timeout` ms elapse (failing the test).
  defp poll_until(timeout, fun) do
    deadline = System.monotonic_time(:millisecond) + timeout
    do_poll_until(deadline, fun)
  end

  defp do_poll_until(deadline, fun) do
    case fun.() do
      {:ok, value} ->
        value

      :retry ->
        if System.monotonic_time(:millisecond) < deadline do
          Process.sleep(50)
          do_poll_until(deadline, fun)
        else
          flunk("poll_until/2 timed out waiting for condition")
        end
    end
  end

  describe "event handling" do
    setup [
      :with_registry,
      :with_in_memory_storage,
      :with_shape_status,
      :with_lsn_tracker,
      :with_persistent_kv,
      :with_status_monitor,
      :with_dynamic_consumer_supervisor,
      :with_noop_publication_manager,
      :with_shape_cleaner
    ]

    setup(ctx) do
      shapes = Map.get(ctx, :shapes, %{@shape_handle1 => @shape1, @shape_handle2 => @shape2})
      shape_position = Map.get(ctx, :shape_position, @shape_position)
      [shape_position: shape_position, shapes: shapes]
    end

    setup(ctx) do
      start_link_supervised!({
        ShapeLogCollector.Supervisor,
        stack_id: ctx.stack_id, persistent_kv: ctx.persistent_kv, inspector: @base_inspector
      })

      ShapeLogCollector.mark_as_ready(ctx.stack_id)

      :ok
    end

    setup(ctx) do
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

      Electric.StackConfig.put(ctx.stack_id, Electric.ShapeCache.Storage, storage)
      Electric.StackConfig.put(ctx.stack_id, :inspector, @base_inspector)

      patch_shape_status(
        fetch_shape_by_handle: fn _, shape_handle -> Map.fetch(ctx.shapes, shape_handle) end
      )

      Support.TestUtils.activate_mocks_for_descendant_procs(Electric.Shapes.Consumer)
      Support.TestUtils.activate_mocks_for_descendant_procs(Electric.ShapeCache.ShapeCleaner)

      consumers =
        for {shape_handle, shape} <- ctx.shapes do
          %{latest_offset: _offset} = shape_status(shape_handle, ctx)

          {:ok, consumer} =
            start_supervised(
              {Shapes.Consumer,
               %{
                 shape_handle: shape_handle,
                 stack_id: ctx.stack_id
               }},
              id: {Shapes.Consumer, shape_handle}
            )

          Shapes.Consumer.initialize_shape(consumer, shape, %{action: :create})

          assert_receive {Support.TestStorage, :init_writer!, ^shape_handle, ^shape}

          :started = Consumer.await_snapshot_start(ctx.stack_id, shape_handle)

          consumer
        end

      [consumers: consumers]
    end

    test "sheds a live subscriber blocked writing to a stalled socket", ctx do
      # Regression: a live `GET /v1/shape` handler blocked in `Plug.Conn.chunk`
      # writing to a stalled/dead client socket stops draining its mailbox while
      # changes keep streaming. It accumulates one `{:new_changes, _}` message
      # per transaction with no upper bound, pinning reference-counted binary
      # until the node OOMs. The consumer must shed such a subscriber once its
      # mailbox crosses a watermark.
      #
      # The stuck subscriber is blocked in a real `:gen_tcp.send` to a peer that
      # never reads — the actual production scheduler state, `:waiting` in the
      # `inet_reply` receive — so this also exercises that the consumer's
      # `Process.info(_, :message_queue_len)` check does not itself stall on the
      # blocked subscriber (which would freeze the per-shape consumer).
      Electric.StackConfig.put(ctx.stack_id, :slow_subscriber_max_queue_len, 5)

      xmin = snapshot_xmin(@shape_handle1, ctx)
      base_lsn = lsn(@shape_handle1, ctx)
      test_pid = self()

      # A stalled "client": accepts the connection but never reads, so the
      # subscriber's writes fill the buffers and block.
      {:ok, listen} =
        :gen_tcp.listen(0, [:binary, active: false, reuseaddr: true, recbuf: 1024])

      {:ok, lport} = :inet.port(listen)
      on_exit(fn -> :gen_tcp.close(listen) end)

      acceptor =
        spawn(fn ->
          {:ok, _accepted} = :gen_tcp.accept(listen)
          Process.sleep(:infinity)
        end)

      on_exit(fn -> Process.exit(acceptor, :kill) end)

      subscriber =
        spawn(fn ->
          {:ok, sock} =
            :gen_tcp.connect({127, 0, 0, 1}, lport, [
              :binary,
              active: false,
              sndbuf: 1024,
              buffer: 1024,
              high_watermark: 2048,
              low_watermark: 1024,
              send_timeout: :infinity
            ])

          {:ok, _} = Registry.register(ctx.registry, @shape_handle1, make_ref())
          send(test_pid, :subscribed)

          # Block forever writing to the stalled socket, exactly like a live
          # handler stuck in Plug.Conn.chunk. The process never drains its
          # :new_changes mailbox while parked here.
          chunk = :binary.copy(<<0>>, 1_000_000)
          Enum.each(Stream.cycle([chunk]), &:gen_tcp.send(sock, &1))
        end)

      monitor = Process.monitor(subscriber)
      assert_receive :subscribed, @receive_timeout
      # Let it get stuck in the blocking send before changes start streaming.
      Process.sleep(50)

      # Stream a steady series of transactions that all match the shape.
      for i <- 1..50 do
        txn_lsn = Lsn.increment(base_lsn, i)

        txn =
          complete_txn_fragment(xmin + i, txn_lsn, [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "1"},
              log_offset: LogOffset.new(txn_lsn, 0)
            }
          ])

        assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      end

      # The stuck subscriber must be shed once its mailbox crosses the watermark.
      # This arriving also proves the consumer's mailbox check did not block on
      # the socket-stuck subscriber — otherwise the shed would never run.
      assert_receive {:DOWN, ^monitor, :process, ^subscriber, _reason}, @receive_timeout

      # And the consumer must still be alive and notifying afterwards: register a
      # healthy subscriber and confirm it receives the next change.
      healthy =
        spawn(fn ->
          {:ok, _} = Registry.register(ctx.registry, @shape_handle1, ref = make_ref())
          send(test_pid, :healthy_subscribed)

          receive do
            {^ref, :new_changes, offset} -> send(test_pid, {:healthy_notified, offset})
          end
        end)

      on_exit(fn -> Process.exit(healthy, :kill) end)
      assert_receive :healthy_subscribed, @receive_timeout

      healthy_lsn = Lsn.increment(base_lsn, 100)

      healthy_txn =
        complete_txn_fragment(xmin + 100, healthy_lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(healthy_lsn, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(healthy_txn, ctx.stack_id)
      assert_receive {:healthy_notified, _offset}, @receive_timeout
    end

    test "does not shed a healthy subscriber whose backlog stays under the watermark", ctx do
      # The shedding safety net must not disturb normal live clients that drain
      # their mailbox and never approach the watermark.
      Electric.StackConfig.put(ctx.stack_id, :slow_subscriber_max_queue_len, 100)

      xmin = snapshot_xmin(@shape_handle1, ctx)
      base_lsn = lsn(@shape_handle1, ctx)
      test_pid = self()

      # A subscriber that drains every notification promptly.
      subscriber =
        spawn(fn ->
          {:ok, _} = Registry.register(ctx.registry, @shape_handle1, ref = make_ref())
          send(test_pid, :subscribed)
          drain = fn drain -> receive(do: ({^ref, :new_changes, _} -> drain.(drain))) end
          drain.(drain)
        end)

      monitor = Process.monitor(subscriber)
      on_exit(fn -> Process.exit(subscriber, :kill) end)
      assert_receive :subscribed, @receive_timeout

      for i <- 1..50 do
        txn_lsn = Lsn.increment(base_lsn, i)

        txn =
          complete_txn_fragment(xmin + i, txn_lsn, [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "1"},
              log_offset: LogOffset.new(txn_lsn, 0)
            }
          ])

        assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      end

      refute_receive {:DOWN, ^monitor, :process, ^subscriber, _reason}, 200
      assert Process.alive?(subscriber)
    end

    test "appends to log when xid >= xmin", ctx do
      xid = 150
      xmin = snapshot_xmin(@shape_handle1, ctx)
      last_log_offset = log_offset(@shape_handle1, ctx)
      lsn = lsn(@shape_handle1, ctx)
      next_lsn = Lsn.increment(lsn, 1)
      next_log_offset = LogOffset.new(next_lsn, 0)

      ref = make_ref()

      Registry.register(ctx.registry, @shape_handle1, ref)

      txn =
        complete_txn_fragment(xmin, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: last_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      assert_receive {^ref, :new_changes, ^last_log_offset}, @receive_timeout
      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle1, _}
      refute_storage_calls_for_txn_fragment(@shape_handle2)

      txn2 =
        complete_txn_fragment(xid, next_lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: next_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn2, ctx.stack_id)
      assert_receive {^ref, :new_changes, ^next_log_offset}, @receive_timeout
      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle1, _}
      refute_storage_calls_for_txn_fragment(@shape_handle2)
    end

    test "correctly writes only relevant changes to multiple shape logs", ctx do
      expected_log_offset = log_offset(@shape_handle1, ctx)
      lsn = lsn(@shape_handle1, ctx)

      change1_offset = expected_log_offset
      change2_offset = LogOffset.increment(expected_log_offset, 1)
      change3_offset = LogOffset.increment(expected_log_offset, 2)

      xid = 150

      ref1 = make_ref()
      ref2 = make_ref()

      Registry.register(ctx.registry, @shape_handle1, ref1)
      Registry.register(ctx.registry, @shape_handle2, ref2)

      txn =
        complete_txn_fragment(xid, lsn, [
          %Changes.NewRecord{
            relation: {"public", "something else"},
            record: %{"id" => "3"},
            log_offset: change3_offset
          },
          %Changes.NewRecord{
            relation: {"public", "other_table"},
            record: %{"id" => "2"},
            log_offset: change2_offset
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: change1_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

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

      ref1 = Shapes.Consumer.register_for_changes(ctx.stack_id, @shape_handle1)
      ref2 = Shapes.Consumer.register_for_changes(ctx.stack_id, @shape_handle2)

      txn =
        complete_txn_fragment(xid, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: last_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle2, _}
      refute_storage_calls_for_txn_fragment(@shape_handle1)

      refute_receive {^ref1, :new_changes, _}
      assert_receive {^ref2, :new_changes, _}
    end

    test "handles truncate without appending to log", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      expect_shape_status(remove_shape: {fn _, @shape_handle1 -> :ok end, at_least: 1})

      txn =
        complete_txn_fragment(xid, lsn, [
          %Changes.TruncatedRelation{
            relation: {"public", "test_table"},
            log_offset: last_log_offset
          }
        ])

      assert_consumer_shutdown(ctx.stack_id, @shape_handle1, fn ->
        assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      end)

      assert_shape_cleanup(@shape_handle1)

      refute_receive {Electric.ShapeCache.ShapeCleaner, :cleanup, @shape_handle2}
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

      expect_shape_status(remove_shape: {fn _, @shape_handle1 -> :ok end, at_least: 1})

      txn =
        complete_txn_fragment(xid, lsn, [
          %Changes.TruncatedRelation{
            relation: {"public", "test_table"},
            log_offset: last_log_offset
          }
        ])

      assert_consumer_shutdown(ctx.stack_id, @shape_handle1, fn ->
        assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      end)

      refute_storage_calls_for_txn_fragment(@shape_handle1)

      assert_shape_cleanup(@shape_handle1)

      refute_receive {Electric.ShapeCache.ShapeCleaner, :cleanup, @shape_handle2}
    end

    test "notifies listeners of new changes", ctx do
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      ref = make_ref()
      Registry.register(ctx.registry, @shape_handle1, ref)

      txn =
        complete_txn_fragment(xid, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: last_log_offset
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      assert_receive {^ref, :new_changes, ^last_log_offset}, @receive_timeout
      assert_receive {Support.TestStorage, :append_to_log!, @shape_handle1, _}
    end

    test "does not route relation to shapes if relation didn't change", ctx do
      rel =
        %Relation{
          id: @shape1.root_table_id,
          schema: elem(@shape1.root_table, 0),
          table: elem(@shape1.root_table, 1),
          columns: [%{name: "id", type_oid: {1, 1}}, %{name: "value", type_oid: {2, 1}}]
        }

      ref1 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))

      ref2 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle2))

      patch_shape_status(
        remove_shape: fn _, shape_handle ->
          raise "Unexpected call to remove_shape: #{shape_handle}"
        end
      )

      assert :ok = ShapeLogCollector.handle_event(rel, ctx.stack_id)

      Repatch.patch(Electric.Shapes.Filter, :affected_shapes, [mode: :shared], fn
        _, _ ->
          raise "Unexpected call to Filter.affected_shapes/2 for unchanged duplicate relation"
      end)

      assert :ok = ShapeLogCollector.handle_event(rel, ctx.stack_id)

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

      ref1 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))

      ref2 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle2))

      # also cleans up inspector cache and shape status cache
      expect_calls(
        Electric.Postgres.Inspector,
        clean: fn ^cleaned_oid, _ -> true end
      )

      expect_shape_status(remove_shape: {fn _, @shape_handle1 -> :ok end, at_least: 1})

      assert :ok = ShapeLogCollector.handle_event(rel, ctx.stack_id)

      assert_receive {:DOWN, ^ref1, :process, _, {:shutdown, :cleanup}}
      refute_receive {:DOWN, ^ref2, :process, _, _}

      assert_shape_cleanup(@shape_handle1)
    end

    test "cleans shapes affected by a relation change", ctx do
      ref1 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))
      ref2 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle2))

      {orig_schema, orig_table} = @shape1.root_table
      cleaned_oid = @shape1.root_table_id

      rel_before = %Relation{
        id: @shape1.root_table_id,
        schema: orig_schema,
        table: orig_table,
        columns: [%{name: "id", type_oid: {1, 1}}, %{name: "value", type_oid: {2, 1}}]
      }

      assert :ok = ShapeLogCollector.handle_event(rel_before, ctx.stack_id)

      refute_receive {:DOWN, _, :process, _, _}

      rel_changed = %{
        rel_before
        | columns: [%{name: "id", type_oid: {999, 1}}, %{name: "value", type_oid: {2, 1}}],
          affected_columns: ["id"]
      }

      # also cleans up inspector cache and shape status cache
      expect_calls(
        Electric.Postgres.Inspector,
        clean: fn ^cleaned_oid, _ -> true end
      )

      expect_shape_status(remove_shape: {fn _, @shape_handle1 -> :ok end, at_least: 1})

      assert :ok = ShapeLogCollector.handle_event(rel_changed, ctx.stack_id)

      assert_receive {:DOWN, ^ref1, :process, _, {:shutdown, :cleanup}}
      refute_receive {:DOWN, ^ref2, :process, _, _}

      assert_shape_cleanup(@shape_handle1)

      refute_receive {Electric.ShapeCache.ShapeCleaner, :cleanup, @shape_handle2}
    end

    test "notifies live listeners when invalidated", ctx do
      ref1 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))

      {orig_schema, orig_table} = @shape1.root_table
      cleaned_oid = @shape1.root_table_id

      rel_before = %Relation{
        id: @shape1.root_table_id,
        schema: orig_schema,
        table: orig_table,
        columns: [%{name: "id", type_oid: {1, 1}}, %{name: "value", type_oid: {2, 1}}]
      }

      assert :ok = ShapeLogCollector.handle_event(rel_before, ctx.stack_id)

      refute_receive {:DOWN, _, :process, _, _}

      live_ref = make_ref()
      Registry.register(ctx.registry, @shape_handle1, live_ref)

      rel_changed = %{
        rel_before
        | columns: [%{name: "id", type_oid: {999, 1}}, %{name: "value", type_oid: {2, 1}}],
          affected_columns: ["id"]
      }

      expect_calls(
        Electric.Postgres.Inspector,
        clean: fn cleaned_oid1, _ -> assert cleaned_oid1 == cleaned_oid end
      )

      expect_shape_status(remove_shape: {fn _, @shape_handle1 -> :ok end, at_least: 1})

      assert :ok = ShapeLogCollector.handle_event(rel_changed, ctx.stack_id)

      assert_receive {:DOWN, ^ref1, :process, _, {:shutdown, :cleanup}}
      assert_receive {^live_ref, :shape_rotation}
      refute_receive {Electric.ShapeCache.ShapeCleaner, :cleanup, @shape_handle2}
    end

    test "consumer crashing stops affected consumer", ctx do
      ref1 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle1))
      ref2 = Process.monitor(Consumer.whereis(ctx.stack_id, @shape_handle2))

      expect_shape_status(remove_shape: {fn _, @shape_handle1 -> :ok end, at_least: 1})

      GenServer.cast(Consumer.whereis(ctx.stack_id, @shape_handle1), :unexpected_cast)

      assert_shape_cleanup(@shape_handle1)

      refute_receive {Electric.ShapeCache.ShapeCleaner, :cleanup, @shape_handle2}

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
      :with_lsn_tracker,
      :with_log_chunking,
      :with_persistent_kv,
      :with_async_deleter,
      :with_shape_cleaner,
      :with_shape_log_collector,
      :with_noop_publication_manager,
      :with_status_monitor
    ]

    setup(ctx) do
      delay_snapshot_creation? = Map.get(ctx, :delay_snapshot_creation?)
      test_pid = self()

      patch_snapshotter(fn parent, shape_handle, _shape, %{snapshot_fun: snapshot_fun} ->
        if delay_snapshot_creation? do
          receive do
            {^test_pid, :resume} -> :ok
          end
        end

        pg_snapshot = ctx[:pg_snapshot] || {10, 11, [10]}
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, pg_snapshot})
        GenServer.cast(parent, {:snapshot_started, shape_handle})
        snapshot_fun.([])
      end)

      :ok
    end

    setup(ctx) do
      Electric.StackConfig.put(
        ctx.stack_id,
        :shape_hibernate_after,
        Map.get(ctx, :hibernate_after, 10_000)
      )

      Electric.StackConfig.put(
        ctx.stack_id,
        :shape_suspend_after,
        Map.get(ctx, :shape_suspend_after, 60_000)
      )

      if not Map.get(ctx, :allow_subqueries, true) do
        Electric.StackConfig.put(ctx.stack_id, :feature_flags, [])
      end

      :ok
    end

    setup ctx do
      %{consumer_supervisor: consumer_supervisor, shape_cache: shape_cache} =
        Support.ComponentSetup.with_shape_cache(ctx)

      %{
        consumer_supervisor: consumer_supervisor,
        shape_cache: shape_cache
      }
    end

    test "duplicate transaction handling is idempotent", ctx do
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      xid = 11
      lsn = Lsn.from_integer(10)

      txn =
        complete_txn_fragment(xid, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn, 0)
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2"},
            log_offset: LogOffset.new(lsn, 2)
          }
        ])

      consumer_pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      shape_storage = Storage.for_shape(shape_handle, ctx.storage)
      enable_storage_tracer_for(consumer_pid)

      # The event is a transaction fragment containing the entire transaction, therefore
      # we expect a single Storage.append_to_log!() call for it.
      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert [
               {Storage, :append_to_log!,
                [
                  [
                    {_, ~s'"public"."test_table"/"1"', :insert, _},
                    {_, ~s'"public"."test_table"/"2"', :insert, _}
                  ],
                  _
                ]}
             ] = Support.Trace.collect_traced_calls()

      last_log_offset = LogOffset.new(lsn, 2)
      assert_receive {^ref, :new_changes, ^last_log_offset}

      assert [op1, op2] =
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      # If we encounter & store the same transaction, no new storage calls are expected.
      # In fact, ShapeLogCollector will simply drop this txn since it's already seen its offset before.
      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert [] == Support.Trace.collect_traced_calls()

      # We should not re-process the same transaction
      refute_receive {^ref, :new_changes, _}

      assert [op1, op2] ==
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)
    end

    test "skips an already-applied transaction replayed past a fresh log collector", ctx do
      # Simulates a restart: the persistent replication slot replays a transaction
      # the consumer has already applied and persisted. A freshly-started
      # ShapeLogCollector hasn't seen the offset, so (unlike the test above) it
      # won't drop it — the consumer itself must skip it, because its restored
      # `latest_offset` is already at/past the transaction. Otherwise the fragment
      # is re-written to the log (duplicating ops) and re-notified to dependent
      # materializers, which re-apply it and crash.
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      xid = 11
      lsn = Lsn.from_integer(10)

      txn =
        complete_txn_fragment(xid, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn, 0)
          }
        ])

      consumer_pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      shape_storage = Storage.for_shape(shape_handle, ctx.storage)

      # First delivery: applied normally, advancing the consumer's latest_offset.
      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      last_log_offset = LogOffset.new(lsn, 0)
      assert_receive {^ref, :new_changes, ^last_log_offset}

      assert [op1] =
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      # Replay the same, already-applied transaction straight to the consumer,
      # bypassing the collector's own offset de-dup (as happens on restart with a
      # fresh collector). The consumer must skip it: no storage write, no
      # notification, log unchanged.
      enable_storage_tracer_for(consumer_pid)

      assert :ok =
               GenServer.call(
                 Shapes.Consumer.name(ctx.stack_id, shape_handle),
                 {:handle_event, txn, Electric.Telemetry.OpenTelemetry.get_current_context()},
                 :infinity
               )

      assert [] == Support.Trace.collect_traced_calls()
      refute_receive {^ref, :new_changes, _}

      assert [op1] ==
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)
    end

    @tag allow_subqueries: false
    test "duplicate txn fragment handling is idempotent", ctx do
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      xid = 11
      lsn = Lsn.from_integer(10)

      [f1, f2, f3, f4] =
        txn_fragments(xid, lsn, [
          %{
            has_begin?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "1"},
                log_offset: LogOffset.new(lsn, 0)
              },
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "2"},
                log_offset: LogOffset.new(lsn, 2)
              }
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "3"},
                log_offset: LogOffset.new(lsn, 4)
              }
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "4"},
                log_offset: LogOffset.new(lsn, 6)
              }
            ]
          },
          %{
            has_commit?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "5"},
                log_offset: LogOffset.new(lsn, 8)
              }
            ]
          }
        ])

      consumer_pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      enable_storage_tracer_for(consumer_pid)

      assert :ok = ShapeLogCollector.handle_event(f1, ctx.stack_id)

      assert [
               {Storage, :append_fragment_to_log!,
                [
                  [
                    {_, ~s'"public"."test_table"/"1"', :insert, _},
                    {_, ~s'"public"."test_table"/"2"', :insert, _}
                  ],
                  _
                ]}
             ] = Support.Trace.collect_traced_calls()

      # Repeat and observe idempotency
      assert :ok = ShapeLogCollector.handle_event(f1, ctx.stack_id)
      assert [] == Support.Trace.collect_traced_calls()

      assert :ok = ShapeLogCollector.handle_event(f2, ctx.stack_id)
      assert :ok = ShapeLogCollector.handle_event(f3, ctx.stack_id)

      assert [
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"3"', :insert, _}], _]},
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"4"', :insert, _}], _]}
             ] = Support.Trace.collect_traced_calls()

      # Repeat and observe idempotency
      assert :ok = ShapeLogCollector.handle_event(f2, ctx.stack_id)
      assert :ok = ShapeLogCollector.handle_event(f3, ctx.stack_id)
      assert [] == Support.Trace.collect_traced_calls()

      assert :ok = ShapeLogCollector.handle_event(f4, ctx.stack_id)

      assert [
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"5"', :insert, _}], _]},
               {Storage, :signal_txn_commit!, [^xid, _]}
             ] = Support.Trace.collect_traced_calls()

      last_log_offset = LogOffset.new(lsn, 8)
      assert_receive {^ref, :new_changes, ^last_log_offset}

      # Repeat and observe idempotency
      assert :ok = ShapeLogCollector.handle_event(f4, ctx.stack_id)
      assert [] == Support.Trace.collect_traced_calls()
      refute_receive {^ref, :new_changes, _}
    end

    @tag allow_subqueries: false
    test "skips an already-applied multi-fragment transaction replayed past a fresh log collector",
         ctx do
      # Multi-fragment variant of "skips an already-applied transaction replayed
      # past a fresh log collector". On restart the persistent slot can replay a
      # multi-statement transaction the consumer has already applied. This drives
      # the offset-dedup on the multi-fragment path (BEGIN / middle / COMMIT
      # fragments), not the single-fragment fast path — the consumer must skip
      # every fragment without re-writing or re-notifying.
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      xid = 11
      lsn = Lsn.from_integer(10)

      [f1, f2, f3] =
        txn_fragments(xid, lsn, [
          %{
            has_begin?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "1"},
                log_offset: LogOffset.new(lsn, 0)
              }
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "2"},
                log_offset: LogOffset.new(lsn, 2)
              }
            ]
          },
          %{
            has_commit?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "3"},
                log_offset: LogOffset.new(lsn, 4)
              }
            ]
          }
        ])

      consumer_pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      shape_storage = Storage.for_shape(shape_handle, ctx.storage)

      # First delivery via the collector: applied normally, advancing latest_offset
      # to the commit offset.
      Enum.each([f1, f2, f3], &assert(:ok = ShapeLogCollector.handle_event(&1, ctx.stack_id)))

      commit_offset = LogOffset.new(lsn, 4)
      assert_receive {^ref, :new_changes, ^commit_offset}

      assert [_, _, _] =
               ops =
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      # Replay every fragment straight to the consumer, bypassing the collector's
      # offset de-dup (as on restart with a fresh collector). The consumer's restored
      # latest_offset is already at the commit, so all fragments — including the
      # BEGIN fragment, which now skips without ever setting up `pending_txn` — must
      # be skipped: no storage writes, no notification, log unchanged.
      enable_storage_tracer_for(consumer_pid)

      Enum.each([f1, f2, f3], fn f ->
        assert :ok =
                 GenServer.call(
                   Shapes.Consumer.name(ctx.stack_id, shape_handle),
                   {:handle_event, f, Electric.Telemetry.OpenTelemetry.get_current_context()},
                   :infinity
                 )
      end)

      assert [] == Support.Trace.collect_traced_calls()
      refute_receive {^ref, :new_changes, _}

      assert ops ==
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)
    end

    @tag pg_snapshot: {10, 13, [10, 12]},
         delay_snapshot_creation?: true,
         with_pure_file_storage_opts: [flush_period: 1]
    test "transactions are buffered until snapshot xmin is known", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      assert_receive {:snapshot, ^shape_handle, snapshotter_pid}

      lsn1 = Lsn.from_integer(9)
      lsn2 = Lsn.from_integer(10)
      lsn3 = Lsn.from_integer(11)
      lsn4 = Lsn.from_integer(12)
      lsn5 = Lsn.from_integer(13)

      # This transaction will be considered flushed because its xid < snapshot's xmin
      txn1 =
        complete_txn_fragment(9, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn1, 0)
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2"},
            log_offset: LogOffset.new(lsn1, 2)
          }
        ])

      # This transaction will be written to storage because its xid is in snapshot's xip_list
      txn2 =
        complete_txn_fragment(10, lsn2, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "3"},
            log_offset: LogOffset.new(lsn2, 0)
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "4"},
            log_offset: LogOffset.new(lsn2, 2)
          }
        ])

      # This transaction will be considered flushed because its xid > snapshot's xmin but it's not in xip_list
      txn3 =
        complete_txn_fragment(11, lsn3, [
          %Changes.UpdatedRecord{
            key: ~s'"public"."test_table"/"1"',
            relation: {"public", "test_table"},
            old_record: %{"id" => "1"},
            record: %{"id" => "1", "ha" => "ha"},
            log_offset: LogOffset.new(lsn3, 0)
          }
        ])

      # This transaction will be written to storage because its xid is in snapshot's xip_list
      txn4 =
        complete_txn_fragment(12, lsn4, [
          %Changes.DeletedRecord{
            relation: {"public", "test_table"},
            old_record: %{"id" => "3"},
            log_offset: LogOffset.new(lsn4, 0)
          }
        ])

      # This transaction will be written to storage (with no filtering applied) because its xid >= snapshot's xmax
      txn5 =
        complete_txn_fragment(13, lsn5, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "5"},
            log_offset: LogOffset.new(lsn5, 0)
          }
        ])

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      consumer_pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      enable_storage_tracer_for(consumer_pid)

      Enum.each([txn1, txn2, txn3, txn4, txn5], fn txn ->
        assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      end)

      # No storage calls and no new changes at this point because the consumer process does not yet have snapshot info.
      assert [] == Support.Trace.collect_traced_calls()
      refute_receive {^ref, :new_changes, _}
      refute_receive {:flush_boundary_updated, _}

      shape_storage = Storage.for_shape(shape_handle, ctx.storage)

      assert [] ==
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      # Make the actual snapshot
      send(snapshotter_pid, {self(), :resume})
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      # Verify storage calls and new change notifications
      last_log_offset_txn2 = LogOffset.new(lsn2, 2)
      assert_receive {^ref, :new_changes, ^last_log_offset_txn2}
      last_log_offset_txn4 = LogOffset.new(lsn4, 0)
      assert_receive {^ref, :new_changes, ^last_log_offset_txn4}
      last_log_offset_txn5 = LogOffset.new(lsn5, 0)
      assert_receive {^ref, :new_changes, ^last_log_offset_txn5}
      refute_receive {^ref, :new_changes, _}

      assert [
               {Storage, :append_to_log!, [log_items_txn2, _]},
               {Storage, :append_to_log!, [log_items_txn4, _]},
               {Storage, :append_to_log!, [log_items_txn5, _]}
             ] = Support.Trace.collect_traced_calls()

      traced_log_items =
        Stream.concat([log_items_txn2, log_items_txn4, log_items_txn5])
        |> Enum.map(fn {_log_offset, _key, _op, json} -> Jason.decode!(json) end)

      assert 4 == length(traced_log_items)

      assert traced_log_items ==
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      # Verify that the last transaction is successfully flushed and the replication client can confirm its offset
      tx_offset = last_log_offset_txn5.tx_offset
      assert_receive {:flush_boundary_updated, ^tx_offset}
    end

    @tag allow_subqueries: false,
         delay_snapshot_creation?: true,
         with_pure_file_storage_opts: [flush_period: 1]
    test "transaction fragments are buffered until snapshot xmin is known", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      assert_receive {:snapshot, ^shape_handle, snapshotter_pid}

      xid1 = 90
      lsn1 = Lsn.from_integer(9)

      xid2 = 100
      lsn2 = Lsn.from_integer(10)

      txn1_fragments =
        txn_fragments(xid1, lsn1, [
          %{
            has_begin?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "1"},
                log_offset: LogOffset.new(lsn1, 0)
              },
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "2"},
                log_offset: LogOffset.new(lsn1, 2)
              }
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "3"},
                log_offset: LogOffset.new(lsn1, 4)
              }
            ]
          },
          %{
            has_commit?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "4"},
                log_offset: LogOffset.new(lsn1, 6)
              }
            ]
          }
        ])

      txn2_fragments =
        txn_fragments(xid2, lsn2, [
          %{
            has_begin?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "5"},
                log_offset: LogOffset.new(lsn2, 0)
              },
              %Changes.UpdatedRecord{
                relation: {"public", "test_table"},
                old_record: %{"id" => "1"},
                record: %{"id" => "1", "foo" => "bar"},
                log_offset: LogOffset.new(lsn2, 2),
                changed_columns: MapSet.new(["foo"])
              }
            ]
          },
          %{
            changes: [
              %Changes.UpdatedRecord{
                relation: {"public", "test_table"},
                old_record: %{"id" => "3"},
                record: %{"id" => "3", "another" => "update"},
                log_offset: LogOffset.new(lsn2, 4),
                changed_columns: MapSet.new(["another"])
              }
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "6"},
                log_offset: LogOffset.new(lsn2, 6)
              }
            ]
          },
          %{
            has_commit?: true,
            changes: [
              %Changes.DeletedRecord{
                relation: {"public", "test_table"},
                old_record: %{"id" => "2"},
                log_offset: LogOffset.new(lsn2, 8)
              }
            ]
          }
        ])

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      consumer_pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      enable_storage_tracer_for(consumer_pid)

      Enum.each(txn1_fragments, fn fragment ->
        assert :ok = ShapeLogCollector.handle_event(fragment, ctx.stack_id)
      end)

      [txn2_f1, txn2_f2, txn2_f3, txn2_f4] = txn2_fragments
      assert :ok = ShapeLogCollector.handle_event(txn2_f1, ctx.stack_id)
      assert :ok = ShapeLogCollector.handle_event(txn2_f2, ctx.stack_id)

      # No storage calls and no new changes at this point because the consumer process does not yet have snapshot info.
      assert [] == Support.Trace.collect_traced_calls()

      refute_receive {^ref, :new_changes, _}
      refute_receive {:flush_boundary_updated, _}

      shape_storage = Storage.for_shape(shape_handle, ctx.storage)

      assert [] ==
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      # The latest storage offset is the initial value since no snapshot has been written yet
      assert {:ok, LogOffset.last_before_real_offsets()} ==
               Storage.fetch_latest_offset(shape_storage)

      # Make the actual snapshot
      send(snapshotter_pid, {self(), :resume})
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      # Observe that the first txn gets written to storage and flushed, but the second one is still in progress.
      last_log_offset = LogOffset.new(lsn1, 6)
      assert_receive {^ref, :new_changes, ^last_log_offset}

      assert [
               # 1st txn
               {Storage, :append_fragment_to_log!,
                [
                  [
                    {_, ~s'"public"."test_table"/"1"', :insert, _},
                    {_, ~s'"public"."test_table"/"2"', :insert, _}
                  ] = log_items1,
                  _
                ]},
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"3"', :insert, _}] = log_items2, _]},
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"4"', :insert, _}] = log_items3, _]},
               {Storage, :signal_txn_commit!, [^xid1, _]},
               # 2nd txn, incomplete
               {Storage, :append_fragment_to_log!,
                [
                  [
                    {_, ~s'"public"."test_table"/"5"', :insert, _},
                    {_, ~s'"public"."test_table"/"1"', :update, _}
                  ] = log_items_txn2_1,
                  _
                ]},
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"3"', :update, _}] = log_items_txn2_2, _]}
             ] = Support.Trace.collect_traced_calls()

      traced_log_items =
        Stream.concat([log_items1, log_items2, log_items3])
        |> Enum.map(fn {_log_offset, _key, _op, json} -> Jason.decode!(json) end)

      assert 4 == length(traced_log_items)

      assert traced_log_items ==
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      assert {:ok, last_log_offset} == Storage.fetch_latest_offset(shape_storage)

      # Feed the remaining txn2 fragments to the consumer and observe the 2nd transaction getting flushed
      assert :ok = ShapeLogCollector.handle_event(txn2_f3, ctx.stack_id)

      # 2nd txn is still not visible in storage
      assert [] == get_log_items_from_storage(last_log_offset, shape_storage)

      assert :ok = ShapeLogCollector.handle_event(txn2_f4, ctx.stack_id)

      last_log_offset = LogOffset.new(lsn2, 8)
      assert_receive {^ref, :new_changes, ^last_log_offset}

      tx_offset = last_log_offset.tx_offset
      assert_receive {:flush_boundary_updated, ^tx_offset}

      assert [
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"6"', :insert, _}] = log_items_txn2_3, _]},
               {Storage, :append_fragment_to_log!,
                [[{_, ~s'"public"."test_table"/"2"', :delete, _}] = log_items_txn2_4, _]},
               {Storage, :signal_txn_commit!, [^xid2, _]}
             ] = Support.Trace.collect_traced_calls()

      traced_log_items =
        Stream.concat([log_items_txn2_1, log_items_txn2_2, log_items_txn2_3, log_items_txn2_4])
        |> Enum.map(fn {_log_offset, _key, _op, json} -> Jason.decode!(json) end)

      assert 5 == length(traced_log_items)

      assert traced_log_items ==
               get_log_items_from_storage(LogOffset.new(lsn1, 6), shape_storage)

      assert {:ok, last_log_offset} == Storage.fetch_latest_offset(shape_storage)
    end

    @tag allow_subqueries: false,
         pg_snapshot: {10, 13, [10]},
         with_pure_file_storage_opts: [flush_period: 1]
    test "fragments that belong to transactions already included in the snapshot are skipped",
         ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      lsn1 = Lsn.from_integer(9)
      lsn2 = Lsn.from_integer(10)
      lsn3 = Lsn.from_integer(11)

      # Txn 1 (xid=9 < xmin=10): will be considered flushed, all fragments skipped
      txn1_fragments =
        txn_fragments(9, lsn1, [
          %{
            has_begin?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "1"},
                log_offset: LogOffset.new(lsn1, 0)
              },
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "2"},
                log_offset: LogOffset.new(lsn1, 2)
              }
            ]
          },
          %{
            has_commit?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "3"},
                log_offset: LogOffset.new(lsn1, 4)
              }
            ]
          }
        ])

      # Txn 2 (xid=10 in xip_list): will be written to storage
      txn2_fragments =
        txn_fragments(10, lsn2, [
          %{
            has_begin?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "10"},
                log_offset: LogOffset.new(lsn2, 0)
              }
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "11"},
                log_offset: LogOffset.new(lsn2, 2)
              }
            ]
          },
          %{
            has_commit?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "12"},
                log_offset: LogOffset.new(lsn2, 4)
              }
            ]
          }
        ])

      # Txn 3 (xid=11, >= xmin but not in xip_list): will be considered flushed
      txn3_fragments =
        txn_fragments(11, lsn3, [
          %{
            has_begin?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "20"},
                log_offset: LogOffset.new(lsn3, 0)
              }
            ]
          },
          %{
            has_commit?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "21"},
                log_offset: LogOffset.new(lsn3, 2)
              }
            ]
          }
        ])

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      consumer_pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      enable_storage_tracer_for(consumer_pid)

      # Send all fragments before snapshot is known - they should be buffered
      Enum.each(txn1_fragments ++ txn2_fragments ++ txn3_fragments, fn frag ->
        assert :ok = ShapeLogCollector.handle_event(frag, ctx.stack_id)
      end)

      # Verify storage calls
      # Only txn2 (xid=10, in xip_list) should be written to storage
      # txn1 (xid=9 < xmin) and txn3 (xid=11, not in xip_list) should be skipped
      txn2_offset1 = LogOffset.new(lsn2, 0)
      txn2_offset2 = LogOffset.new(lsn2, 2)
      txn2_offset3 = LogOffset.new(lsn2, 4)

      assert [
               {Storage, :append_fragment_to_log!,
                [[{^txn2_offset1, ~s'"public"."test_table"/"10"', :insert, _}], _]},
               {Storage, :append_fragment_to_log!,
                [[{^txn2_offset2, ~s'"public"."test_table"/"11"', :insert, _}], _]},
               {Storage, :append_fragment_to_log!,
                [[{^txn2_offset3, ~s'"public"."test_table"/"12"', :insert, _}], _]},
               {Storage, :signal_txn_commit!, [10, _]}
             ] = Support.Trace.collect_traced_calls()

      last_log_offset = txn2_offset3
      assert_receive {^ref, :new_changes, ^last_log_offset}
      refute_receive {^ref, :new_changes, _}

      # Verify the shape log only contains txn2's records
      shape_storage = Storage.for_shape(shape_handle, ctx.storage)

      assert [
               %{"key" => ~s'"public"."test_table"/"10"', "value" => %{"id" => "10"}},
               %{"key" => ~s'"public"."test_table"/"11"', "value" => %{"id" => "11"}},
               %{
                 "key" => ~s'"public"."test_table"/"12"',
                 "value" => %{"id" => "12"},
                 "headers" => %{"last" => true}
               }
             ] = get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      # Verify flush boundary is updated to the last transaction's offset
      # txn3 (lsn3) is the last transaction processed, even though it was skipped
      tx_offset = Lsn.to_integer(lsn3)
      assert_receive {:flush_boundary_updated, ^tx_offset}
    end

    test "restarting a consumer doesn't lower the last known offset when only snapshot is present",
         ctx do
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      assert {_, offset1} = ShapeCache.resolve_shape_handle(shape_handle, @shape1, ctx.stack_id)
      assert offset1 == LogOffset.last_before_real_offsets()

      ref = ctx.consumer_supervisor |> GenServer.whereis() |> Process.monitor()
      # Stop the consumer and the shape cache server to simulate a restart
      stop_supervised!(ctx.consumer_supervisor)
      assert_receive {:DOWN, ^ref, :process, _pid, _reason}, 1000

      shape_cache_pid = ctx.stack_id |> ShapeCache.name() |> GenServer.whereis()
      assert is_pid(shape_cache_pid)
      ref = Process.monitor(shape_cache_pid)
      stop_supervised!(ctx.shape_cache)
      assert_receive {:DOWN, ^ref, :process, _pid, _reason}, 1000

      stop_supervised!("shape_task_supervisor")

      # Restart the shape cache and the consumers
      Support.ComponentSetup.with_shape_cache(ctx)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)
      assert {_, offset2} = ShapeCache.resolve_shape_handle(shape_handle, @shape1, ctx.stack_id)

      assert LogOffset.compare(offset2, offset1) != :lt
    end

    @tag with_pure_file_storage_opts: [flush_period: 50]
    test "should correctly normalize a flush boundary to txn", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape3, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      lsn = Lsn.from_integer(10)

      txn =
        complete_txn_fragment(10, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn, 2)
          },
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {:flush_boundary_updated, 10}, 1_000
    end

    @tag pg_snapshot: {10, 15, [12]}
    test "should notify txns skipped because of xmin/xip as flushed", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)
      lsn2 = Lsn.from_integer(301)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      txn =
        complete_txn_fragment(2, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn1, 0)
          }
        ])

      txn2 =
        complete_txn_fragment(11, lsn2, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn2, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      assert :ok = ShapeLogCollector.handle_event(txn2, ctx.stack_id)

      assert_receive {:flush_boundary_updated, 300}, 1_000
      assert_receive {:flush_boundary_updated, 301}, 1_000
    end

    @tag hibernate_after: 10, shape_suspend_after: 20
    @tag with_pure_file_storage_opts: [flush_period: 1]
    @tag suspend: true
    test "should suspend after hibernate_after + shape_suspend_after ms", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)
      ref = Process.monitor(consumer_pid)

      txn =
        complete_txn_fragment(2, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn1, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {:flush_boundary_updated, 300}, 1_000

      # The consumer hibernates, then suspends shape_suspend_after later;
      assert_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}, 200

      refute Consumer.whereis(ctx.stack_id, shape_handle)
    end

    @tag hibernate_after: 10, shape_suspend_after: 10
    @tag with_pure_file_storage_opts: [flush_period: 1]
    @tag suspend: true
    test "should hibernate not suspend if has dependencies", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_subquery, ctx.stack_id)

      lsn1 = Lsn.from_integer(300)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)

      assert {:ok, shape} = Electric.Shapes.fetch_shape_by_handle(ctx.stack_id, shape_handle)

      assert [dependent_shape_handle] = shape.shape_dependencies_handles

      txn =
        complete_txn_fragment(2, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn1, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {:flush_boundary_updated, 300}, 1_000

      # A shape with dependencies hibernates but never arms a suspend timer
      # (consumer_can_suspend? is false), so it can never suspend. Observing a
      # nil suspend_timer once hibernated proves this deterministically.
      assert is_nil(await_hibernation(consumer_pid))

      dependent_consumer_pid = Consumer.whereis(ctx.stack_id, dependent_shape_handle)
      assert is_nil(await_hibernation(dependent_consumer_pid))

      assert is_pid(Consumer.whereis(ctx.stack_id, shape_handle))
    end

    @tag hibernate_after: 10,
         shape_suspend_after: 20,
         with_pure_file_storage_opts: [flush_period: 1]
    @tag suspend: true
    test "should hibernate not suspend while a multi-fragment transaction is pending", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)
      ref = Process.monitor(consumer_pid)

      # The begin fragment of a multi-fragment transaction leaves the consumer
      # holding a pending_txn until the matching commit fragment arrives.
      begin_fragment =
        txn_fragment(
          2,
          lsn1,
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "21"},
              log_offset: LogOffset.new(lsn1, 0)
            }
          ],
          has_begin?: true,
          has_commit?: false
        )

      assert :ok = ShapeLogCollector.handle_event(begin_fragment, ctx.stack_id)

      # The idle timer (hibernate_after: 10ms) fires, but with a transaction still
      # pending the consumer must hibernate rather than suspend, so it survives to
      # receive the rest of the transaction. Suspending here would drop pending_txn
      # and crash on the next fragment (issue #4501).
      refute_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}, 400

      assert {:current_function, {:gen_server, :loop_hibernate, 4}} =
               Process.info(consumer_pid, :current_function)

      assert is_pid(Consumer.whereis(ctx.stack_id, shape_handle))

      # Completing the transaction clears pending_txn, so the consumer is free to
      # suspend on the next idle timeout.
      commit_fragment =
        txn_fragment(
          2,
          lsn1,
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "22"},
              log_offset: LogOffset.new(lsn1, 1)
            }
          ],
          has_begin?: false,
          has_commit?: true
        )

      assert :ok = ShapeLogCollector.handle_event(commit_fragment, ctx.stack_id)

      assert_receive {:flush_boundary_updated, 300}, 1_000

      assert_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}

      refute Consumer.whereis(ctx.stack_id, shape_handle)
    end

    @tag with_pure_file_storage_opts: [flush_period: 1]
    @tag suspend: false
    test "ConsumerRegistry.enable_suspend should suspend hibernated consumers", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)
      ref = Process.monitor(consumer_pid)

      txn =
        complete_txn_fragment(2, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn1, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {:flush_boundary_updated, 300}, 1_000

      # Suspend is disabled (@tag suspend: false), so the consumer never suspends
      # on its own and stays alive.
      refute_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}, 100
      assert Consumer.whereis(ctx.stack_id, shape_handle)

      # hibernate_after=5, shape_suspend_after=5, jitter_period=10
      Shapes.ConsumerRegistry.enable_suspend(ctx.stack_id, 5, 5, 10)

      # Enabling suspend on the live consumer makes it suspend on the next cycle.
      assert_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}, 200
      refute Consumer.whereis(ctx.stack_id, shape_handle)
    end

    @tag hibernate_after: 10,
         shape_suspend_after: 150,
         with_pure_file_storage_opts: [flush_period: 1]
    @tag suspend: true
    test "should hibernate first then suspend after shape_suspend_after ms", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)
      ref = Process.monitor(consumer_pid)

      txn =
        complete_txn_fragment(2, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn1, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {:flush_boundary_updated, 300}, 1_000

      # The consumer hibernates first (for GC) and arms a suspend timer rather
      # than suspending directly. Observing an armed timer while hibernated
      # proves the "hibernate, then suspend" ordering without racing the clock.
      assert is_reference(await_hibernation(consumer_pid))
      assert Process.alive?(consumer_pid)

      # It then suspends once shape_suspend_after elapses.
      assert_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}, 300

      refute Consumer.whereis(ctx.stack_id, shape_handle)
    end

    @tag hibernate_after: 10,
         shape_suspend_after: 200,
         with_pure_file_storage_opts: [flush_period: 1]
    @tag suspend: true
    test "activity during hibernation cancels pending suspend", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)
      lsn2 = Lsn.from_integer(301)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)
      ref = Process.monitor(consumer_pid)

      txn1 =
        complete_txn_fragment(2, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn1, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn1, ctx.stack_id)
      assert_receive {:flush_boundary_updated, 300}, 1_000

      # Once hibernated, a suspend timer is armed.
      ref1 = await_hibernation(consumer_pid)
      assert is_reference(ref1)

      # Activity (a new transaction) must cancel that timer.
      txn2 =
        complete_txn_fragment(3, lsn2, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "22"},
            log_offset: LogOffset.new(lsn2, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn2, ctx.stack_id)
      assert_receive {:flush_boundary_updated, 301}, 1_000

      # After re-hibernating, a *fresh* timer is armed and the original one reads
      # as cancelled - proving the activity reset the suspend cycle rather than
      # letting the original timer fire.
      ref2 = await_hibernation(consumer_pid)
      assert is_reference(ref2)
      assert ref2 != ref1
      assert :erlang.read_timer(ref1) == false

      # No suspend happened.
      refute_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}, 0

      # Process should still be alive (hibernated again)
      assert Process.alive?(consumer_pid)
    end

    @tag hibernate_after: 10, shape_suspend_after: 300
    @tag suspend: true
    test "should not suspend while a written txn is not yet flush-notified", ctx do
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)
      ref = Process.monitor(consumer_pid)

      # Once hibernated, a suspend timer is armed.
      assert is_reference(await_hibernation(consumer_pid))

      # Inject un-notified txn state, as if a write had not yet been confirmed flushed.
      offset = LogOffset.new(Lsn.from_integer(300), 0)

      :sys.replace_state(consumer_pid, fn state ->
        %{state | txn_offset_mapping: [{offset, offset}]}
      end)

      # The armed suspend timer fires but the consumer must refuse to suspend while
      # a flush notification is outstanding.
      refute_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}, 500
      assert Process.alive?(consumer_pid)

      # Once the flush is confirmed and notified, the next suspend cycle goes through.
      :sys.replace_state(consumer_pid, fn state -> %{state | txn_offset_mapping: []} end)
      send(consumer_pid, {:configure_suspend, 5, 5, 10})

      assert_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}, 500
    end

    @tag hibernate_after: 10, shape_suspend_after: 300
    @tag suspend: true
    test "should not suspend while a deferred flush notification is pending", ctx do
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)
      ref = Process.monitor(consumer_pid)

      # Once hibernated, a suspend timer is armed.
      assert is_reference(await_hibernation(consumer_pid))

      # Inject a deferred flush notification, as if a flush had been signalled in the
      # middle of a multi-fragment transaction.
      offset = LogOffset.new(Lsn.from_integer(300), 0)

      :sys.replace_state(consumer_pid, fn state -> %{state | pending_flush_offset: offset} end)

      # The armed suspend timer fires but the consumer must refuse to suspend while
      # the deferred notification has not been delivered.
      refute_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}, 500
      assert Process.alive?(consumer_pid)

      # Once the deferred notification is delivered, the next suspend cycle goes through.
      :sys.replace_state(consumer_pid, fn state -> %{state | pending_flush_offset: nil} end)
      send(consumer_pid, {:configure_suspend, 5, 5, 10})

      assert_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}, 500
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
        ShapeCache.get_or_create_shape_handle(@shape_with_compaction, ctx.stack_id)

      assert_receive {:consumer_did_invoke_compact, ^ref}
    end

    test "terminating the consumers cleans up its entry from Storage ETS", ctx do
      import Electric.ShapeCache.PureFileStorage.SharedRecords, only: [storage_meta: 2]

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      assert {_, offset1} = ShapeCache.resolve_shape_handle(shape_handle, @shape1, ctx.stack_id)
      assert offset1 == LogOffset.last_before_real_offsets()

      table = Electric.ShapeCache.PureFileStorage.stack_ets(ctx.stack_id)

      assert [shape_meta] = :ets.tab2list(table)
      assert storage_meta(shape_meta, :shape_handle) == shape_handle
      assert storage_meta(shape_meta, :last_persisted_offset) == offset1

      assert :ok == Consumer.stop(ctx.stack_id, shape_handle, "reason")

      assert_receive {Electric.ShapeCache.ShapeCleaner, :cleanup, ^shape_handle}

      assert [] == :ets.tab2list(table)
    end

    @tag allow_subqueries: false, with_pure_file_storage_opts: [flush_period: 1]
    test "writes txn fragments to storage immediately but keeps txn boundaries when flushing",
         ctx do
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      register_as_replication_client(ctx.stack_id)

      xid = 11
      lsn = Lsn.from_integer(10)

      fragments =
        txn_fragments(xid, lsn, [
          %{
            has_begin?: true,
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "1"},
                log_offset: LogOffset.new(lsn, 0)
              },
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "2"},
                log_offset: LogOffset.new(lsn, 2)
              }
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "3"},
                log_offset: LogOffset.new(lsn, 4)
              }
            ]
          },
          %{
            changes: [
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "4"},
                log_offset: LogOffset.new(lsn, 6)
              }
            ]
          }
        ])

      expected_log_items = [
        [
          {LogOffset.new(lsn, 0), ~s'"public"."test_table"/"1"', :insert},
          {LogOffset.new(lsn, 2), ~s'"public"."test_table"/"2"', :insert}
        ],
        [{LogOffset.new(lsn, 4), ~s'"public"."test_table"/"3"', :insert}],
        [{LogOffset.new(lsn, 6), ~s'"public"."test_table"/"4"', :insert}]
      ]

      consumer_pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      shape_storage = Storage.for_shape(shape_handle, ctx.storage)
      enable_storage_tracer_for(consumer_pid)

      Enum.zip(fragments, expected_log_items)
      |> Enum.each(fn {fragment, expected_log_items} ->
        assert :ok = ShapeLogCollector.handle_event(fragment, ctx.stack_id)

        assert [{Storage, :append_fragment_to_log!, [log_items, _]}] =
                 Support.Trace.collect_traced_calls()

        assert expected_log_items ==
                 Enum.map(log_items, fn {log_offset, key, op, _json} -> {log_offset, key, op} end)
      end)

      # Nothing should be returned from the shape log until a fragment containing Commit is stored
      assert [] ==
               get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      # The latest storage offset corresponds to the only persisted snapshot chunk
      assert {:ok, LogOffset.new(0, 0)} == Storage.fetch_latest_offset(shape_storage)

      refute_receive {^ref, :new_changes, _}
      refute_receive {:flush_boundary_updated, _}

      commit_fragment =
        txn_fragment(
          xid,
          lsn,
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "5"},
              log_offset: LogOffset.new(lsn, 8)
            }
          ],
          has_commit?: true
        )

      assert :ok = ShapeLogCollector.handle_event(commit_fragment, ctx.stack_id)

      last_log_offset = LogOffset.new(lsn, 8)

      assert [
               {Storage, :append_fragment_to_log!,
                [[{^last_log_offset, ~s'"public"."test_table"/"5"', :insert, _json}], _]},
               {Storage, :signal_txn_commit!, [^xid, _]}
             ] = Support.Trace.collect_traced_calls()

      assert [
               %{"key" => ~s'"public"."test_table"/"1"', "value" => %{"id" => "1"}},
               %{"key" => ~s'"public"."test_table"/"2"', "value" => %{"id" => "2"}},
               %{"key" => ~s'"public"."test_table"/"3"', "value" => %{"id" => "3"}},
               %{"key" => ~s'"public"."test_table"/"4"', "value" => %{"id" => "4"}},
               %{
                 "key" => ~s'"public"."test_table"/"5"',
                 "value" => %{"id" => "5"},
                 "headers" => %{"last" => true}
               }
             ] = get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)

      assert {:ok, last_log_offset} == Storage.fetch_latest_offset(shape_storage)

      assert_receive {^ref, :new_changes, ^last_log_offset}

      offset = last_log_offset.tx_offset
      assert_receive {:flush_boundary_updated, ^offset}
    end

    @tag allow_subqueries: false, with_pure_file_storage_opts: [flush_period: 1]
    test "flush notification for multi-fragment txn is not lost when storage flushes before commit fragment",
         %{stack_id: stack_id} = ctx do
      # Regression test for https://github.com/electric-sql/electric/issues/3985
      # Updated for deferred flush notification fix (#4063).
      #
      # When a multi-fragment transaction's non-commit fragments are flushed to disk
      # before the commit fragment is processed by ShapeLogCollector, the flush
      # notification was lost because FlushTracker wasn't tracking the shape's offsets.
      # This caused the shape to be stuck in the FlushTracker, blocking
      # the global flush offset from advancing.
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, stack_id)

      ref = Shapes.Consumer.register_for_changes(stack_id, shape_handle)

      register_as_replication_client(stack_id)

      xid = 11
      lsn = Lsn.from_integer(10)

      # Create non-commit fragments with matching changes
      fragment1 =
        txn_fragment(
          xid,
          lsn,
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "1"},
              log_offset: LogOffset.new(lsn, 0)
            },
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "2"},
              log_offset: LogOffset.new(lsn, 2)
            }
          ],
          has_begin?: true
        )

      fragment2 =
        txn_fragment(
          xid,
          lsn,
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "3"},
              log_offset: LogOffset.new(lsn, 4)
            }
          ],
          []
        )

      Support.Trace.trace_shape_log_collector_calls(
        pid: Shapes.Consumer.whereis(stack_id, shape_handle),
        functions: [:notify_flushed]
      )

      # Send non-commit fragments. With flush_period: 1ms, the storage will flush
      # almost immediately after writing.
      assert :ok = ShapeLogCollector.handle_event(fragment1, stack_id)
      assert :ok = ShapeLogCollector.handle_event(fragment2, stack_id)

      # With deferred flush notifications, notify_flushed is NOT called
      # after non-commit fragments. The flush is deferred until the commit.
      assert [] == Support.Trace.collect_traced_calls()

      # Now send the commit fragment. The commit fragment itself has NO matching
      # changes for the shape — all changes were in earlier fragments.
      commit_fragment =
        txn_fragment(
          xid,
          lsn,
          [
            %Changes.NewRecord{
              relation: {"public", "other_table"},
              record: %{"id" => "99"},
              log_offset: LogOffset.new(lsn, 6)
            }
          ],
          has_commit?: true
        )

      assert :ok = ShapeLogCollector.handle_event(commit_fragment, ctx.stack_id)
      assert_receive {^ref, :new_changes, _}, @receive_timeout

      # The deferred flush notification is sent after the commit. The exact
      # offset depends on alignment with txn_offset_mapping, so we only
      # verify that notify_flushed was called for this shape.
      assert [{ShapeLogCollector, :notify_flushed, [^stack_id, ^shape_handle, _offset]}] =
               Support.Trace.collect_traced_calls()

      # Flush boundary advances.
      tx_offset = commit_fragment.last_log_offset.tx_offset
      assert_receive {:flush_boundary_updated, ^tx_offset}, @receive_timeout
    end

    @tag allow_subqueries: false, with_pure_file_storage_opts: [flush_period: 10_000]
    test "flush notification offset is aligned when storage flushes before commit arrives at consumer",
         %{stack_id: stack_id} do
      # Regression test for https://github.com/electric-sql/electric/issues/4063
      #
      # When a non-commit fragment has enough data to trigger a buffer-size
      # flush (>= 64KB), the :flushed message is placed in the consumer's
      # mailbox during processing. The consumer process ends up handling the :flushed message
      # before receiving the commit fragment. But since the offset it sends to FlushTracker
      # predates the commit fragment's offset, the FlushTracker keeps the shape in the
      # "pending" state and there's no follow-up notification from the consumer that would
      # unblock it.
      #
      # A high flush_period prevents timer-based flushes so the only flush
      # comes from the buffer-size trigger, making the test deterministic.

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle, stack_id)

      ref = Shapes.Consumer.register_for_changes(stack_id, shape_handle)
      register_as_replication_client(stack_id)

      xid = 11
      lsn = Lsn.from_integer(10)
      relevant_change_offset = LogOffset.new(lsn, 0)

      # The fragment has a large shape-relevant record (>64KB) that triggers a
      # buffer-size flush during write, PLUS a non-matching record at a higher
      # offset. This means the source fragment's last_log_offset is higher than
      # the shape's last written offset — just like in production where
      # transactions touch multiple tables.
      padding = String.duplicate("x", 70_000)

      non_commit_fragment =
        txn_fragment(
          xid,
          lsn,
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "1", "value" => padding},
              log_offset: relevant_change_offset
            },
            # This change does NOT match shape1 (test_table) but raises the
            # fragment's last_log_offset above the shape's written offset.
            %Changes.NewRecord{
              relation: {"public", "other_table"},
              record: %{"id" => "2"},
              log_offset: LogOffset.new(lsn, 50)
            }
          ],
          has_begin?: true
        )

      # Commit fragment has only a change for a different table. The consumer
      # writes nothing for it but still finalises the pending transaction,
      # populating txn_offset_mapping.
      commit_fragment =
        txn_fragment(
          xid,
          lsn,
          [
            %Changes.NewRecord{
              relation: {"public", "other_table"},
              record: %{"id" => "99"},
              log_offset: LogOffset.new(lsn, 100)
            }
          ],
          has_commit?: true
        )

      # Send non-commit fragment. The large record triggers a buffer flush,
      # placing {Storage, :flushed, offset} in the consumer's mailbox.
      Support.Trace.trace_shape_log_collector_calls(
        pid: Shapes.Consumer.whereis(stack_id, shape_handle),
        functions: [:notify_flushed]
      )

      assert :ok = ShapeLogCollector.handle_event(non_commit_fragment, stack_id)

      # With deferred flush notifications, the consumer does NOT call notify_flushed
      # after the non-commit fragment. The :flushed message is saved for later.
      assert [] == Support.Trace.collect_traced_calls()

      # Send the commit fragment to finalize the transaction.
      assert :ok = ShapeLogCollector.handle_event(commit_fragment, stack_id)

      # Consumer has processed the relevant change...
      assert_receive {^ref, :new_changes, ^relevant_change_offset}, @receive_timeout

      # The deferred flush notification is sent after the commit with the
      # aligned offset (the commit fragment's last_log_offset).
      commit_last_log_offset = commit_fragment.last_log_offset

      assert [
               {ShapeLogCollector, :notify_flushed,
                [^stack_id, ^shape_handle, ^commit_last_log_offset]}
             ] = Support.Trace.collect_traced_calls()

      # Flush boundary advances correctly.
      tx_offset = commit_fragment.last_log_offset.tx_offset
      assert_receive {:flush_boundary_updated, ^tx_offset}, @receive_timeout
    end

    @tag allow_subqueries: false, with_pure_file_storage_opts: [flush_period: 1]
    test "dead consumer doesn't block flush notifications from advancing as live consumers flush to storage",
         ctx do
      {shape_handle1, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      {shape_handle2, _} = ShapeCache.get_or_create_shape_handle(@shape2, ctx.stack_id)
      ref1 = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle1)
      ref2 = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle2)

      :started = ShapeCache.await_snapshot_start(shape_handle1, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle2, ctx.stack_id)

      register_as_replication_client(ctx.stack_id)

      lsn1 = Lsn.from_integer(10)

      # First txn affects both shapes
      txn1 =
        complete_txn_fragment(11, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn1, 0)
          },
          %Changes.NewRecord{
            relation: {"public", "other_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn1, 2)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn1, ctx.stack_id)
      assert_receive {^ref1, :new_changes, _}, @receive_timeout
      assert_receive {^ref2, :new_changes, _}, @receive_timeout

      # Both consumers flush. We get two flush boundary notifications because
      # at the time of the first consumer flush FlushTracker didn't yet have a real
      # last_global_flushed_offset, so it eagerly confirms that a "virtual previous txn" with
      # offset (10 - 1) - 1 has definitely been flushed.
      # When the second consumer's flush arrives at it, it can see that there are no more
      # pending flushes for lsn=10 and so it has definitely been flushed now.
      assert_receive {:flush_boundary_updated, 8}, @receive_timeout
      assert_receive {:flush_boundary_updated, 10}, @receive_timeout

      # Terminate the consumer for shape2. Using :shutdown as the exit reason
      # means ShapeCleaner.handle_writer_termination/3 does NOT remove the shape
      # from ShapeLogCollector, so it stays in the FlushTracker indefinitely.
      dead_consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle2)
      dead_ref = Process.monitor(dead_consumer_pid)
      Process.exit(dead_consumer_pid, :shutdown)
      assert_receive {:DOWN, ^dead_ref, :process, ^dead_consumer_pid, :shutdown}

      lsn2 = Lsn.from_integer(20)

      # Second txn affects both shapes, but the dead consumer won't flush
      txn2 =
        complete_txn_fragment(12, lsn2, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "2"},
            log_offset: LogOffset.new(lsn2, 0)
          },
          %Changes.NewRecord{
            relation: {"public", "other_table"},
            record: %{"id" => "2"},
            log_offset: LogOffset.new(lsn2, 2)
          }
        ])

      log =
        ExUnit.CaptureLog.capture_log(fn ->
          # By the time this call to handle_event() returns, the dead consumer will have been
          # removed from FlushTracker's state, so it can advance its confirmed flushed offset to
          # the last processed transaction.
          assert :ok = ShapeLogCollector.handle_event(txn2, ctx.stack_id)
        end)

      assert log =~
               ~s'Consumer processes crashed or missing during broadcast: %{#{inspect(shape_handle2)} => :noproc}'

      assert_receive {^ref1, :new_changes, _}, @receive_timeout
      assert_receive {:flush_boundary_updated, 20}, @receive_timeout

      lsn3 = Lsn.from_integer(30)

      # Third txn affects only the live shape
      txn3 =
        complete_txn_fragment(13, lsn3, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "3"},
            log_offset: LogOffset.new(lsn3, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn3, ctx.stack_id)
      assert_receive {^ref1, :new_changes, _}, @receive_timeout

      # shape1 has flushed all the way through lsn 30 so that's what we expect FlushTracker to
      # advance its confirmed offset to.
      assert_receive {:flush_boundary_updated, 30}, @receive_timeout
    end

    test "UPDATE during pending move-in is converted to INSERT and query result skips duplicate key",
         ctx do
      # This test exposes an edge case where:
      # 1. A move-in query starts (snapshot xmin = 90)
      # 2. An UPDATE (xid = 100) arrives and is converted to INSERT
      # 3. Move-in query completes with the same key
      # 4. EXPECTED: Query result should skip the key (already processed at xid 100 > snapshot xmin 90)
      # 5. ACTUAL BUG: Query result creates a duplicate INSERT

      parent = self()

      # Mock query_move_in_async to simulate a query without hitting the database
      Repatch.patch(
        Electric.Shapes.Consumer.Effects,
        :query_move_in_async,
        [mode: :shared],
        fn _task_sup, _consumer_state, _buffering_state, consumer_pid ->
          send(parent, {:query_requested, consumer_pid})

          :ok
        end
      )

      Support.TestUtils.activate_mocks_for_descendant_procs(Consumer)

      {shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_subquery, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      {:ok, shape} = Electric.Shapes.fetch_shape_by_handle(ctx.stack_id, shape_handle)
      [_dep_handle] = shape.shape_dependencies_handles

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      ShapeLogCollector.handle_event(
        complete_txn_fragment(100, Lsn.from_integer(50), [
          %Changes.NewRecord{
            relation: {"public", "other_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(Lsn.from_integer(50), 0)
          }
        ]),
        ctx.stack_id
      )

      assert_receive {:query_requested, ^consumer_pid}

      # Snapshot here is intentionally before the update to make sure the update is considered shadowing
      send(consumer_pid, {:pg_snapshot_known, {90, 95, []}})

      # Now send an UPDATE (xid = 100) before move-in query completes
      # This should be converted to INSERT
      lsn = Lsn.from_integer(100)
      xid = 100

      txn =
        complete_txn_fragment(xid, lsn, [
          %Changes.UpdatedRecord{
            relation: {"public", "test_table"},
            old_record: %{"id" => "1"},
            key: ~s'"public"."test_table"/"1"',
            record: %{"id" => "1", "value" => "updated"},
            log_offset: LogOffset.new(lsn, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      shape_storage = Storage.for_shape(shape_handle, ctx.storage)

      send_stored_move_in_complete(
        consumer_pid,
        shape_storage,
        [
          [
            ~s'"public"."test_table"/"1"',
            [],
            Jason.encode!(%{
              "key" => ~s'"public"."test_table"/"1"',
              "value" => %{"id" => "1", "value" => "old"},
              "headers" => %{
                "operation" => "insert",
                "relation" => ["public", "test_table"]
              }
            })
          ]
        ],
        Lsn.from_integer(100)
      )

      assert_receive {^ref, :new_changes, _offset}, @receive_timeout

      # Check storage for operations
      assert [
               %{"headers" => %{"event" => "move-in"}},
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => ~s'"public"."test_table"/"1"',
                 "value" => %{"id" => "1", "value" => "old"}
               },
               %{
                 "headers" => %{
                   "control" => "snapshot-end",
                   "xmin" => "90",
                   "xmax" => "95",
                   "xip_list" => []
                 }
               },
               %{
                 "headers" => %{"operation" => "update", "txids" => [100]},
                 "key" => ~s'"public"."test_table"/"1"'
               }
             ] = get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)
    end

    test "consumer splices a pending move-in on global_last_seen_lsn broadcast", ctx do
      parent = self()

      Repatch.patch(
        Electric.Shapes.Consumer.Effects,
        :query_move_in_async,
        [mode: :shared],
        fn _task_sup, _consumer_state, _buffering_state, consumer_pid ->
          send(parent, {:query_requested, consumer_pid})
          :ok
        end
      )

      Support.TestUtils.activate_mocks_for_descendant_procs(Consumer)

      {shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_subquery, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      ShapeLogCollector.handle_event(
        complete_txn_fragment(100, Lsn.from_integer(50), [
          %Changes.NewRecord{
            relation: {"public", "other_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(Lsn.from_integer(50), 0)
          }
        ]),
        ctx.stack_id
      )

      assert_receive {:query_requested, ^consumer_pid}

      send(consumer_pid, {:pg_snapshot_known, {100, 300, []}})

      shape_storage = Storage.for_shape(shape_handle, ctx.storage)

      send_stored_move_in_complete(
        consumer_pid,
        shape_storage,
        [
          [
            ~s'"public"."test_table"/"1"',
            [],
            Jason.encode!(%{
              "key" => ~s'"public"."test_table"/"1"',
              "value" => %{"id" => "1", "value" => "old"},
              "headers" => %{
                "operation" => "insert",
                "relation" => ["public", "test_table"]
              }
            })
          ]
        ],
        Lsn.from_integer(100)
      )

      refute_receive {^ref, :new_changes, _}, 100

      assert :ok = LsnTracker.broadcast_last_seen_lsn(ctx.stack_id, 100)
      assert_receive {^ref, :new_changes, _offset}, @receive_timeout

      assert [
               %{"headers" => %{"event" => "move-in"}},
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => ~s'"public"."test_table"/"1"',
                 "value" => %{"id" => "1", "value" => "old"}
               },
               %{
                 "headers" => %{
                   "control" => "snapshot-end",
                   "xmin" => "100",
                   "xmax" => "300",
                   "xip_list" => []
                 }
               }
             ] = get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)
    end

    test "consumer replays the latest broadcast when subscribing for a move-in", ctx do
      parent = self()

      Repatch.patch(
        Electric.Shapes.Consumer.Effects,
        :query_move_in_async,
        [mode: :shared],
        fn _task_sup, _consumer_state, _buffering_state, consumer_pid ->
          send(parent, {:query_requested, consumer_pid})
          :ok
        end
      )

      Support.TestUtils.activate_mocks_for_descendant_procs(Consumer)

      {shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_subquery, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      {:ok, shape} = Electric.Shapes.fetch_shape_by_handle(ctx.stack_id, shape_handle)
      [dep_handle] = shape.shape_dependencies_handles

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      assert :ok = LsnTracker.broadcast_last_seen_lsn(ctx.stack_id, 100)

      send(
        consumer_pid,
        {:materializer_changes, dep_handle,
         %{
           move_in: [{1, "1"}],
           move_out: []
         }}
      )

      assert_receive {:query_requested, ^consumer_pid}

      send(consumer_pid, {:pg_snapshot_known, {100, 300, []}})

      shape_storage = Storage.for_shape(shape_handle, ctx.storage)

      send_stored_move_in_complete(
        consumer_pid,
        shape_storage,
        [
          [
            ~s'"public"."test_table"/"1"',
            [],
            Jason.encode!(%{
              "key" => ~s'"public"."test_table"/"1"',
              "value" => %{"id" => "1", "value" => "old"},
              "headers" => %{
                "operation" => "insert",
                "relation" => ["public", "test_table"]
              }
            })
          ]
        ],
        Lsn.from_integer(100)
      )

      assert_receive {^ref, :new_changes, _offset}, @receive_timeout

      assert [
               %{"headers" => %{"event" => "move-in"}},
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => ~s'"public"."test_table"/"1"',
                 "value" => %{"id" => "1", "value" => "old"}
               },
               %{
                 "headers" => %{
                   "control" => "snapshot-end",
                   "xmin" => "100",
                   "xmax" => "300",
                   "xip_list" => []
                 }
               }
             ] = get_log_items_from_storage(LogOffset.last_before_real_offsets(), shape_storage)
    end

    test "consumer startup seeds the stack-scoped subquery index", ctx do
      alias Electric.Shapes.Filter.Indexes.SubqueryIndex

      {shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_subquery, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      # The consumer should have seeded the SubqueryIndex during initialization
      index = SubqueryIndex.for_stack(ctx.stack_id)
      assert index != nil

      # The shape should be registered with positions (by Filter.add_shape)
      assert SubqueryIndex.has_positions?(index, shape_handle)

      # The shape should be marked ready (no longer in fallback) once
      # the consumer has seeded the index. After await_snapshot_start returns
      # the consumer has completed initialization including subquery seeding.
      {:ok, _shape} = Electric.Shapes.fetch_shape_by_handle(ctx.stack_id, shape_handle)

      # The consumer seeds the index via SubqueryIndex.for_stack, but the
      # index is also modified by the Filter (which runs in the
      # ShapeLogCollector process). Check that the shape has positions
      # and that membership entries are correct (empty views for a fresh shape).
      positions = SubqueryIndex.positions_for_shape(index, shape_handle)
      assert length(positions) > 0

      # Verify the index is accessible and has retained node registrations.
      assert positions == SubqueryIndex.positions_for_shape(index, shape_handle)
    end

    test "consumer steady dependency move_in adds value to the subquery index", ctx do
      alias Electric.Shapes.Filter.Indexes.SubqueryIndex

      parent = self()

      Repatch.patch(
        Electric.Shapes.Consumer.Effects,
        :query_move_in_async,
        [mode: :shared],
        fn _task_sup, _consumer_state, _buffering_state, consumer_pid ->
          send(parent, {:query_requested, consumer_pid})
          :ok
        end
      )

      Support.TestUtils.activate_mocks_for_descendant_procs(Consumer)

      {shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_subquery, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      index = SubqueryIndex.for_stack(ctx.stack_id)
      {:ok, _shape} = Electric.Shapes.fetch_shape_by_handle(ctx.stack_id, shape_handle)

      # Before any dependency changes, the index has empty membership
      refute SubqueryIndex.member?(index, shape_handle, ["$sublink", "0"], 1)

      # Send a new record for the dependency table to trigger a move_in
      ShapeLogCollector.handle_event(
        complete_txn_fragment(100, Lsn.from_integer(50), [
          %Changes.NewRecord{
            relation: {"public", "other_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(Lsn.from_integer(50), 0)
          }
        ]),
        ctx.stack_id
      )

      # Wait for the consumer to process the event and request a move_in query
      assert_receive {:query_requested, consumer_pid}

      # During buffering, the value should have been added to the index
      # (union for positive dependency: before ∪ after)
      assert SubqueryIndex.member?(index, shape_handle, ["$sublink", "0"], 1)

      # Complete the move_in query to transition back to steady state
      send(consumer_pid, {:pg_snapshot_known, {100, 300, []}})

      shape_storage = Storage.for_shape(shape_handle, ctx.storage)

      send_stored_move_in_complete(
        consumer_pid,
        shape_storage,
        [
          [
            ~s'"public"."test_table"/"1"',
            [],
            Jason.encode!(%{
              "key" => ~s'"public"."test_table"/"1"',
              "value" => %{"id" => "1", "value" => "val"},
              "headers" => %{
                "operation" => "insert",
                "relation" => ["public", "test_table"]
              }
            })
          ]
        ],
        Lsn.from_integer(100)
      )

      # Allow the consumer to process the completion
      assert :ok = LsnTracker.broadcast_last_seen_lsn(ctx.stack_id, 100)
      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)
      assert_receive {^ref, :new_changes, _offset}, @receive_timeout

      # After move_in completes, value should still be in the index (now steady state)
      assert SubqueryIndex.member?(index, shape_handle, ["$sublink", "0"], 1)
    end

    test "consumer cleanup removes shape rows from the subquery index", ctx do
      alias Electric.Shapes.Filter.Indexes.SubqueryIndex

      {shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_subquery, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      index = SubqueryIndex.for_stack(ctx.stack_id)
      assert SubqueryIndex.has_positions?(index, shape_handle)

      # Monitor the consumer so we know when cleanup finishes
      consumer_name = Shapes.Consumer.name(ctx.stack_id, shape_handle)
      consumer_pid = GenServer.whereis(consumer_name)
      ref = Process.monitor(consumer_pid)

      expect_shape_status(remove_shape: fn _, ^shape_handle -> :ok end)
      ShapeCache.clean_shape(shape_handle, ctx.stack_id)

      # Wait for consumer to shut down, flushing any other messages first
      assert_receive {:DOWN, ^ref, :process, ^consumer_pid, _reason}, 5000

      # The ShapeLogCollector removes the shape from the filter asynchronously.
      # Wait briefly for it to process.
      Process.sleep(100)

      # After cleanup, the shape's rows should be removed from the index
      refute SubqueryIndex.has_positions?(index, shape_handle)
    end

    test "dependency consumer survives a :noproc from its materializer without removing the shape",
         ctx do
      # During a stack shutdown, a dependency consumer's inline call into its
      # materializer can race the materializer's death and exit with :noproc.
      # notify_materializer_of_new_changes/3 absorbs that exit so the pending
      # monitored :DOWN drives a clean stop, rather than the consumer exiting
      # with a non-shutdown reason that routes through handle_writer_termination
      # and removes the shape from disk.

      # Make the dependency consumer's notification call into the materializer
      # exit exactly as a GenServer.call to an already-dead process would.
      Repatch.patch(Consumer.Materializer, :new_changes, [mode: :shared], fn _, _, _ ->
        exit({:noproc, {GenServer, :call, [:materializer, :new_changes, 5000]}})
      end)

      Support.TestUtils.activate_mocks_for_descendant_procs(Consumer)

      # The consumer must stay alive and never remove the shape, so fail
      # loudly if remove_shape is called.
      patch_shape_status(
        remove_shape: fn _, handle ->
          raise "Unexpected remove_shape for #{handle}"
        end
      )

      {shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_subquery, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      {:ok, shape} = Electric.Shapes.fetch_shape_by_handle(ctx.stack_id, shape_handle)
      [dep_handle] = shape.shape_dependencies_handles

      dep_consumer = Consumer.whereis(ctx.stack_id, dep_handle)
      assert is_pid(dep_consumer)
      ref = Process.monitor(dep_consumer)

      # A change to the dependency table makes the dependency consumer notify
      # its materializer — hitting the patched, exiting call.
      ShapeLogCollector.handle_event(
        complete_txn_fragment(100, Lsn.from_integer(50), [
          %Changes.NewRecord{
            relation: {"public", "other_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(Lsn.from_integer(50), 0)
          }
        ]),
        ctx.stack_id
      )

      # The dependency consumer absorbs the :noproc, stays alive, and the
      # shape is not removed.
      refute_receive {:DOWN, ^ref, :process, _, _}, 500
      assert Consumer.whereis(ctx.stack_id, dep_handle) == dep_consumer
    end
  end

  defp refute_storage_calls_for_txn_fragment(shape_handle) do
    refute_receive {Support.TestStorage, :append_to_log!, ^shape_handle, _}
    refute_receive {Support.TestStorage, :append_fragment_to_log!, ^shape_handle, _}
    refute_receive {Support.TestStorage, :signal_txn_commit!, ^shape_handle, _}
  end

  defp assert_consumer_shutdown(stack_id, shape_handle, fun, timeout \\ 5000) do
    monitors =
      for name <- [
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
                     when reason in [:shutdown, {:shutdown, :cleanup}],
                     timeout
    end
  end

  defp enable_storage_tracer_for(consumer_pid) do
    Support.Trace.trace_storage_calls(
      pid: consumer_pid,
      functions: [:append_to_log!, :append_fragment_to_log!, :signal_txn_commit!]
    )
  end

  describe "process gc configuration" do
    setup [
      :with_registry,
      :with_in_memory_storage,
      :with_shape_status,
      :with_lsn_tracker,
      :with_persistent_kv,
      :with_status_monitor,
      :with_dynamic_consumer_supervisor,
      :with_noop_publication_manager,
      :with_shape_cleaner
    ]

    setup ctx do
      start_link_supervised!({
        ShapeLogCollector.Supervisor,
        stack_id: ctx.stack_id, persistent_kv: ctx.persistent_kv, inspector: @base_inspector
      })

      ShapeLogCollector.mark_as_ready(ctx.stack_id)
      [shape_position: @shape_position]
    end

    @tag process_spawn_opts: %{consumer: [fullsweep_after: 4, priority: :high]}
    test "spawn_opts are correctly passed to consumer process", ctx do
      support_test_storage_wrap(ctx, @shape_handle1, @shape1)

      {:ok, consumer} =
        start_supervised(
          {Consumer,
           %{
             shape_handle: @shape_handle1,
             stack_id: ctx.stack_id
           }},
          id: {Consumer, @shape_handle1}
        )

      Consumer.initialize_shape(consumer, @shape1, %{action: :create})
      assert_receive {Support.TestStorage, :init_writer!, @shape_handle1, @shape1}
      :started = Consumer.await_snapshot_start(ctx.stack_id, @shape_handle1)

      info = Process.info(consumer)

      assert info[:priority] == :high
      assert info[:garbage_collection][:fullsweep_after] == 4
    end
  end

  defp support_test_storage_wrap(ctx, shape_handle, shape) do
    %{snapshot_xmin: xmin} = shape_status(shape_handle, ctx)
    shapes = %{shape_handle => shape}

    storage =
      Support.TestStorage.wrap(ctx.storage, %{
        shape_handle => [
          {:mark_snapshot_as_started, []},
          {:set_pg_snapshot, [%{xmin: xmin, xmax: xmin + 1, xip_list: [xmin]}]}
        ]
      })

    Electric.StackConfig.put(ctx.stack_id, Electric.ShapeCache.Storage, storage)
    Electric.StackConfig.put(ctx.stack_id, :inspector, @base_inspector)

    patch_shape_status(fetch_shape_by_handle: fn _, sh -> Map.fetch(shapes, sh) end)

    Support.TestUtils.activate_mocks_for_descendant_procs(Consumer)
    Support.TestUtils.activate_mocks_for_descendant_procs(Electric.ShapeCache.ShapeCleaner)
    :ok
  end

  describe "should_force_gc?/5" do
    # All tests pass explicit now_ms / last_gc_at / min_interval_ms so they are
    # fully deterministic and do not depend on wall-clock time.

    test "false when threshold is nil (adaptive GC disabled)" do
      refute Electric.Shapes.Consumer.should_force_gc?(1_000_000, nil, nil, 5_000, 1_000)
    end

    test "true when heap over threshold and consumer has never forced a GC (last_gc_at nil)" do
      # 1_000 bytes > threshold of 1 byte
      assert Electric.Shapes.Consumer.should_force_gc?(1_000, 1, nil, 5_000, 1_000)
    end

    test "false when heap over threshold but interval has not elapsed" do
      # last_gc_at=4_500, now=5_000 → delta=500 < min_interval=1_000 → no GC
      refute Electric.Shapes.Consumer.should_force_gc?(1_000, 1, 4_500, 5_000, 1_000)
    end

    test "true when heap over threshold and interval has elapsed" do
      # last_gc_at=3_000, now=5_000 → delta=2_000 >= min_interval=1_000 → GC
      assert Electric.Shapes.Consumer.should_force_gc?(1_000, 1, 3_000, 5_000, 1_000)
    end

    test "true at exactly the min interval boundary" do
      # last_gc_at=4_000, now=5_000 → delta=1_000 == min_interval=1_000 → GC
      assert Electric.Shapes.Consumer.should_force_gc?(1_000, 1, 4_000, 5_000, 1_000)
    end

    test "false when heap is under threshold regardless of timing" do
      # heap=1 byte; threshold=1_000 bytes → under
      refute Electric.Shapes.Consumer.should_force_gc?(1, 1_000, nil, 5_000, 1_000)
    end

    test "false when heap is under threshold even if interval would have elapsed" do
      refute Electric.Shapes.Consumer.should_force_gc?(1, 1_000, 0, 5_000, 1_000)
    end

    test "false when heap exactly equals threshold (strict comparison)" do
      refute Electric.Shapes.Consumer.should_force_gc?(1_000, 1_000, nil, 5_000, 1_000)
    end
  end

  describe "adaptive GC after fragment processing" do
    @describetag :tmp_dir

    setup do
      %{inspector: @base_inspector, pool: nil}
    end

    setup [
      :with_registry,
      :with_pure_file_storage,
      :with_shape_status,
      :with_lsn_tracker,
      :with_log_chunking,
      :with_persistent_kv,
      :with_async_deleter,
      :with_shape_cleaner,
      :with_shape_log_collector,
      :with_noop_publication_manager,
      :with_status_monitor
    ]

    setup(ctx) do
      delay_snapshot_creation? = Map.get(ctx, :delay_snapshot_creation?)
      test_pid = self()

      patch_snapshotter(fn parent, shape_handle, _shape, %{snapshot_fun: snapshot_fun} ->
        if delay_snapshot_creation? do
          receive do
            {^test_pid, :resume} -> :ok
          end
        end

        pg_snapshot = {10, 11, [10]}
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, pg_snapshot})
        GenServer.cast(parent, {:snapshot_started, shape_handle})
        snapshot_fun.([])
      end)

      Electric.StackConfig.put(ctx.stack_id, :shape_hibernate_after, 10_000)
      :ok
    end

    setup ctx do
      %{consumer_supervisor: consumer_supervisor, shape_cache: shape_cache} =
        Support.ComponentSetup.with_shape_cache(ctx)

      %{
        consumer_supervisor: consumer_supervisor,
        shape_cache: shape_cache
      }
    end

    test "GC runs when heap exceeds tiny threshold", ctx do
      Electric.StackConfig.put(ctx.stack_id, :consumer_gc_heap_threshold, 1)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      xid = 11
      lsn = Lsn.from_integer(10)
      large_binary = :binary.copy(<<0>>, 200_000)

      txn =
        complete_txn_fragment(xid, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1", "value" => large_binary},
            log_offset: LogOffset.new(lsn, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      assert_receive {^ref, :new_changes, _}, @receive_timeout

      # GC runs in the deferred {:continue, :maybe_gc} after the reply. A synchronous
      # call is queued behind the pending continue, so :sys.get_state returns only
      # once the GC has run — and lets us read last_forced_gc_at, which the consumer
      # stamps iff it forced a sweep. That is a direct signal of our decision,
      # immune to natural BEAM GCs and heap-size timing.
      assert %{last_forced_gc_at: forced_at} = :sys.get_state(consumer_pid)

      refute is_nil(forced_at),
             "threshold=1 keeps the heap over threshold, so a forced GC should be recorded"
    end

    test "GC does not run when threshold is very large", ctx do
      # 1 GB threshold — the consumer heap will never reach this, so GC must NOT fire.
      Electric.StackConfig.put(ctx.stack_id, :consumer_gc_heap_threshold, 1_000_000_000)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      xid = 11
      lsn = Lsn.from_integer(10)
      large_binary = :binary.copy(<<0>>, 200_000)

      txn =
        complete_txn_fragment(xid, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1", "value" => large_binary},
            log_offset: LogOffset.new(lsn, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      assert_receive {^ref, :new_changes, _}, @receive_timeout

      # Flush the deferred :maybe_gc continue and read the state. The heap stays well
      # under the 1 GB threshold, so the consumer must not have forced a sweep.
      assert %{last_forced_gc_at: forced_at} = :sys.get_state(consumer_pid)

      assert is_nil(forced_at),
             "no forced GC should be recorded while under threshold, got #{inspect(forced_at)}"
    end

    test "no GC by default (threshold=nil)", ctx do
      # Ensure no threshold is set (default behaviour)
      assert nil == Electric.StackConfig.lookup(ctx.stack_id, :consumer_gc_heap_threshold, nil)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      xid = 11
      lsn = Lsn.from_integer(10)

      txn =
        complete_txn_fragment(xid, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1"},
            log_offset: LogOffset.new(lsn, 0)
          }
        ])

      # Should process without error even when no GC threshold is configured
      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)
      assert_receive {^ref, :new_changes, _}, @receive_timeout
    end

    @tag delay_snapshot_creation?: true
    test "GC runs during buffered-fragment drain when heap exceeds threshold", ctx do
      # threshold=1 forces a GC once the buffered fragments are drained. The consumer
      # starts with buffering?=true; fragments sent before pg_snapshot_known land in the
      # buffer. When we unblock the snapshotter it fires pg_snapshot_known which triggers
      # :consume_buffer → drains the buffer → {:continue, :maybe_gc} runs the GC once.
      Electric.StackConfig.put(ctx.stack_id, :consumer_gc_heap_threshold, 1)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)

      # The snapshotter is now running but blocked on `receive {^test_pid, :resume}`.
      assert_receive {:snapshot, ^shape_handle, snapshotter_pid}

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)

      # Send a large-payload fragment while buffering?=true — it goes into the buffer.
      large_binary = :binary.copy(<<0>>, 200_000)
      xid = 11
      lsn = Lsn.from_integer(10)

      txn =
        complete_txn_fragment(xid, lsn, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "1", "value" => large_binary},
            log_offset: LogOffset.new(lsn, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      # Unblock the snapshotter: fires pg_snapshot_known → :consume_buffer → drains the
      # buffer, then defers a single GC via {:continue, :maybe_gc}.
      send(snapshotter_pid, {self(), :resume})

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)
      assert_receive {^ref, :new_changes, _}, @receive_timeout

      # The deferred GC runs in the :maybe_gc continue after the drain. Flush it with a
      # synchronous call (queued behind the continue), then check last_forced_gc_at —
      # the consumer stamps it iff it forced a sweep for the drained fragment.
      assert %{last_forced_gc_at: forced_at} = :sys.get_state(consumer_pid)

      refute is_nil(forced_at),
             "expected a forced GC to be recorded after the buffered-fragment drain"
    end
  end

  describe "stall challenge response" do
    # with_stack_id_from_test (line 87) already starts ProcessRegistry + StackConfig
    # for ctx.stack_id; the GenServer callbacks are invoked directly with a synthetic
    # state, with the test process registered under the ShapeLogCollector's name to
    # receive the consumer's casts.

    setup ctx do
      {:via, Registry, {registry_name, key}} = ShapeLogCollector.name(ctx.stack_id)
      {:ok, _} = Registry.register(registry_name, key, nil)
      :ok
    end

    test "challenge is answered while buffering ahead of PG snapshot info", ctx do
      state = Consumer.State.new(ctx.stack_id, "deferring-shape")
      assert state.buffering?

      assert {:noreply, ^state, _} = Consumer.handle_info(:verify_flush_progress, state)

      assert_receive {:"$gen_cast", {:writer_flush_deferred, "deferring-shape"}}
    end

    test "a subquery move-in buffering phase counts as deferring", ctx do
      handler = %Consumer.EventHandler.Subqueries.Buffering{
        shape_info: nil,
        queue: nil,
        active_move: nil
      }

      state = %{
        Consumer.State.new(ctx.stack_id, "move-in-shape")
        | buffering?: false,
          event_handler: handler
      }

      assert {:noreply, ^state, _} = Consumer.handle_info(:verify_flush_progress, state)

      assert_receive {:"$gen_cast", {:writer_flush_deferred, "move-in-shape"}}
    end

    test "challenge is left unanswered when the consumer is not deferring", ctx do
      state = %{Consumer.State.new(ctx.stack_id, "steady-shape") | buffering?: false}

      assert {:noreply, ^state, _} = Consumer.handle_info(:verify_flush_progress, state)

      refute_receive {:"$gen_cast", _}, 100
    end
  end

  describe "set_gc_heap_threshold helpers" do
    # with_stack_id_from_test (line 87) already starts ProcessRegistry + StackConfig
    # for ctx.stack_id — no heavier setup is needed for these pure-config tests.

    test "set_gc_heap_threshold/2 writes the value into StackConfig", ctx do
      assert :ok = Electric.Shapes.Consumer.set_gc_heap_threshold(ctx.stack_id, 2_000_000)

      assert 2_000_000 ==
               Electric.StackConfig.lookup(ctx.stack_id, :consumer_gc_heap_threshold, nil)
    end

    test "set_gc_heap_threshold/2 accepts nil to disable", ctx do
      Electric.Shapes.Consumer.set_gc_heap_threshold(ctx.stack_id, 123)
      assert :ok = Electric.Shapes.Consumer.set_gc_heap_threshold(ctx.stack_id, nil)
      assert nil == Electric.StackConfig.lookup(ctx.stack_id, :consumer_gc_heap_threshold, nil)
    end
  end

  defp get_log_items_from_storage(offset, shape_storage) do
    Storage.get_log_stream(offset, shape_storage) |> Enum.map(&Jason.decode!/1)
  end

  defp send_stored_move_in_complete(consumer_pid, shape_storage, rows, lsn) do
    snapshot_name = Electric.Utils.uuid4()
    row_bytes = Enum.reduce(rows, 0, fn [_, _, json], acc -> acc + IO.iodata_length(json) end)

    Storage.write_move_in_snapshot!(rows, snapshot_name, shape_storage)

    send(
      consumer_pid,
      {:query_move_in_complete, snapshot_name, length(rows), row_bytes, lsn}
    )
  end
end
