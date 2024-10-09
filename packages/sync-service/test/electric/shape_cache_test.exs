defmodule Electric.ShapeCacheTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache
  alias Electric.ShapeCache.{Storage, ShapeStatus}
  alias Electric.Shapes
  alias Electric.Shapes.Shape

  alias Support.StubInspector

  import Mox
  import ExUnit.CaptureLog
  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Support.TestUtils

  @moduletag :capture_log

  @shape %Shape{
    root_table: {"public", "items"},
    root_table_id: 1,
    table_info: %{
      {"public", "items"} => %{
        columns: [
          %{name: "id", type: :text, type_id: {25, 1}},
          %{name: "value", type: :text, type_id: {25, 1}}
        ],
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

  @stub_inspector StubInspector.new([
                    %{name: "id", type: "int8", type_id: {20, 1}, pk_position: 0},
                    %{name: "value", type: "text", type_id: {25, 1}}
                  ])

  setup :verify_on_exit!

  setup do
    %{inspector: @stub_inspector, run_with_conn_fn: fn _, cb -> cb.(:connection) end}
  end

  describe "get_or_create_shape_id/2" do
    setup [
      :with_electric_instance_id,
      :with_in_memory_storage,
      :with_log_chunking,
      :with_no_pool,
      :with_registry,
      :with_shape_log_collector
    ]

    setup ctx do
      with_shape_cache(
        Map.put(ctx, :inspector, @stub_inspector),
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
      :with_electric_instance_id,
      :with_in_memory_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector
    ]

    test "creates initial snapshot if one doesn't exist", %{storage: storage} = ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {shape_id, offset} = ShapeCache.get_or_create_shape_id(@shape, opts)
      assert offset == @zero_offset
      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)
      Process.sleep(100)
      shape_storage = Storage.for_shape(shape_id, storage)
      assert Storage.snapshot_started?(shape_storage)
    end

    test "triggers table prep and snapshot creation only once", ctx do
      test_pid = self()

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          prepare_tables_fn: fn nil, [{{"public", "items"}, nil}] ->
            send(test_pid, {:called, :prepare_tables_fn})
          end,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            send(test_pid, {:called, :create_snapshot_fn})
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!([["test"]], storage)
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
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            send(test_pid, {:called, :create_snapshot_fn})
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!([["test"]], storage)
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
  end

  describe "get_or_create_shape_id/2 against real db" do
    setup [
      :with_electric_instance_id,
      :with_in_memory_storage,
      :with_log_chunking,
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
      storage = Storage.for_shape(shape_id, storage)
      assert {@zero_offset, stream} = Storage.get_snapshot(storage)

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
      storage = Storage.for_shape(shape_id, storage)
      assert {@zero_offset, stream} = Storage.get_snapshot(storage)

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
      storage = Storage.for_shape(shape_id, storage)
      {_, stream} = Storage.get_snapshot(storage)
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
      shape = %Shape{root_table: {"public", "nonexistent"}, root_table_id: 2}

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

  describe "list_shapes/1" do
    setup [
      :with_electric_instance_id,
      :with_in_memory_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector
    ]

    test "returns empty list initially", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          prepare_tables_fn: @prepare_tables_noop
        )

      meta_table = Keyword.fetch!(opts, :shape_meta_table)

      assert ShapeCache.list_shapes(%{shape_meta_table: meta_table}) == []
    end

    test "lists the shape as active once there is a snapshot", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)
      meta_table = Keyword.fetch!(opts, :shape_meta_table)
      assert [{^shape_id, @shape}] = ShapeCache.list_shapes(%{shape_meta_table: meta_table})
      assert {:ok, 10} = ShapeStatus.snapshot_xmin(meta_table, shape_id)
    end

    test "lists the shape even if we don't know xmin", ctx do
      test_pid = self()

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            ref = make_ref()
            send(test_pid, {:waiting_point, ref, self()})
            receive(do: ({:continue, ^ref} -> :ok))
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)

      # Wait until we get to the waiting point in the snapshot
      assert_receive {:waiting_point, ref, pid}

      meta_table = Keyword.fetch!(opts, :shape_meta_table)
      assert [{^shape_id, @shape}] = ShapeCache.list_shapes(%{shape_meta_table: meta_table})

      send(pid, {:continue, ref})

      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)
      assert [{^shape_id, @shape}] = ShapeCache.list_shapes(%{shape_meta_table: meta_table})
    end
  end

  describe "has_shape?/2" do
    setup [
      :with_electric_instance_id,
      :with_in_memory_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector
    ]

    test "returns true for known shape id", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
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
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
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
      :with_electric_instance_id,
      :with_in_memory_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector
    ]

    test "returns :started for snapshots that have started", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
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
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      assert {:error, :unknown} = ShapeCache.await_snapshot_start(shape_id, opts)

      refute Storage.snapshot_started?(storage)
    end

    test "handles buffering multiple callers correctly", ctx do
      test_pid = self()

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
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
            Storage.make_new_snapshot!([[1], [2]], storage)
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)

      storage = Storage.for_shape(shape_id, ctx.storage)

      tasks =
        for _id <- 1..10 do
          Task.async(fn ->
            assert :started = ShapeCache.await_snapshot_start(shape_id, opts)
            {_, stream} = Storage.get_snapshot(storage)
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
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            GenServer.cast(parent, {:snapshot_started, shape_id})

            Storage.make_new_snapshot!(stream_from_database, storage)
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)

      storage = Storage.for_shape(shape_id, ctx.storage)

      tasks =
        for _ <- 1..10 do
          Task.async(fn ->
            :started = ShapeCache.await_snapshot_start(shape_id, opts)
            {_, stream} = Storage.get_snapshot(storage)

            assert_raise RuntimeError, fn -> Stream.run(stream) end
          end)
        end

      Task.await_many(tasks)
    end

    test "propagates error in snapshot creation to listeners", ctx do
      test_pid = self()

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
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
      :with_electric_instance_id,
      :with_in_memory_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector
    ]

    test "cleans up shape data and rotates the shape id", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      Process.sleep(50)
      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)

      storage = Storage.for_shape(shape_id, ctx.storage)

      Storage.append_to_log!(
        changes_to_log_items([
          %Electric.Replication.Changes.NewRecord{
            relation: {"public", "items"},
            record: %{"id" => "1", "value" => "Alice"},
            log_offset: LogOffset.new(Electric.Postgres.Lsn.from_integer(1000), 0)
          }
        ]),
        storage
      )

      assert Storage.snapshot_started?(storage)
      assert Enum.count(Storage.get_log_stream(@zero_offset, storage)) == 1

      ref = ctx.electric_instance_id |> Shapes.Consumer.whereis(shape_id) |> Process.monitor()

      log = capture_log(fn -> ShapeCache.handle_truncate(shape_id, opts) end)
      assert log =~ "Truncating and rotating shape id"

      assert_receive {:DOWN, ^ref, :process, _pid, _}
      # Wait a bit for the async cleanup to complete

      refute Storage.snapshot_started?(storage)
    end
  end

  describe "clean_shape/2" do
    setup [
      :with_electric_instance_id,
      :with_in_memory_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector
    ]

    test "cleans up shape data and rotates the shape id", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_id})
          end
        )

      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      Process.sleep(50)
      assert :started = ShapeCache.await_snapshot_start(shape_id, opts)

      storage = Storage.for_shape(shape_id, ctx.storage)

      Storage.append_to_log!(
        changes_to_log_items([
          %Electric.Replication.Changes.NewRecord{
            relation: {"public", "items"},
            record: %{"id" => "1", "value" => "Alice"},
            log_offset: LogOffset.new(Electric.Postgres.Lsn.from_integer(1000), 0)
          }
        ]),
        storage
      )

      assert Storage.snapshot_started?(storage)
      assert Enum.count(Storage.get_log_stream(@zero_offset, storage)) == 1

      {module, _} = storage

      ref =
        Process.monitor(module.name(ctx.electric_instance_id, shape_id) |> GenServer.whereis())

      log = capture_log(fn -> :ok = ShapeCache.clean_shape(shape_id, opts) end)
      assert log =~ "Cleaning up shape"

      assert_receive {:DOWN, ^ref, :process, _pid, _reason}

      assert_raise ArgumentError,
                   ~r"the table identifier does not refer to an existing ETS table",
                   fn -> Stream.run(Storage.get_log_stream(@zero_offset, storage)) end

      assert_raise RuntimeError,
                   ~r"Snapshot no longer available",
                   fn -> Storage.get_snapshot(storage) end

      {shape_id2, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      assert shape_id != shape_id2
    end

    test "cleans up shape swallows error if no shape to clean up", ctx do
      shape_id = "foo"

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, 10})
            Storage.make_new_snapshot!([["test"]], storage)
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

    setup do
      %{
        # don't crash the log collector when the shape consumers get killed by our tests
        link_log_collector: false,
        inspector: Support.StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])
      }
    end

    setup [
      :with_electric_instance_id,
      :with_cub_db_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_no_pool
    ]

    setup(ctx,
      do:
        with_shape_cache(Map.put(ctx, :inspector, @stub_inspector),
          run_with_conn_fn: &run_with_conn_noop/2,
          prepare_tables_fn: @prepare_tables_noop,
          create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
            GenServer.cast(parent, {:snapshot_xmin_known, shape_id, @snapshot_xmin})
            Storage.make_new_snapshot!([["test"]], storage)
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
      meta_table = Keyword.fetch!(opts, :shape_meta_table)
      [{^shape_id, @shape}] = ShapeCache.list_shapes(%{shape_meta_table: meta_table})
      {:ok, @snapshot_xmin} = ShapeStatus.snapshot_xmin(meta_table, shape_id)

      restart_shape_cache(context)
      :started = ShapeCache.await_snapshot_start(shape_id, opts)

      assert [{^shape_id, @shape}] = ShapeCache.list_shapes(%{shape_meta_table: meta_table})
      {:ok, @snapshot_xmin} = ShapeStatus.snapshot_xmin(meta_table, shape_id)
    end

    test "restores latest offset", %{shape_cache_opts: opts} = context do
      offset = @change_offset
      {shape_id, _} = ShapeCache.get_or_create_shape_id(@shape, opts)
      :started = ShapeCache.await_snapshot_start(shape_id, opts)

      ref = Shapes.Consumer.monitor(context.electric_instance_id, shape_id)

      ShapeLogCollector.store_transaction(
        %Changes.Transaction{
          changes: @changes,
          xid: @xid,
          last_log_offset: @change_offset,
          lsn: @lsn,
          affected_relations: MapSet.new([{"public", "items"}])
        },
        context.shape_log_collector
      )

      assert_receive {Shapes.Consumer, ^ref, @xid}

      {^shape_id, ^offset} = ShapeCache.get_or_create_shape_id(@shape, opts)

      # without this sleep, this test becomes unreliable. I think maybe due to
      # delays in actually writing the data to cubdb/fsyncing the tx. I've
      # tried explicit `CubDb.file_sync/1` calls but it doesn't work, the only
      # reliable method is to wait just a little bit...
      Process.sleep(10)

      restart_shape_cache(context)

      :started = ShapeCache.await_snapshot_start(shape_id, opts)
      assert {^shape_id, ^offset} = ShapeCache.get_or_create_shape_id(@shape, opts)
    end

    defp restart_shape_cache(context) do
      stop_shape_cache(context)
      # Wait 1 millisecond to ensure shape IDs are not generated the same
      Process.sleep(1)
      with_cub_db_storage(context)

      with_shape_cache(Map.put(context, :inspector, @stub_inspector),
        prepare_tables_fn: @prepare_tables_noop,
        create_snapshot_fn: fn parent, shape_id, _shape, _, storage ->
          GenServer.cast(parent, {:snapshot_xmin_known, shape_id, @snapshot_xmin})
          Storage.make_new_snapshot!([["test"]], storage)
          GenServer.cast(parent, {:snapshot_started, shape_id})
        end
      )
    end

    defp stop_shape_cache(ctx) do
      %{shape_cache: {shape_cache, shape_cache_opts}} = ctx

      consumers =
        for {shape_id, _} <- shape_cache.list_shapes(Map.new(shape_cache_opts)) do
          pid = Shapes.Consumer.whereis(ctx.electric_instance_id, shape_id)
          {pid, Process.monitor(pid)}
        end

      Shapes.ConsumerSupervisor.stop_all_consumers(ctx.consumer_supervisor)

      for {pid, ref} <- consumers do
        assert_receive {:DOWN, ^ref, :process, ^pid, _}
      end

      stop_processes([shape_cache_opts[:server], ctx.consumer_supervisor])
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

  def prepare_tables_noop(_, _), do: :ok

  def run_with_conn_noop(conn, cb), do: cb.(conn)

  defp stream_to_list(stream) do
    stream
    |> Enum.map(&Jason.decode!/1)
    |> Enum.sort_by(fn %{"value" => %{"value" => val}} -> val end)
  end
end
