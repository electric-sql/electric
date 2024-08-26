defmodule Electric.ShapeCacheTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog
  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Support.TestUtils

  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.{Relation, Column}
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes
  alias Electric.Shapes.Shape

  alias Support.StubInspector

  @moduletag :capture_log

  @shape %Shape{
    root_table: {"public", "items"},
    table_info: %{
      {"public", "items"} => %{
        columns: [%{name: "id", type: :text}, %{name: "value", type: :text}],
        pk: ["id"]
      }
    }
  }
  @lsn Electric.Postgres.Lsn.from_integer(13)
  @change_offset LogOffset.new(@lsn, 2)
  @xid 99
  @changes [
    Changes.fill_key(
      %Changes.NewRecord{
        relation: {"public", "items"},
        record: %{"id" => "123", "value" => "Test"},
        log_offset: @change_offset
      },
      ["id"]
    )
  ]

  @zero_offset LogOffset.first()

  @prepare_tables_noop {__MODULE__, :prepare_tables_noop, []}

  describe "get_or_create_shape_id/2" do
    setup [
      :with_in_memory_storage,
      :with_persistent_kv,
      :with_no_pool,
      :with_registry,
      :with_transaction_producer
    ]

    setup ctx do
      with_shape_cache(ctx,
        create_snapshot_fn: fn _, _, _, _, _ -> nil end,
        prepare_tables_fn: @prepare_tables_noop
      )
    end

    test "creates a new shape_id", %{shape_cache_opts: opts} do
      {shape_id, @zero_offset} = ShapeCache.get_or_create_shape_id(@shape, opts)
      assert is_binary(shape_id)
    end

    test "returns existing shape_id", %{shape_cache_opts: opts} do
      {shape_id1, @zero_offset} = ShapeCache.get_or_create_shape_id(@shape, opts)
      {shape_id2, @zero_offset} = ShapeCache.get_or_create_shape_id(@shape, opts)
      assert shape_id1 == shape_id2
    end
  end

  describe "get_or_create_shape_id/2 shape initialization" do
    setup [
      :with_in_memory_storage,
      :with_persistent_kv,
      :with_registry,
      :with_transaction_producer
    ]

    test "creates initial snapshot if one doesn't exist", %{storage: storage} = ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!(shape_id, [["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {shape_id, offset} = ShapeCache.get_or_create_shape_id(@shape, opts)
      assert offset == @zero_offset
      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)
      Process.sleep(100)
      assert Storage.snapshot_started?(shape_id, storage)
    end

    test "triggers table prep and snapshot creation only once", ctx do
      test_pid = self()

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: fn nil, [{"public", "items"}] ->
            send(test_pid, {:called, :prepare_tables_fn})
          end,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            send(test_pid, {:called, :create_snapshot_fn})
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!(shape_id, [["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)

      # subsequent calls return the same shape_id
      for _ <- 1..10, do: assert({^shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts))

      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)

      assert_received {:called, :prepare_tables_fn}
      assert_received {:called, :create_snapshot_fn}
      refute_received {:called, _}
    end

    test "triggers table prep and snapshot creation only once even with queued requests", ctx do
      test_pid = self()

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            send(test_pid, {:called, :create_snapshot_fn})
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!(shape_id, [["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      link_pid = Process.whereis(opts[:server])

      # suspend the genserver to simulate message queue buildup
      :sys.suspend(link_pid)

      create_call_1 =
        Task.async(fn ->
          {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
          shape_id
        end)

      create_call_2 =
        Task.async(fn ->
          {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
          shape_id
        end)

      # resume the genserver and assert both queued tasks return the same shape_id
      :sys.resume(link_pid)
      shape_id = Task.await(create_call_1)
      assert shape_id == Task.await(create_call_2)

      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)

      # any queued calls should still return the existing shape_id
      # after the snapshot has been created (simulated by directly
      # calling GenServer)
      assert {^shape_id, _} =
               GenServer.call(link_pid, {:create_or_wait_shape_id, @shape})

      assert_received {:called, :create_snapshot_fn}
    end

    test "no-ops and warns if snapshot xmin is assigned to unknown shape_id", ctx do
      shape_id = "foo"

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil), prepare_tables_fn: @prepare_tables_noop)

      shape_meta_table = Access.get(opts, :shape_meta_table)

      log =
        capture_log(fn ->
          GenServer.cast(Process.whereis(opts[:server]), {:snapshot_xmin_known, shape_id, 10})
          Process.sleep(10)
        end)

      assert log =~
               "Got snapshot information for a #{shape_id}, that shape id is no longer valid. Ignoring."

      # should have nothing in the meta table
      assert :ets.next_lookup(shape_meta_table, :_) == :"$end_of_table"
    end
  end

  describe "get_or_create_shape_id/2 against real db" do
    setup [
      :with_in_memory_storage,
      :with_persistent_kv,
      :with_registry,
      :with_unique_db,
      :with_publication,
      :with_basic_tables,
      :with_inspector,
      :with_shape_log_collector,
      :with_shape_cache
    ]

    setup %{pool: pool} do
      Postgrex.query!(pool, "INSERT INTO items (id, value) VALUES ($1, $2), ($3, $4)", [
        Ecto.UUID.dump!("721ae036-e620-43ee-a3ed-1aa3bb98e661"),
        "test1",
        Ecto.UUID.dump!("721ae036-e620-43ee-a3ed-1aa3bb98e662"),
        "test2"
      ])

      :ok
    end

    test "creates initial snapshot from DB data", %{storage: storage, shape_cache_opts: opts} do
      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)
      assert {@zero_offset, stream} = Storage.get_snapshot(shape_id, storage)

      assert [%{"value" => %{"value" => "test1"}}, %{"value" => %{"value" => "test2"}}] =
               stream_to_list(stream)
    end

    # Set the DB's display settings to something else than Electric.Postgres.display_settings
    @tag database_settings: [
           "DateStyle='Postgres, DMY'",
           "TimeZone='CET'",
           "extra_float_digits=-1",
           "bytea_output='escape'",
           "IntervalStyle='postgres'"
         ]
    @tag additional_fields:
           "date DATE, timestamptz TIMESTAMPTZ, float FLOAT8, bytea BYTEA, interval INTERVAL"
    test "uses correct display settings when querying initial data", %{
      pool: pool,
      storage: storage,
      shape_cache_opts: opts
    } do
      shape =
        update_in(
          @shape.table_info[{"public", "items"}].columns,
          &(&1 ++
              [
                %{name: "date", type: :date},
                %{name: "timestamptz", type: :timestamptz},
                %{name: "float", type: :float8},
                %{name: "bytea", type: :bytea},
                %{name: "interval", type: :interval}
              ])
        )

      Postgrex.query!(
        pool,
        """
        INSERT INTO items (
          id, value, date, timestamptz, float, bytea, interval
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        )
        """,
        [
          Ecto.UUID.bingenerate(),
          "test value",
          ~D[2022-05-17],
          ~U[2022-01-12 00:01:00.00Z],
          1.234567890123456,
          <<0x5, 0x10, 0xFA>>,
          %Postgrex.Interval{
            days: 1,
            months: 0,
            # 12 hours, 59 minutes, 10 seconds
            secs: 46750,
            microsecs: 0
          }
        ]
      )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(shape, opts)
      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)
      assert {@zero_offset, stream} = Storage.get_snapshot(shape_id, storage)

      assert [
               %{"value" => map},
               %{"value" => %{"value" => "test1"}},
               %{"value" => %{"value" => "test2"}}
             ] =
               stream_to_list(stream)

      assert %{
               "date" => "2022-05-17",
               "timestamptz" => "2022-01-12 00:01:00+00",
               "float" => "1.234567890123456",
               "bytea" => "\\x0510fa",
               "interval" => "P1DT12H59M10S"
             } = map
    end

    test "updates latest offset correctly", %{shape_cache_opts: opts, storage: storage} do
      {shape_id, initial_offset} = ShapeCache.get_or_create_shape_id(@shape, opts)
      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)

      assert {^shape_id, offset_after_snapshot} =
               ShapeCache.get_or_create_shape_id(@shape, opts)

      expected_offset_after_log_entry =
        LogOffset.new(Electric.Postgres.Lsn.from_integer(1000), 0)

      :ok = ShapeCache.update_shape_latest_offset(shape_id, expected_offset_after_log_entry, opts)

      assert {^shape_id, offset_after_log_entry} = ShapeCache.get_or_create_shape_id(@shape, opts)

      assert initial_offset == @zero_offset
      assert initial_offset == offset_after_snapshot
      assert offset_after_log_entry > offset_after_snapshot
      assert offset_after_log_entry == expected_offset_after_log_entry

      # Stop snapshot process gracefully to prevent errors being logged in the test
      {_, stream} = Storage.get_snapshot(shape_id, storage)
      Stream.run(stream)
    end

    test "errors if appending to untracked shape_id", %{shape_cache_opts: opts} do
      shape_id = "foo"
      log_offset = LogOffset.new(1000, 0)

      {:error, log} =
        with_log(fn -> ShapeCache.update_shape_latest_offset(shape_id, log_offset, opts) end)

      assert log =~ "Tried to update latest offset for shape #{shape_id} which doesn't exist"
    end

    test "correctly propagates the error", %{shape_cache_opts: opts} do
      shape = %Shape{root_table: {"public", "nonexistent"}}

      {shape_id, log} =
        with_log(fn ->
          {shape_id, _} = ShapeCache.get_or_create_shape_id(shape, opts)

          assert {:error, %Postgrex.Error{postgres: %{code: :undefined_table}}} =
                   ShapeCache.await_snapshot_start(shape_id, opts)

          shape_id
        end)

      log =~ "Snapshot creation failed for #{shape_id}"

      log =~
        ~S|** (Postgrex.Error) ERROR 42P01 (undefined_table) relation "public.nonexistent" does not exist|
    end
  end

  describe "list_active_shapes/1" do
    setup [
      :with_in_memory_storage,
      :with_persistent_kv,
      :with_registry,
      :with_transaction_producer
    ]

    test "returns empty list initially", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil), prepare_tables_fn: @prepare_tables_noop)

      assert ShapeCache.list_active_shapes(opts) == []
    end

    test "lists the shape as active once there is a snapshot", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!(shape_id, [["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)
      assert [{^shape_id, @shape, 10}] = ShapeCache.list_active_shapes(opts)
    end

    test "doesn't list the shape as active until we know xmin", ctx do
      test_pid = self()

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            ref = make_ref()
            send(test_pid, {:waiting_point, ref, self()})
            receive(do: ({:continue, ^ref} -> :ok))
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!(shape_id, [["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)

      # Wait until we get to the waiting point in the snapshot
      assert_receive {:waiting_point, ref, pid}

      assert ShapeCache.list_active_shapes(opts) == []

      send(pid, {:continue, ref})

      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)
      assert [{^shape_id, @shape, 10}] = ShapeCache.list_active_shapes(opts)
    end
  end

  describe "has_shape?/2" do
    setup [
      :with_in_memory_storage,
      :with_persistent_kv,
      :with_registry,
      :with_transaction_producer
    ]

    test "returns true for known shape id", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _, _, _ ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 100})
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      refute ShapeCache.has_shape?("some-random-id", opts)
      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      assert ShapeCache.has_shape?(shape_id, opts)
    end

    test "works with slow snapshot generation", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _, _, _ ->
            Process.sleep(100)
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 100})
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      assert ShapeCache.has_shape?(shape_id, opts)
    end
  end

  describe "await_snapshot_start/4" do
    setup [
      :with_in_memory_storage,
      :with_persistent_kv,
      :with_registry,
      :with_transaction_producer
    ]

    test "returns :started for snapshots that have started", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _, _, _ ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 100})
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)

      assert ShapeCache.await_snapshot_start(shape_id, opts) == :started
    end

    test "returns an error if waiting is for an unknown shape id", ctx do
      shape_id = "orphaned_id"

      storage = Storage.for_shape(shape_id, ctx.storage)

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!(shape_id, [["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      assert {:error, :unknown} = ShapeCache.await_snapshot_start(shape_id, opts)

      refute Storage.snapshot_started?(shape_id, storage)
    end

    test "handles buffering multiple callers correctly", ctx do
      test_pid = self()

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            ref = make_ref()
            send(test_pid, {:waiting_point, ref, self()})
            receive(do: ({:continue, ^ref} -> :ok))
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})

            # Sometimes only some tasks subscribe before reaching this point, and then hang
            # if we don't actually have a snapshot. This is kind of part of the test, because
            # `await_snapshot_start/3` should always resolve to `:started` in concurrent situations
            GenServer.cast(parent, {:snapshot_started, shape_id})
            Storage.make_new_snapshot!(shape_id, [[1], [2]], storage)
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)

      storage = Storage.for_shape(shape_id, ctx.storage)

      tasks =
        for _id <- 1..10 do
          Task.async(fn ->
            assert :started = ShapeCache.await_snapshot_start(shape_id, opts)
            {_, stream} = Storage.get_snapshot(shape_id, storage)
            assert Enum.count(stream) == 2
          end)
        end

      assert_receive {:waiting_point, ref, pid}
      send(pid, {:continue, ref})

      Task.await_many(tasks)
    end

    test "errors while streaming from database are sent to all callers", ctx do
      stream_from_database =
        Stream.map(1..5, fn
          5 ->
            raise "some error"

          n ->
            # Sleep to allow read processes to run
            Process.sleep(1)
            [n]
        end)

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            GenServer.cast(parent, {:snapshot_started, shape_id})

            Storage.make_new_snapshot!(shape_id, stream_from_database, storage)
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)

      storage = Storage.for_shape(shape_id, ctx.storage)

      tasks =
        for _ <- 1..10 do
          Task.async(fn ->
            :started = ShapeCache.await_snapshot_start(shape_id, opts)
            {_, stream} = Storage.get_snapshot(shape_id, storage)

            assert_raise RuntimeError, fn -> Stream.run(stream) end
          end)
        end

      Task.await_many(tasks)
    end

    test "propagates error in snapshot creation to listeners", ctx do
      test_pid = self()

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, _storage ->
            ref = make_ref()
            send(test_pid, {:waiting_point, ref, self()})
            receive(do: ({:continue, ^ref} -> :ok))
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})

            GenServer.cast(
              parent,
              {:snapshot_failed, shape_id, %RuntimeError{message: "expected error"}, []}
            )
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      task = Task.async(fn -> ShapeCache.await_snapshot_start(shape_id, opts) end)

      log =
        capture_log(fn ->
          assert_receive {:waiting_point, ref, pid}
          send(pid, {:continue, ref})

          assert {:error, %RuntimeError{message: "expected error"}} =
                   Task.await(task)
        end)

      assert log =~ "Snapshot creation failed for #{shape_id}"
    end
  end

  describe "handle_truncate/2" do
    setup [
      :with_in_memory_storage,
      :with_persistent_kv,
      :with_registry,
      :with_transaction_producer
    ]

    test "cleans up shape data and rotates the shape id", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!(shape_id, [["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      Process.sleep(50)
      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)

      storage = Storage.for_shape(shape_id, ctx.storage)

      Storage.append_to_log!(
        shape_id,
        changes_to_log_items([
          %Electric.Replication.Changes.NewRecord{
            relation: {"public", "items"},
            record: %{"id" => "1", "value" => "Alice"},
            log_offset: LogOffset.new(Electric.Postgres.Lsn.from_integer(1000), 0)
          }
        ]),
        storage
      )

      assert Storage.snapshot_started?(shape_id, storage)
      assert Enum.count(Storage.get_log_stream(shape_id, @zero_offset, storage)) == 1

      ref = shape_id |> Shapes.Consumer.name() |> GenServer.whereis() |> Process.monitor()

      log = capture_log(fn -> ShapeCache.handle_truncate(shape_id, opts) end)
      assert log =~ "Truncating and rotating shape id"

      assert_receive {:DOWN, ^ref, :process, _pid, _}
      # Wait a bit for the async cleanup to complete

      refute Storage.snapshot_started?(shape_id, storage)
    end
  end

  describe "clean_shape/2" do
    setup [
      :with_in_memory_storage,
      :with_persistent_kv,
      :with_registry,
      :with_transaction_producer
    ]

    test "cleans up shape data and rotates the shape id", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!(shape_id, [["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      Process.sleep(50)
      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)

      storage = Storage.for_shape(shape_id, ctx.storage)

      Storage.append_to_log!(
        shape_id,
        changes_to_log_items([
          %Electric.Replication.Changes.NewRecord{
            relation: {"public", "items"},
            record: %{"id" => "1", "value" => "Alice"},
            log_offset: LogOffset.new(Electric.Postgres.Lsn.from_integer(1000), 0)
          }
        ]),
        storage
      )

      assert Storage.snapshot_started?(shape_id, storage)
      assert Enum.count(Storage.get_log_stream(shape_id, @zero_offset, storage)) == 1

      {module, _} = storage
      ref = Process.monitor(module.name(shape_id) |> GenServer.whereis())

      log = capture_log(fn -> :ok = ShapeCache.clean_shape(shape_id, opts) end)
      assert log =~ "Cleaning up shape"

      assert_receive {:DOWN, ^ref, :process, _pid, _reason}

      {shape_id2, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      assert shape_id != shape_id2
    end

    test "cleans up shape swallows error if no shape to clean up", ctx do
      shape_id = "foo"

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.put(ctx, :pool, nil),
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!(shape_id, [["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {:ok, _} = with_log(fn -> ShapeCache.clean_shape(shape_id, opts) end)
    end
  end

  describe "after restart" do
    # Capture the log to hide the GenServer exit messages
    @describetag capture_log: true

    @describetag :tmp_dir
    @snapshot_xmin 10

    setup [
      :with_cub_db_storage,
      :with_persistent_kv,
      :with_registry,
      :with_transaction_producer,
      :with_no_pool
    ]

    setup(ctx,
      do:
        with_shape_cache(ctx,
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, @snapshot_xmin})
            Storage.make_new_snapshot!(shape_id, [["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )
    )

    test "restores shape_ids", %{shape_cache_opts: opts} = context do
      {shape_id1, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      :started = ShapeCache.await_snapshot_start(shape_id1, opts)
      restart_shape_cache(context)
      {shape_id2, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      assert shape_id1 == shape_id2
    end

    test "restores snapshot xmins", %{shape_cache_opts: opts} = context do
      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      :started = ShapeCache.await_snapshot_start(shape_id, opts)
      [{^shape_id, @shape, @snapshot_xmin}] = ShapeCache.list_active_shapes(opts)

      restart_shape_cache(context)
      :started = ShapeCache.await_snapshot_start(shape_id, opts)

      assert [{^shape_id, @shape, @snapshot_xmin}] = ShapeCache.list_active_shapes(opts)
    end

    test "restores latest offset", %{shape_cache_opts: opts} = context do
      offset = @change_offset
      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      :started = ShapeCache.await_snapshot_start(shape_id, opts)

      ref = Shapes.Consumer.monitor(shape_id)

      Support.TransactionProducer.emit(context.transaction_producer, [
        %Changes.Transaction{
          changes: @changes,
          xid: @xid,
          last_log_offset: @change_offset,
          lsn: @lsn
        }
      ])

      assert_receive {Shapes.Consumer, ^ref, @xid}

      {^shape_id, ^offset} = ShapeCache.get_or_create_shape_id(@shape, opts)

      restart_shape_cache(context)

      :started = ShapeCache.await_snapshot_start(shape_id, opts)
      assert {^shape_id, ^offset} = ShapeCache.get_or_create_shape_id(@shape, opts)
    end

    test "restores relations", %{shape_cache_opts: opts} = context do
      rel = %Relation{
        id: 42,
        schema: "public",
        table: "items",
        columns: [
          %Column{name: "id", type_oid: 9},
          %Column{name: "value", type_oid: 2}
        ]
      }

      assert :ok = Support.TransactionProducer.emit(context.transaction_producer, [rel])
      assert {:ok, ^rel} = wait_for_relation(context, rel.id)

      assert_receive {Electric.PersistentKV.Memory, {:set, _, _}}
      restart_shape_cache(context)

      assert {:ok, ^rel} = wait_for_relation(context, rel.id, 2_000)
      assert ^rel = ShapeCache.get_relation(rel.id, opts)
    end

    defp restart_shape_cache(context) do
      stop_shape_cache(context)
      # Wait 1 millisecond to ensure shape IDs are not generated the same
      Process.sleep(1)
      with_cub_db_storage(context)

      with_shape_cache(context,
        prepare_tables_fn: @prepare_tables_noop,
        create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
          GenServer.cast(parent, {:snapshot_xmin_known, shape_id, @snapshot_xmin})
          Storage.make_new_snapshot!(shape_id, [["test"]], storage)
          GenServer.cast(parent, {:snapshot_started, shape_id})
        end
      )
    end

    defp stop_shape_cache(%{storage: {_, _}, shape_cache_opts: shape_cache_opts}) do
      stop_processes([shape_cache_opts[:server]])
      ShapeCache.ShapeSupervisor.stop_all_consumers()
    end

    defp stop_processes(process_names) do
      processes =
        for name <- process_names, pid = Process.whereis(name) do
          Process.unlink(pid)
          Process.monitor(pid)
          Process.exit(pid, :kill)
          {pid, name}
        end

      for {pid, name} <- processes do
        receive do
          {:DOWN, _, :process, ^pid, :killed} -> :process_killed
        after
          500 -> raise "#{name} process not killed"
        end
      end
    end
  end

  describe "relation messages" do
    @describetag capture_log: true

    @describetag :tmp_dir
    @snapshot_xmin 10

    setup [
      :with_in_memory_storage,
      :with_persistent_kv,
      :with_registry,
      :with_transaction_producer,
      :with_no_pool
    ]

    setup(ctx) do
      with_shape_cache(ctx,
        prepare_tables_fn: @prepare_tables_noop,
        create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
          GenServer.cast(parent, {:snapshot_xmin_known, shape_id, @snapshot_xmin})
          Storage.make_new_snapshot!(shape_id, [["test"]], storage)
          GenServer.cast(parent, {:snapshot_started, shape_id})
        end
      )
    end

    defp monitor_consumer(shape_id) do
      shape_id |> Shapes.Consumer.name() |> GenServer.whereis() |> Process.monitor()
    end

    defp start_shapes({shape_cache, opts}) do
      shape1 =
        Shape.new!("public.test_table",
          inspector: StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])
        )

      shape2 =
        Shape.new!("public.test_table",
          inspector: StubInspector.new([%{name: "id", type: "int8", pk_position: 0}]),
          where: "id > 5"
        )

      shape3 =
        Shape.new!("public.other_table",
          inspector: StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])
        )

      {shape_id1, _} = shape_cache.get_or_create_shape_id(shape1, opts)
      {shape_id2, _} = shape_cache.get_or_create_shape_id(shape2, opts)
      {shape_id3, _} = shape_cache.get_or_create_shape_id(shape3, opts)

      :started = shape_cache.await_snapshot_start(shape_id1, opts)
      :started = shape_cache.await_snapshot_start(shape_id2, opts)
      :started = shape_cache.await_snapshot_start(shape_id3, opts)

      ref1 = monitor_consumer(shape_id1)
      ref2 = monitor_consumer(shape_id2)
      ref3 = monitor_consumer(shape_id3)

      [
        {shape_id1, ref1},
        {shape_id2, ref2},
        {shape_id3, ref3}
      ]
    end

    test "stores relation if it is not known", ctx do
      relation_id = "rel1"

      rel = %Relation{
        id: relation_id,
        schema: "public",
        table: "test_table",
        columns: []
      }

      assert :ok = Support.TransactionProducer.emit(ctx.transaction_producer, [rel])

      assert {:ok, ^rel} = wait_for_relation(ctx, relation_id)
    end

    test "does not clean shapes if relation didn't change", ctx do
      %{shape_cache: {shape_cache, opts}} = ctx

      relation_id = "rel1"

      shape =
        Shape.new!("public.test_table",
          inspector: StubInspector.new([%{name: "id", type: :int8}])
        )

      {shape_id, _} = shape_cache.get_or_create_shape_id(shape, opts)

      ref = monitor_consumer(shape_id)

      rel = %Relation{
        id: relation_id,
        schema: "public",
        table: "test_table",
        columns: []
      }

      assert :ok = Support.TransactionProducer.emit(ctx.transaction_producer, [rel])

      assert {:ok, ^rel} = wait_for_relation(ctx, relation_id)

      refute_receive {:DOWN, ^ref, :process, _, _}
    end

    test "cleans shapes affected by table renaming and logs a warning", ctx do
      relation_id = "rel1"

      [
        {_shape_id1, ref1},
        {_shape_id2, ref2},
        {_shape_id3, ref3}
      ] = start_shapes(ctx.shape_cache)

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

      assert :ok = Support.TransactionProducer.emit(ctx.transaction_producer, [old_rel])

      assert {:ok, ^old_rel} = wait_for_relation(ctx, relation_id)

      log =
        capture_log(fn ->
          assert :ok = Support.TransactionProducer.emit(ctx.transaction_producer, [new_rel])
          assert_receive {:DOWN, ^ref1, :process, _, _}
          assert_receive {:DOWN, ^ref2, :process, _, _}
          refute_receive {:DOWN, ^ref3, :process, _, _}
        end)

      assert log =~ "Schema for the table public.test_table changed"
    end

    test "cleans shapes affected by a relation change", ctx do
      relation_id = "rel1"

      [
        {_shape_id1, ref1},
        {_shape_id2, ref2},
        {_shape_id3, ref3}
      ] = start_shapes(ctx.shape_cache)

      old_rel = %Relation{
        id: relation_id,
        schema: "public",
        table: "test_table",
        columns: [%Column{name: "id", type_oid: 901}]
      }

      new_rel = %Relation{
        id: relation_id,
        schema: "public",
        table: "test_table",
        columns: [%Column{name: "id", type_oid: 123}]
      }

      assert :ok = Support.TransactionProducer.emit(ctx.transaction_producer, [old_rel])

      assert {:ok, ^old_rel} = wait_for_relation(ctx, relation_id)

      log =
        capture_log(fn ->
          assert :ok = Support.TransactionProducer.emit(ctx.transaction_producer, [new_rel])
          assert_receive {:DOWN, ^ref1, :process, _, _}
          assert_receive {:DOWN, ^ref2, :process, _, _}
          refute_receive {:DOWN, ^ref3, :process, _, _}
        end)

      assert log =~ "Schema for the table public.test_table changed"
    end
  end

  def prepare_tables_noop(_, _), do: :ok

  defp stream_to_list(stream) do
    stream
    |> Enum.map(&Jason.decode!/1)
    |> Enum.sort_by(fn %{"value" => %{"value" => val}} -> val end)
  end

  defp wait_for_relation(ctx, relation_id, timeout \\ 1_000) do
    parent = self()

    Task.start(fn ->
      do_wait_for_relation(ctx.shape_cache, relation_id, parent)
    end)

    receive do
      {:relation, ^relation_id, relation} -> {:ok, relation}
    after
      timeout -> flunk("timed out waiting for relation #{inspect(relation_id)}")
    end
  end

  defp do_wait_for_relation({shape_cache, shape_cache_opts}, relation_id, parent) do
    if relation = shape_cache.get_relation(relation_id, shape_cache_opts) do
      send(parent, {:relation, relation_id, relation})
    else
      Process.sleep(10)
      do_wait_for_relation({shape_cache, shape_cache_opts}, relation_id, parent)
    end
  end
end
