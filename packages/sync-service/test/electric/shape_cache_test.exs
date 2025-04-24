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
  alias Support.Mock

  @shape %Shape{
    root_table: {"public", "items"},
    root_table_id: 1,
    root_pk: ["id"],
    selected_columns: ["id", "value"]
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

  @zero_offset LogOffset.last_before_real_offsets()

  @stub_inspector StubInspector.new([
                    %{
                      name: "id",
                      type: "int8",
                      type_id: {20, 1},
                      pk_position: 0,
                      is_generated: false
                    },
                    %{name: "value", type: "text", type_id: {25, 1}, is_generated: false}
                  ])

  # {xmin, xmax, xip_list}
  @pg_snapshot_xmin_10 {10, 11, [10]}
  @pg_snapshot_xmin_100 {100, 101, [100]}

  defmodule TempPubManager do
    def add_shape(_, opts) do
      send(opts[:test_pid], {:called, :prepare_tables_fn})
    end

    def refresh_publication(_), do: :ok
  end

  setup :verify_on_exit!

  setup do
    %{inspector: @stub_inspector, run_with_conn_fn: fn _, cb -> cb.(:connection) end}
  end

  setup [:with_persistent_kv, :with_stack_id_from_test, :with_status_monitor]

  describe "get_or_create_shape_handle/2" do
    setup [
      :with_in_memory_storage,
      :with_log_chunking,
      :with_no_pool,
      :with_registry,
      :with_shape_log_collector,
      :with_noop_publication_manager
    ]

    setup ctx do
      with_shape_cache(
        Map.put(ctx, :inspector, @stub_inspector),
        create_snapshot_fn: fn _, _, _, _, _, _, _ -> nil end
      )
    end

    test "creates a new shape_handle", %{shape_cache_opts: opts} do
      {shape_handle, @zero_offset} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert is_binary(shape_handle)
    end

    test "returns existing shape_handle", %{shape_cache_opts: opts} do
      {shape_handle1, @zero_offset} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      {shape_handle2, @zero_offset} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert shape_handle1 == shape_handle2
    end
  end

  describe "get_or_create_shape_handle/2 shape initialization" do
    setup [
      :with_in_memory_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_noop_publication_manager
    ]

    test "creates initial snapshot if one doesn't exist", %{storage: storage} = ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )

      {shape_handle, offset} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert offset == @zero_offset
      assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)
      Process.sleep(100)
      shape_storage = Storage.for_shape(shape_handle, storage)
      assert Storage.snapshot_started?(shape_storage)
    end

    test "triggers table prep and snapshot creation only once", ctx do
      test_pid = self()

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          publication_manager: {TempPubManager, [test_pid: test_pid]},
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            send(test_pid, {:called, :create_snapshot_fn})
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)

      # subsequent calls return the same shape_handle
      for _ <- 1..10,
          do: assert({^shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts))

      assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)

      assert_received {:called, :prepare_tables_fn}
      assert_received {:called, :create_snapshot_fn}
      refute_received {:called, _}
    end

    test "triggers table prep and snapshot creation only once even with queued requests", ctx do
      test_pid = self()

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            send(test_pid, {:called, :create_snapshot_fn})
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )

      link_pid = Process.whereis(opts[:server])

      # suspend the genserver to simulate message queue buildup
      :sys.suspend(link_pid)

      create_call_1 =
        Task.async(fn ->
          {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
          shape_handle
        end)

      create_call_2 =
        Task.async(fn ->
          {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
          shape_handle
        end)

      # resume the genserver and assert both queued tasks return the same shape_handle
      :sys.resume(link_pid)
      shape_handle = Task.await(create_call_1)
      assert shape_handle == Task.await(create_call_2)

      assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)

      # any queued calls should still return the existing shape_handle
      # after the snapshot has been created (simulated by directly
      # calling GenServer)
      assert {^shape_handle, _} =
               GenServer.call(link_pid, {:create_or_wait_shape_handle, @shape, nil})

      assert_received {:called, :create_snapshot_fn}
    end

    test "expires shapes if shape count has gone over max_shapes", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end,
          max_shapes: 1
        )

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      Process.sleep(50)
      assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)

      storage = Storage.for_shape(shape_handle, ctx.storage)

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

      assert Enum.count(Storage.get_log_stream(LogOffset.last_before_real_offsets(), storage)) ==
               1

      {module, _} = storage

      ref =
        Process.monitor(
          module.name(ctx.stack_id, shape_handle)
          |> GenServer.whereis()
        )

      {new_shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(%{@shape | where: "1 == 1"}, opts)

      Process.sleep(50)
      assert :started = ShapeCache.await_snapshot_start(new_shape_handle, opts)

      assert_receive {:DOWN, ^ref, :process, _pid, _reason}

      assert_raise ArgumentError,
                   ~r"the table identifier does not refer to an existing ETS table",
                   fn -> Stream.run(Storage.get_log_stream(@zero_offset, storage)) end

      {shape_handle2, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert shape_handle != shape_handle2
    end
  end

  describe "get_or_create_shape_handle/2 against real db" do
    setup [
      :with_in_memory_storage,
      :with_log_chunking,
      :with_registry,
      :with_unique_db,
      :with_publication,
      :with_basic_tables,
      :with_inspector,
      :with_shape_log_collector,
      :with_publication_manager,
      :with_shape_cache,
      :with_sql_execute
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
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)
      storage = Storage.for_shape(shape_handle, storage)

      stream =
        Storage.get_log_stream(
          LogOffset.before_all(),
          LogOffset.last_before_real_offsets(),
          storage
        )

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
      shape = %{@shape | selected_columns: ~w|id value date timestamptz float bytea interval|}

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

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(shape, opts)
      assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)
      storage = Storage.for_shape(shape_handle, storage)

      stream =
        Storage.get_log_stream(
          LogOffset.before_all(),
          LogOffset.last_before_real_offsets(),
          storage
        )

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

    test "correctly propagates the error", %{shape_cache_opts: opts} do
      shape = %Shape{
        @shape
        | root_table: {"public", "nonexistent"},
          root_table_id: 2
      }

      {shape_handle, log} =
        with_log(fn ->
          {shape_handle, _} = ShapeCache.get_or_create_shape_handle(shape, opts)

          assert {:error, %Electric.Shapes.Api.Error{status: 409}} =
                   ShapeCache.await_snapshot_start(shape_handle, opts)

          shape_handle
        end)

      log =~ "Snapshot creation failed for #{shape_handle}"

      log =~
        ~S|** (Postgrex.Error) ERROR 42P01 (undefined_table) relation "public.nonexistent" does not exist|
    end

    @tag with_sql: [
           ~s|CREATE TABLE "partitioned_items" (a INT, b INT, PRIMARY KEY (a, b)) PARTITION BY RANGE (b)|,
           ~s|CREATE TABLE "partitioned_items_100" PARTITION OF "partitioned_items" FOR VALUES FROM (0) TO (99)|,
           ~s|CREATE TABLE "partitioned_items_200" PARTITION OF "partitioned_items" FOR VALUES FROM (100) TO (199)|
         ]
    test "can create shape from partitioned table", ctx do
      Postgrex.query!(
        ctx.pool,
        "INSERT INTO partitioned_items (a, b) VALUES ($1, $2), ($3, $4), ($5, $6)",
        [1, 50, 2, 150, 3, 10]
      )

      shape = %Shape{
        root_table: {"public", "partitioned_items"},
        root_table_id: 1,
        root_pk: ["a", "b"],
        selected_columns: ["a", "b"]
      }

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(shape, ctx.shape_cache_opts)
      assert :started = ShapeCache.await_snapshot_start(shape_handle, ctx.shape_cache_opts)
      storage = Storage.for_shape(shape_handle, ctx.storage)

      stream =
        Storage.get_log_stream(
          LogOffset.before_all(),
          LogOffset.last_before_real_offsets(),
          storage
        )

      assert [
               %{"value" => %{"a" => "1"}},
               %{"value" => %{"a" => "2"}},
               %{"value" => %{"a" => "3"}}
             ] = stream_to_list(stream, "a")
    end
  end

  describe "list_shapes/1" do
    setup [
      :with_in_memory_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_noop_publication_manager
    ]

    test "returns empty list initially", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2
        )

      meta_table = Access.fetch!(opts, :shape_meta_table)

      assert ShapeCache.list_shapes(%{shape_meta_table: meta_table}) == []
    end

    test "lists the shape as active once there is a snapshot", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)
      meta_table = Access.fetch!(opts, :shape_meta_table)
      assert [{^shape_handle, @shape}] = ShapeCache.list_shapes(%{shape_meta_table: meta_table})
      assert {:ok, 10} = ShapeStatus.snapshot_xmin(meta_table, shape_handle)
    end

    test "lists the shape even if we don't know xmin", ctx do
      test_pid = self()

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            ref = make_ref()
            send(test_pid, {:waiting_point, ref, self()})
            receive(do: ({:continue, ^ref} -> :ok))
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)

      # Wait until we get to the waiting point in the snapshot
      assert_receive {:waiting_point, ref, pid}

      meta_table = Access.fetch!(opts, :shape_meta_table)
      assert [{^shape_handle, @shape}] = ShapeCache.list_shapes(%{shape_meta_table: meta_table})

      send(pid, {:continue, ref})

      assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)
      assert [{^shape_handle, @shape}] = ShapeCache.list_shapes(%{shape_meta_table: meta_table})
    end
  end

  describe "has_shape?/2" do
    setup [
      :with_in_memory_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_noop_publication_manager
    ]

    test "returns true for known shape handle", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _, _, _, _, _ ->
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_100})
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )

      refute ShapeCache.has_shape?("some-random-id", opts)
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert ShapeCache.has_shape?(shape_handle, opts)
    end

    test "works with slow snapshot generation", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _, _, _, _, _ ->
            Process.sleep(100)
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_100})
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert ShapeCache.has_shape?(shape_handle, opts)
    end
  end

  describe "await_snapshot_start/4" do
    setup [
      :with_in_memory_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_noop_publication_manager
    ]

    test "returns :started for snapshots that have started", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _, _, _, _, _ ->
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_100})
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)

      assert ShapeCache.await_snapshot_start(shape_handle, opts) == :started
    end

    test "returns an error if waiting is for an unknown shape handle", ctx do
      shape_handle = "orphaned_handle"

      storage = Storage.for_shape(shape_handle, ctx.storage)

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )

      assert {:error, :unknown} = ShapeCache.await_snapshot_start(shape_handle, opts)

      refute Storage.snapshot_started?(storage)
    end

    test "handles buffering multiple callers correctly", ctx do
      test_pid = self()

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            ref = make_ref()
            send(test_pid, {:waiting_point, ref, self()})
            receive(do: ({:continue, ^ref} -> :ok))
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})

            # Sometimes only some tasks subscribe before reaching this point, and then hang
            # if we don't actually have a snapshot. This is kind of part of the test, because
            # `await_snapshot_start/3` should always resolve to `:started` in concurrent situations
            GenServer.cast(parent, {:snapshot_started, shape_handle})
            Storage.make_new_snapshot!([[1], [2]], storage)
          end
        )

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)

      storage = Storage.for_shape(shape_handle, ctx.storage)

      tasks =
        for _id <- 1..10 do
          Task.async(fn ->
            assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)

            stream =
              Storage.get_log_stream(
                LogOffset.before_all(),
                LogOffset.last_before_real_offsets(),
                storage
              )

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
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
            GenServer.cast(parent, {:snapshot_started, shape_handle})

            Storage.make_new_snapshot!(stream_from_database, storage)
          end
        )

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)

      storage = Storage.for_shape(shape_handle, ctx.storage)

      tasks =
        for _ <- 1..10 do
          Task.async(fn ->
            :started = ShapeCache.await_snapshot_start(shape_handle, opts)

            stream =
              Storage.get_log_stream(
                LogOffset.before_all(),
                LogOffset.last_before_real_offsets(),
                storage
              )

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
          create_snapshot_fn: fn parent, shape_handle, _shape, _, _storage, _, _ ->
            ref = make_ref()
            send(test_pid, {:waiting_point, ref, self()})
            receive(do: ({:continue, ^ref} -> :ok))
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})

            GenServer.cast(
              parent,
              {:snapshot_failed, shape_handle, %RuntimeError{message: "expected error"}, []}
            )
          end
        )

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      task = Task.async(fn -> ShapeCache.await_snapshot_start(shape_handle, opts) end)

      log =
        capture_log(fn ->
          assert_receive {:waiting_point, ref, pid}
          send(pid, {:continue, ref})

          assert {:error, %RuntimeError{message: "expected error"}} =
                   Task.await(task)
        end)

      assert log =~ "Snapshot creation failed for #{shape_handle}"
    end
  end

  describe "clean_shape/2" do
    setup [
      :with_in_memory_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_noop_publication_manager
    ]

    test "cleans up shape data and rotates the shape handle", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      Process.sleep(50)
      assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)

      storage = Storage.for_shape(shape_handle, ctx.storage)

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

      assert Enum.count(Storage.get_log_stream(LogOffset.last_before_real_offsets(), storage)) ==
               1

      {module, _} = storage

      ref =
        Process.monitor(
          module.name(ctx.stack_id, shape_handle)
          |> GenServer.whereis()
        )

      log = capture_log(fn -> :ok = ShapeCache.clean_shape(shape_handle, opts) end)
      assert log =~ "Cleaning up shape"

      assert_receive {:DOWN, ^ref, :process, _pid, _reason}

      assert_raise ArgumentError,
                   ~r"the table identifier does not refer to an existing ETS table",
                   fn -> Stream.run(Storage.get_log_stream(@zero_offset, storage)) end

      {shape_handle2, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert shape_handle != shape_handle2
    end

    test "cleans up shape swallows error if no shape to clean up", ctx do
      shape_handle = "foo"

      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )

      {:ok, _} = with_log(fn -> ShapeCache.clean_shape(shape_handle, opts) end)
    end
  end

  describe "clean_all_shapes_for_relations/2" do
    setup [
      :with_in_memory_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_noop_publication_manager
    ]

    setup ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )

      {:ok, %{shape_cache_opts: opts}}
    end

    test "cleans up shape data for relevant shapes", %{shape_cache_opts: opts} = ctx do
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      Process.sleep(50)
      assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)

      storage = Storage.for_shape(shape_handle, ctx.storage)

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

      assert Enum.count(Storage.get_log_stream(LogOffset.last_before_real_offsets(), storage)) ==
               1

      {module, _} = storage

      ref =
        Process.monitor(
          module.name(ctx.stack_id, shape_handle)
          |> GenServer.whereis()
        )

      # Cleaning unrelated relations should not affect the shape
      :ok =
        ShapeCache.clean_all_shapes_for_relations(
          [{@shape.root_table_id + 1, {"public", "different"}}],
          opts
        )

      refute_receive {:DOWN, ^ref, :process, _pid, _reason}

      :ok =
        ShapeCache.clean_all_shapes_for_relations(
          [{@shape.root_table_id, {"public", "items"}}],
          opts
        )

      assert_receive {:DOWN, ^ref, :process, _pid, _reason}

      assert_raise ArgumentError,
                   ~r"the table identifier does not refer to an existing ETS table",
                   fn -> Stream.run(Storage.get_log_stream(@zero_offset, storage)) end

      {shape_handle2, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert shape_handle != shape_handle2
    end
  end

  describe "clean_all_shapes/1" do
    setup [
      :with_in_memory_storage,
      :with_tracing_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_noop_publication_manager
    ]

    test "calls unsafe_cleanup! on storage", ctx do
      %{shape_cache_opts: opts} =
        with_shape_cache(Map.merge(ctx, %{pool: nil, inspector: @stub_inspector}),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)

      ref =
        Process.monitor(
          Electric.Shapes.Consumer.name(ctx.stack_id, shape_handle)
          |> GenServer.whereis()
        )

      :ok = ShapeCache.clean_all_shapes(opts)

      assert_receive {:DOWN, ^ref, :process, _pid, _reason}

      assert_receive {Support.TestStorage, :cleanup!, ^shape_handle}
      assert_receive {Support.TestStorage, :unsafe_cleanup!, ^shape_handle}
    end
  end

  describe "after restart" do
    @describetag :tmp_dir

    setup do
      %{
        inspector: Support.StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])
      }
    end

    setup [
      :with_cub_db_storage,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_noop_publication_manager,
      :with_no_pool
    ]

    setup(ctx,
      do:
        with_shape_cache(Map.put(ctx, :inspector, @stub_inspector),
          run_with_conn_fn: &run_with_conn_noop/2,
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )
    )

    test "restores shape_handles", %{shape_cache_opts: opts} = context do
      {shape_handle1, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      :started = ShapeCache.await_snapshot_start(shape_handle1, opts)
      restart_shape_cache(context)
      {shape_handle2, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert shape_handle1 == shape_handle2
    end

    test "restores snapshot xmins", %{shape_cache_opts: opts} = context do
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      :started = ShapeCache.await_snapshot_start(shape_handle, opts)
      meta_table = Keyword.fetch!(opts, :shape_meta_table)
      [{^shape_handle, @shape}] = ShapeCache.list_shapes(%{shape_meta_table: meta_table})
      {:ok, snapshot_xmin} = ShapeStatus.snapshot_xmin(meta_table, shape_handle)
      assert snapshot_xmin == elem(@pg_snapshot_xmin_10, 0)

      %{shape_cache_opts: opts} = restart_shape_cache(context)
      :started = ShapeCache.await_snapshot_start(shape_handle, opts)

      meta_table = Keyword.fetch!(opts, :shape_meta_table)
      assert [{^shape_handle, @shape}] = ShapeCache.list_shapes(%{shape_meta_table: meta_table})
      {:ok, snapshot_xmin} = ShapeStatus.snapshot_xmin(meta_table, shape_handle)
      assert snapshot_xmin == elem(@pg_snapshot_xmin_10, 0)
    end

    test "restores publication filters", %{shape_cache_opts: opts} = context do
      {shape_handle1, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      :started = ShapeCache.await_snapshot_start(shape_handle1, opts)

      Mock.PublicationManager
      |> expect(:recover_shape, 1, fn _, _ -> :ok end)
      |> expect(:refresh_publication, 1, fn _ -> :ok end)
      |> allow(self(), fn -> Process.whereis(opts[:server]) end)

      restart_shape_cache(%{
        context
        | publication_manager: {Mock.PublicationManager, []}
      })

      {shape_handle2, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert shape_handle1 == shape_handle2
    end

    test "restores latest offset", %{shape_cache_opts: opts} = context do
      offset = @change_offset
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      :started = ShapeCache.await_snapshot_start(shape_handle, opts)

      ref = Shapes.Consumer.monitor(context.stack_id, shape_handle)

      ShapeLogCollector.store_transaction(
        %Changes.Transaction{
          changes: @changes,
          xid: @xid,
          last_log_offset: @change_offset,
          lsn: @lsn,
          affected_relations: MapSet.new([{"public", "items"}]),
          commit_timestamp: DateTime.utc_now()
        },
        context.shape_log_collector
      )

      assert_receive {Shapes.Consumer, ^ref, @xid}

      {^shape_handle, ^offset} = ShapeCache.get_or_create_shape_handle(@shape, opts)

      # without this sleep, this test becomes unreliable. I think maybe due to
      # delays in actually writing the data to cubdb/fsyncing the tx. I've
      # tried explicit `CubDb.file_sync/1` calls but it doesn't work, the only
      # reliable method is to wait just a little bit...
      Process.sleep(10)

      restart_shape_cache(context)

      :started = ShapeCache.await_snapshot_start(shape_handle, opts)
      assert {^shape_handle, ^offset} = ShapeCache.get_or_create_shape_handle(@shape, opts)
    end

    test "invalidates shapes that we fail to restore", %{shape_cache_opts: opts} = context do
      {shape_handle1, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      :started = ShapeCache.await_snapshot_start(shape_handle1, opts)

      Mock.PublicationManager
      |> stub(:remove_shape, fn _, _ -> :ok end)
      |> expect(:recover_shape, 1, fn _, _ -> :ok end)
      |> expect(:refresh_publication, 1, fn _ -> raise "failed recovery" end)
      |> allow(self(), fn -> Shapes.Consumer.whereis(context[:stack_id], shape_handle1) end)
      |> allow(self(), fn -> Process.whereis(opts[:server]) end)

      # Should fail to start shape cache and clean up shapes
      Process.flag(:trap_exit, true)

      assert_raise MatchError, ~r/%RuntimeError{message: \"failed recovery\"/, fn ->
        restart_shape_cache(%{
          context
          | publication_manager: {Mock.PublicationManager, []}
        })
      end

      Process.flag(:trap_exit, false)

      # Next restart should not recover shape
      restart_shape_cache(context)
      {shape_handle2, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      :started = ShapeCache.await_snapshot_start(shape_handle2, opts)
      assert shape_handle1 != shape_handle2
    end

    defmodule SlowPublicationManager do
      def refresh_publication(_), do: :ok
      def remove_shape(_, _), do: :ok
      def recover_shape(_, _), do: Process.sleep(100)
      def add_shape(_, _), do: :ok
    end

    test "deletes shapes that fail to initialise within a timeout", ctx do
      %{shape_cache_opts: opts} = ctx

      {shape_handle1, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      :started = ShapeCache.await_snapshot_start(shape_handle1, opts)

      restart_shape_cache(ctx,
        publication_manager: {SlowPublicationManager, []},
        storage: Support.TestStorage.wrap(ctx.storage, %{}),
        recover_shape_timeout: 10
      )

      assert_receive {Support.TestStorage, :unsafe_cleanup!, ^shape_handle1}

      Process.sleep(100)

      # And deleting the shape that hasn't started cleans the handle
      {shape_handle2, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert shape_handle1 != shape_handle2
    end

    test "`purge_all_shapes?` cleans all known shapes and their handles", ctx do
      %{shape_cache_opts: opts} = ctx

      shape1 = @shape
      shape2 = %{@shape | selected_columns: ["id"]}

      {shape_handle1, _} = ShapeCache.get_or_create_shape_handle(shape1, opts)
      {shape_handle2, _} = ShapeCache.get_or_create_shape_handle(shape2, opts)

      assert {:ok, found} = Electric.ShapeCache.Storage.get_all_stored_shapes(ctx.storage)
      assert map_size(found) == 2

      restart_shape_cache(ctx, purge_all_shapes?: true)

      assert {:ok, found} = Electric.ShapeCache.Storage.get_all_stored_shapes(ctx.storage)
      assert map_size(found) == 0

      # and asking for a shape handle should now get us a new one
      {shape_handle3, _} = ShapeCache.get_or_create_shape_handle(shape1, opts)
      {shape_handle4, _} = ShapeCache.get_or_create_shape_handle(shape2, opts)
      assert shape_handle1 != shape_handle3
      assert shape_handle2 != shape_handle4
    end

    defp restart_shape_cache(context, opts \\ []) do
      stop_shape_cache(context)

      context = Map.merge(context, with_shape_log_collector(context))

      with_shape_cache(
        Map.put(context, :inspector, @stub_inspector),
        Keyword.merge(opts,
          create_snapshot_fn: fn parent, shape_handle, _shape, _, storage, _, _ ->
            GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
            Storage.make_new_snapshot!([["test"]], storage)
            GenServer.cast(parent, {:snapshot_started, shape_handle})
          end
        )
      )
    end

    defp stop_shape_cache(ctx) do
      %{shape_cache: {shape_cache, shape_cache_opts}} = ctx

      consumers =
        for {shape_handle, _} <- shape_cache.list_shapes(Map.new(shape_cache_opts)) do
          pid = Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
          {pid, Process.monitor(pid)}
        end

      if Enum.count(consumers) > 0 do
        Shapes.DynamicConsumerSupervisor.stop_all_consumers(ctx.consumer_supervisor)
      end

      for {pid, ref} <- consumers do
        assert_receive {:DOWN, ^ref, :process, ^pid, _}
      end

      stop_processes([
        shape_cache_opts[:server],
        ctx.shape_log_collector,
        ctx.consumer_supervisor
      ])
    end

    defp stop_processes(process_names) do
      processes =
        for name <- process_names, pid = GenServer.whereis(name) do
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

  def run_with_conn_noop(conn, cb), do: cb.(conn)

  defp stream_to_list(stream, sort_col \\ "value") do
    stream
    |> Enum.map(&Jason.decode!/1)
    |> Enum.sort_by(fn %{"value" => value} -> value[sort_col] end)
  end
end
