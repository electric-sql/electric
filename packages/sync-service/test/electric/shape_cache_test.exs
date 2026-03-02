defmodule Electric.ShapeCacheTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit, assert_expectations: true

  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes.TransactionFragment
  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache
  alias Electric.ShapeCache.{Storage, ShapeStatus}
  alias Electric.Shapes
  alias Electric.Shapes.Shape

  import ExUnit.CaptureLog
  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup

  import Support.TestUtils,
    only: [activate_mocks_for_descendant_procs: 1, assert_shape_cleanup: 1]

  @stub_inspector Support.StubInspector.new(
                    tables: [{1, {"public", "items"}}, {2, {"public", "other_table"}}],
                    columns: [
                      %{
                        name: "id",
                        type: "int8",
                        type_id: {20, 1},
                        pk_position: 0,
                        is_generated: false
                      },
                      %{name: "value", type: "text", type_id: {25, 1}, is_generated: false}
                    ]
                  )
  @shape Shape.new!("items", inspector: @stub_inspector)
  @shape_with_subquery Shape.new!("items",
                         inspector: @stub_inspector,
                         where: "id IN (SELECT id FROM public.other_table)"
                       )
  @lsn Electric.Postgres.Lsn.from_integer(13)
  @change_offset LogOffset.new(@lsn, 2)
  @xid 99
  @change Changes.fill_key(
            %Changes.NewRecord{
              relation: {"public", "items"},
              record: %{"id" => "123", "value" => "Test"},
              log_offset: @change_offset
            },
            ["id"]
          )

  @zero_offset LogOffset.last_before_real_offsets()

  # {xmin, xmax, xip_list}
  @pg_snapshot_xmin_10 {10, 11, [10]}
  @pg_snapshot_xmin_100 {100, 101, [100]}

  @moduletag :tmp_dir

  setup do
    %{inspector: @stub_inspector, pool: nil}
  end

  setup [
    :with_persistent_kv,
    :with_stack_id_from_test,
    :with_async_deleter,
    :with_pure_file_storage,
    :with_shape_status,
    :with_lsn_tracker,
    :with_shape_cleaner,
    :with_status_monitor
  ]

  describe "get_or_create_shape_handle/2" do
    setup do
      Support.TestUtils.patch_snapshotter(fn _, _, _, _ -> nil end)
    end

    setup [
      :with_noop_publication_manager,
      :with_log_chunking,
      :with_no_pool,
      :with_registry,
      :with_shape_log_collector,
      :with_shape_cache
    ]

    test "creates a new shape_handle", ctx do
      {shape_handle, @zero_offset} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
      assert is_binary(shape_handle)
      wait_shape_init(shape_handle, ctx)
    end

    test "returns existing shape_handle", ctx do
      {shape_handle1, @zero_offset} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
      {shape_handle2, @zero_offset} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
      assert shape_handle1 == shape_handle2
      wait_shape_init(shape_handle1, ctx)
    end

    test "should not return the same shape_handle for different shapes despite hash collision",
         ctx do
      alias Electric.Replication.Eval.Parser

      shape1 = @shape

      shape2 = %{
        @shape
        | where: Parser.parse_and_validate_expression!("id = 2", refs: %{["id"] => :int8})
      }

      # We're forcing a hash collision here via a patch to avoid writing a brittle test.
      Repatch.patch(Shape, :hash, [mode: :shared], fn _ -> 1234 end)
      Repatch.allow(self(), GenServer.whereis(ShapeCache.name(ctx.stack_id)))

      # Ensure there's a collision
      assert Shape.hash(shape1) == Shape.hash(shape2)

      {shape_handle1, @zero_offset} = ShapeCache.get_or_create_shape_handle(shape1, ctx.stack_id)
      {shape_handle2, @zero_offset} = ShapeCache.get_or_create_shape_handle(shape2, ctx.stack_id)

      assert shape_handle1 != shape_handle2
      wait_shape_init([shape_handle1, shape_handle2], ctx)
    end

    test "should not return the same shape_handle for all columns and selected columns", ctx do
      alias Electric.Replication.Eval.Parser

      shape1 = @shape

      shape2 = Shape.new!("items", inspector: @stub_inspector, columns: ["id", "value"])

      {shape_handle2, @zero_offset} = ShapeCache.get_or_create_shape_handle(shape2, ctx.stack_id)
      {shape_handle1, @zero_offset} = ShapeCache.get_or_create_shape_handle(shape1, ctx.stack_id)

      assert shape_handle1 != shape_handle2

      assert {^shape_handle2, @zero_offset} =
               ShapeCache.get_or_create_shape_handle(shape2, ctx.stack_id)

      wait_shape_init([shape_handle1, shape_handle2], ctx)
    end
  end

  describe "get_or_create_shape_handle/2 shape initialization" do
    setup [
      :with_noop_publication_manager,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector
    ]

    test "creates initial snapshot if one doesn't exist", %{storage: storage} = ctx do
      Support.TestUtils.patch_snapshotter(fn parent,
                                             shape_handle,
                                             _shape,
                                             %{snapshot_fun: snapshot_fun} ->
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
        snapshot_fun.([["test"]])
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      with_shape_cache(ctx)

      {shape_handle, offset} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
      assert offset == @zero_offset
      assert :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)
      Process.sleep(100)
      shape_storage = Storage.for_shape(shape_handle, storage)
      assert Storage.snapshot_started?(shape_storage)
    end

    test "triggers table prep and snapshot creation only once", ctx do
      test_pid = self()

      Support.TestUtils.patch_snapshotter(fn parent,
                                             shape_handle,
                                             _shape,
                                             %{snapshot_fun: snapshot_fun} ->
        send(test_pid, {:called, :create_snapshot_fn})
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
        snapshot_fun.([["test"]])
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      Support.TestUtils.patch_calls(Electric.Replication.PublicationManager,
        wait_for_restore: fn _, _ ->
          send(test_pid, {:called, :wait_for_restore})
          :ok
        end,
        add_shape: fn _handle, _shape, _opts ->
          send(test_pid, {:called, :prepare_tables_fn})
          :ok
        end
      )

      Support.TestUtils.activate_mocks_for_descendant_procs(Electric.Shapes.Consumer.Snapshotter)
      Support.TestUtils.activate_mocks_for_descendant_procs(Electric.ShapeCache)

      with_shape_cache(ctx)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)

      # subsequent calls return the same shape_handle
      for _ <- 1..10,
          do:
            assert(
              {^shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
            )

      assert :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      assert_received {:called, :wait_for_restore}
      assert_received {:called, :prepare_tables_fn}
      assert_received {:called, :create_snapshot_fn}
      refute_received {:called, _}
    end

    test "triggers table prep and snapshot creation only once even with queued requests", ctx do
      test_pid = self()

      Support.TestUtils.patch_snapshotter(fn parent,
                                             shape_handle,
                                             _shape,
                                             %{snapshot_fun: snapshot_fun} ->
        send(test_pid, {:called, :create_snapshot_fn})
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
        snapshot_fun.([["test"]])
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      with_shape_cache(ctx)

      link_pid = GenServer.whereis(ShapeCache.name(ctx.stack_id))

      assert is_pid(link_pid)

      # suspend the genserver to simulate message queue buildup
      :sys.suspend(link_pid)

      create_call_1 =
        Task.async(fn ->
          {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
          shape_handle
        end)

      create_call_2 =
        Task.async(fn ->
          {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
          shape_handle
        end)

      # resume the genserver and assert both queued tasks return the same shape_handle
      :sys.resume(link_pid)
      shape_handle = Task.await(create_call_1)
      assert shape_handle == Task.await(create_call_2)

      assert :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      # any queued calls should still return the existing shape_handle
      # after the snapshot has been created (simulated by directly
      # calling GenServer)
      assert {^shape_handle, _} =
               GenServer.call(link_pid, {:create_or_wait_shape_handle, @shape, nil})

      assert_received {:called, :create_snapshot_fn}
    end

    test "shape gets cleaned up if terminated unexpectedly", %{storage: storage} = ctx do
      Support.TestUtils.patch_snapshotter(fn _, _, _, _ -> nil end)
      with_shape_cache(ctx)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)

      consumer_pid = Electric.Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      consumer_ref = Process.monitor(consumer_pid)
      Process.exit(consumer_pid, :some_reason)

      assert_receive {:DOWN, ^consumer_ref, :process, _pid, :some_reason}

      assert_shape_cleanup(shape_handle)

      # should have cleaned up the shape
      assert :error == ShapeStatus.fetch_shape_by_handle(ctx.stack_id, shape_handle)

      assert {:ok, found} =
               Electric.ShapeCache.Storage.get_all_stored_shape_handles(storage)

      assert MapSet.size(found) == 0
    end
  end

  describe "get_or_create_shape_handle/2 against real db" do
    setup [
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

    setup ctx do
      # Stub out the shape relation cleaning as we are using a stub inspector
      # and thus our shapes are always using "missing" relations
      Repatch.patch(
        Electric.ShapeCache.ShapeCleaner,
        :remove_shapes_for_relations,
        [mode: :shared],
        fn _, _ -> :ok end
      )

      {_, pub_man_opts} = ctx.publication_manager

      Repatch.allow(self(), pub_man_opts[:server])

      :ok
    end

    setup %{pool: pool} do
      Repatch.patch(Electric.Connection.Manager, :snapshot_pool, [mode: :shared], fn _stack_id ->
        pool
      end)

      Support.TestUtils.activate_mocks_for_descendant_procs(Electric.Shapes.Consumer)
      Support.TestUtils.activate_mocks_for_descendant_procs(Electric.Shapes.Consumer.Snapshotter)

      Postgrex.query!(pool, "INSERT INTO items (id, value) VALUES ($1, $2), ($3, $4)", [
        Ecto.UUID.dump!("721ae036-e620-43ee-a3ed-1aa3bb98e661"),
        "test1",
        Ecto.UUID.dump!("721ae036-e620-43ee-a3ed-1aa3bb98e662"),
        "test2"
      ])

      :ok
    end

    setup %{inspector: inspector} do
      %{shape: Shape.new!("items", inspector: inspector)}
    end

    test "creates initial snapshot from DB data",
         %{
           storage: storage,
           shape: shape,
           stack_id: stack_id
         } do
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(shape, stack_id)

      assert :started = ShapeCache.await_snapshot_start(shape_handle, stack_id)
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
      shape: shape,
      stack_id: stack_id
    } do
      shape = %{shape | selected_columns: ~w|id value date timestamptz float bytea interval|}

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

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(shape, stack_id)
      assert :started = ShapeCache.await_snapshot_start(shape_handle, stack_id)
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

    test "correctly propagates the error", %{shape: shape} = ctx do
      shape = %{
        shape
        | root_table: {"public", "nonexistent"},
          root_table_id: 2
      }

      {shape_handle, log} =
        with_log(fn ->
          {shape_handle, _} = ShapeCache.get_or_create_shape_handle(shape, ctx.stack_id)

          assert {:error, %Electric.SnapshotError{type: :schema_changed}} =
                   ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

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

      shape =
        Shape.new!(
          "partitioned_items",
          columns: ["a", "b"],
          inspector: ctx.inspector
        )

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(shape, ctx.stack_id)
      assert :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)
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

    @tag stack_config_seed: [snapshot_timeout_to_first_data: 500]
    test "crashes when initial snapshot query fails to return data quickly enough", %{
      shape: shape,
      stack_id: stack_id
    } do
      alias Electric.Replication.Eval.Parser
      where_clause = Parser.parse_and_validate_expression!("TRUE", refs: %{})
      # Insert a fake slow query
      where_clause = %{where_clause | query: "PG_SLEEP(2)::text ILIKE ''"}
      shape = %{shape | where: where_clause}

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(shape, stack_id)

      assert {:error, %Electric.SnapshotError{type: :slow_snapshot_query}} =
               ShapeCache.await_snapshot_start(shape_handle, stack_id)
    end
  end

  describe "list_shapes/1" do
    setup [
      :with_noop_publication_manager,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector
    ]

    test "returns empty list initially", ctx do
      with_shape_cache(ctx)
      assert ShapeCache.list_shapes(ctx.stack_id) == []
    end

    test "lists the shape as active once there is a snapshot", ctx do
      Support.TestUtils.patch_snapshotter(fn parent,
                                             shape_handle,
                                             _shape,
                                             %{snapshot_fun: snapshot_fun} ->
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
        snapshot_fun.([["test"]])
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      with_shape_cache(ctx)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
      assert :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      assert [{^shape_handle, @shape}] = ShapeCache.list_shapes(ctx.stack_id)
    end

    test "lists the shape even if we don't know xmin", ctx do
      test_pid = self()

      Support.TestUtils.patch_snapshotter(fn parent,
                                             shape_handle,
                                             _shape,
                                             %{snapshot_fun: snapshot_fun} ->
        ref = make_ref()
        send(test_pid, {:waiting_point, ref, self()})
        receive(do: ({:continue, ^ref} -> :ok))
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
        snapshot_fun.([["test"]])
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      with_shape_cache(ctx)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)

      # Wait until we get to the waiting point in the snapshot
      assert_receive {:waiting_point, ref, pid}

      assert [{^shape_handle, @shape}] = ShapeCache.list_shapes(ctx.stack_id)

      send(pid, {:continue, ref})

      assert :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)
      assert [{^shape_handle, @shape}] = ShapeCache.list_shapes(ctx.stack_id)
    end
  end

  describe "count_shapes/1" do
    setup [
      :with_noop_publication_manager,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_shape_cache
    ]

    test "returns the correct count of shapes", ctx do
      Support.TestUtils.patch_snapshotter(fn parent, shape_handle, _, _ ->
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_100})
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      num_shapes = :rand.uniform(100)

      handles =
        Enum.map(1..num_shapes, fn i ->
          Shape.new!("items", inspector: @stub_inspector, where: "id = #{i}")
          |> ShapeCache.get_or_create_shape_handle(ctx.stack_id)
          |> elem(0)
        end)

      assert num_shapes == ShapeCache.count_shapes(ctx.stack_id)

      wait_shape_init(handles, ctx)
    end
  end

  describe "has_shape?/2" do
    setup [
      :with_noop_publication_manager,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_shape_cache
    ]

    test "returns true for known shape handle", ctx do
      Support.TestUtils.patch_snapshotter(fn parent, shape_handle, _, _ ->
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_100})
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      refute ShapeCache.has_shape?("some-random-id", ctx.stack_id)
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
      assert :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)
      assert ShapeCache.has_shape?(shape_handle, ctx.stack_id)

      wait_shape_init(shape_handle, ctx)
    end

    test "works with slow snapshot generation", ctx do
      Support.TestUtils.patch_snapshotter(fn parent, shape_handle, _, _ ->
        Process.sleep(100)
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_100})
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
      assert ShapeCache.has_shape?(shape_handle, ctx.stack_id)

      wait_shape_init(shape_handle, ctx)
    end
  end

  describe "await_snapshot_start/4" do
    setup do
      activate_mocks_for_descendant_procs(Electric.ShapeCache)
    end

    setup [
      :with_noop_publication_manager,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_shape_cache
    ]

    test "returns :started for snapshots that have started", ctx do
      Support.TestUtils.patch_snapshotter(fn parent, shape_handle, _, _ ->
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_100})
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)

      assert ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id) == :started
    end

    test "returns an error if waiting is for an unknown shape handle", ctx do
      shape_handle = "orphaned_handle"
      storage = Storage.for_shape(shape_handle, ctx.storage)

      Support.TestUtils.patch_snapshotter(fn parent,
                                             shape_handle,
                                             _shape,
                                             %{snapshot_fun: snapshot_fun} ->
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
        snapshot_fun.([["test"]])
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      assert {:error, :unknown} = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      refute Storage.snapshot_started?(storage)
    end

    test "handles buffering multiple callers correctly", ctx do
      test_pid = self()

      Support.TestUtils.patch_snapshotter(fn parent,
                                             shape_handle,
                                             _shape,
                                             %{snapshot_fun: snapshot_fun} ->
        ref = make_ref()
        send(test_pid, {:waiting_point, ref, self()})
        receive(do: ({:continue, ^ref} -> :ok))
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})

        # Sometimes only some tasks subscribe before reaching this point, and then hang
        # if we don't actually have a snapshot. This is kind of part of the test, because
        # `await_snapshot_start/3` should always resolve to `:started` in concurrent situations
        GenServer.cast(parent, {:snapshot_started, shape_handle})
        snapshot_fun.([[1], [2]])
      end)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)

      storage = Storage.for_shape(shape_handle, ctx.storage)

      tasks =
        for _id <- 1..10 do
          Task.async(fn ->
            assert :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

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

    @tag :slow
    test "errors while streaming from database are sent to all callers", ctx do
      test_pid = self()
      ref = make_ref()

      # this little dance is to try to quickly interrupt the snapshot process
      # at the point where the filesystem storage tries to open its first
      # snapshot file
      stream_from_database =
        Stream.map(1..10, fn
          1 ->
            send(test_pid, {:stream_start, self()})
            receive(do: ({:continue, ^ref} -> :ok))
            raise "some error"
        end)

      Support.TestUtils.patch_snapshotter(fn parent,
                                             shape_handle,
                                             _shape,
                                             %{snapshot_fun: snapshot_fun} ->
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
        GenServer.cast(parent, {:snapshot_started, shape_handle})

        snapshot_fun.(stream_from_database)
      end)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)

      storage = Storage.for_shape(shape_handle, ctx.storage)

      task_pids =
        for n <- 1..10 do
          start_supervised!(
            Supervisor.child_spec(
              {Task,
               fn ->
                 :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

                 stream =
                   Storage.get_log_stream(
                     LogOffset.before_all(),
                     LogOffset.last_before_real_offsets(),
                     storage
                   )

                 # this no longer errors because we're handling the removal of the shape
                 # data in the storage
                 send(test_pid, {:read_start, n})
                 receive(do: (:continue -> n))

                 stream
                 |> Stream.transform(
                   fn -> n end,
                   fn elem, acc -> {[elem], acc} end,
                   fn _ -> :ok end
                 )
                 |> Stream.run()
               end},
              id: "task_#{n}",
              restart: :temporary
            )
          )
        end

      assert_receive {:stream_start, stream_pid}

      for n <- 1..10, do: assert_receive({:read_start, ^n})

      for pid <- task_pids, do: send(pid, :continue)

      send(stream_pid, {:continue, ref})

      now = System.monotonic_time(:millisecond)

      for pid <- task_pids do
        ref = Process.monitor(pid)
        time_to_wait = 10_000 - (System.monotonic_time(:millisecond) - now)
        assert_receive {:DOWN, ^ref, :process, ^pid, _reason}, time_to_wait
      end

      assert_shape_cleanup(shape_handle)
    end

    test "propagates error in snapshot creation to listeners", ctx do
      test_pid = self()

      Support.TestUtils.patch_snapshotter(fn parent, shape_handle, _shape, _ ->
        ref = make_ref()
        send(test_pid, {:waiting_point, ref, self()})
        receive(do: ({:continue, ^ref} -> :ok))
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})

        GenServer.cast(
          parent,
          {:snapshot_failed, shape_handle, %Electric.SnapshotError{message: "expected error"}}
        )
      end)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)

      task = Task.async(ShapeCache, :await_snapshot_start, [shape_handle, ctx.stack_id])

      consumer_pid = GenServer.whereis(Electric.Shapes.Consumer.name(ctx.stack_id, shape_handle))
      await_for_consumer_to_have_waiters(consumer_pid)

      assert_receive {:waiting_point, ref, pid}
      send(pid, {:continue, ref})

      assert {:error, %Electric.SnapshotError{message: "expected error"}} = Task.await(task)
    end

    test "should stop awaiting if shape process dies unexpectedly", ctx do
      Support.TestUtils.patch_snapshotter(fn _, _, _, _ -> nil end)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)

      task =
        Task.async(fn ->
          try do
            ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)
          catch
            :exit, {:some_reason, _} -> {:error, {:exited_with_reason, :some_reason}}
          end
        end)

      Process.exit(Electric.Shapes.Consumer.whereis(ctx.stack_id, shape_handle), :some_reason)

      # should not be able to find the shape anymore
      assert {:error, error} = Task.await(task)

      # This handles 3 different race conditions:
      # 1. The exit happens right as we're in the GenServer.call, and gets propagated to the caller
      # 2. The exit happens earlier than the task starts, so we're at noproc and `await_snapshot_start`
      #    returns `:unknown`
      # 3. The exit happens after the consumer is fully started, which gives us "snapshot waiters"
      #    path handling with "nice errors"
      assert error in [
               {:exited_with_reason, :some_reason},
               :unknown,
               "Shape terminated before snapshot was ready"
             ]
    end

    test "does not recursively loop forever if the snapshot fails to start", ctx do
      # Reproduce the scenario from GitHub issue #3844:
      # 1. Shape exists in ShapeStatus with snapshot_started = false
      # 2. No consumer process for the shape is running.
      # 3. await_snapshot_start retries forever in the :noproc catch clause

      # Patch snapshotter to never complete the snapshot
      Support.TestUtils.patch_snapshotter(fn _, _, _, _ -> nil end)

      {shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_subquery, ctx.stack_id)

      {:ok, shape} = ShapeCache.fetch_shape_by_handle(shape_handle, ctx.stack_id)
      [subshape_handle] = shape.shape_dependencies_handles

      consumer_pid = Electric.Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid) and Process.alive?(consumer_pid)

      subconsumer_pid = Electric.Shapes.Consumer.whereis(ctx.stack_id, subshape_handle)
      assert is_pid(subconsumer_pid) and Process.alive?(subconsumer_pid)

      # Verify preconditions: snapshot hasn't started, shape exists in ShapeStatus
      refute ShapeStatus.snapshot_started?(ctx.stack_id, shape_handle)
      assert ShapeStatus.has_shape_handle?(ctx.stack_id, shape_handle)

      # Stop the consumer. The stale entry in ShapeStatus remains, though.
      ref = Process.monitor(consumer_pid)
      # We have to use the reason :kill here because consumer process traps exits. And since
      # it's stuck waiting on the Materializer process to finish initialization (which in turn
      # is stuck waiting on the snapshot start), the consumer process won't handle any other
      # exit reason in a timely manner.
      Process.exit(consumer_pid, :kill)
      assert_receive {:DOWN, ^ref, :process, ^consumer_pid, _}, 1_000

      assert ShapeStatus.has_shape_handle?(ctx.stack_id, shape_handle)
      refute ShapeStatus.snapshot_started?(ctx.stack_id, shape_handle)

      # Now call await_snapshot_start and verify that it doesn't loop forever.
      task =
        Task.async(fn ->
          ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)
        end)

      # Let the task run for one second which should result in approx. 20 recursive calls. But
      # since the cutoff point inside the ShapeCache.await_snapshot_start() function is at 10
      # attempts, we are expecting the task to return here.
      log = capture_log(fn -> assert {:ok, {:error, :unknown}} = Task.yield(task, 1000) end)

      assert String.contains?(
               log,
               "[error] No consumer process when waiting on initial snapshot creation for #{shape_handle}"
             )

      assert_receive {ShapeCache.ShapeCleaner, :cleanup, ^shape_handle}
      assert_receive {ShapeCache.ShapeCleaner, :cleanup, ^subshape_handle}
    end

    test "should wait for consumer to come up", ctx do
      Support.TestUtils.patch_snapshotter(fn parent, shape_handle, _, _ ->
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_100})
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      start_consumer_delay = 300

      test_pid = self()

      Repatch.patch(
        Electric.Shapes.DynamicConsumerSupervisor,
        :start_shape_consumer,
        [mode: :shared],
        fn a, b ->
          send(test_pid, :about_to_start_consumer)

          Process.sleep(start_consumer_delay)
          Repatch.real(Electric.Shapes.DynamicConsumerSupervisor.start_shape_consumer(a, b))
        end
      )

      activate_mocks_for_descendant_procs(Electric.ShapeCache)

      creation_task =
        Task.async(fn -> ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id) end)

      {shape_handle, _} =
        receive do
          :about_to_start_consumer -> ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
        end

      wait_task =
        Task.async(fn -> ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id) end)

      # should delay in responding
      refute Task.yield(wait_task, 10)
      Task.await(creation_task)
      assert :started = Task.await(wait_task, start_consumer_delay)
    end

    test "should not loop forever waiting for consumer to come up", ctx do
      Support.TestUtils.patch_snapshotter(fn parent, shape_handle, _, _ ->
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_100})
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      start_consumer_delay = 1000

      test_pid = self()

      Repatch.patch(
        Electric.Shapes.DynamicConsumerSupervisor,
        :start_shape_consumer,
        [mode: :shared],
        fn a, b ->
          send(test_pid, :about_to_start_consumer)

          Process.sleep(start_consumer_delay)
          Repatch.real(Electric.Shapes.DynamicConsumerSupervisor.start_shape_consumer(a, b))
        end
      )

      activate_mocks_for_descendant_procs(Electric.ShapeCache)

      _creation_task =
        Task.async(fn -> ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id) end)

      {shape_handle, _} =
        receive do
          :about_to_start_consumer -> ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
        end

      wait_task =
        Task.async(fn -> ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id) end)

      # should delay in responding
      refute Task.yield(wait_task, 400)

      log =
        capture_log(fn ->
          assert {:error,
                  %Electric.SnapshotError{
                    message: "Snapshot query took too long to start reading from the database",
                    type: :slow_snapshot_start,
                    original_error: nil
                  }} == Task.await(wait_task)
        end)

      assert String.contains?(
               log,
               "[warning] Exhausted retry attempts while waiting for a shape consumer to start initial snapshot creation for #{shape_handle}"
             )
    end

    test "should stop waiting for consumer to come up if shape tables missing", ctx do
      test_pid = self()

      Repatch.patch(
        Electric.Shapes.DynamicConsumerSupervisor,
        :start_shape_consumer,
        [mode: :shared],
        fn _, _ ->
          send(test_pid, :about_to_start_consumer)
          Process.sleep(:infinity)
        end
      )

      start_supervised(
        {Task, fn -> ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id) end}
      )

      {shape_handle, _} =
        receive do
          :about_to_start_consumer -> ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
        after
          1_000 -> flunk("No consumer process started")
        end

      wait_task =
        Task.async(fn -> ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id) end)

      # should delay in responding
      refute Task.yield(wait_task, 10)
      stop_supervised(ctx[:shape_status_owner])

      assert {:error, %RuntimeError{message: "Shape meta tables not found"}} =
               Task.await(wait_task, 500)
    end
  end

  describe "after restart" do
    setup [
      :with_noop_publication_manager,
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_no_pool
    ]

    setup ctx do
      snapshot_data = ctx[:snapshot_data] || []

      Support.TestUtils.patch_snapshotter(fn parent,
                                             shape_handle,
                                             _shape,
                                             %{snapshot_fun: snapshot_fun} ->
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
        snapshot_fun.(snapshot_data)
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      with_shape_cache(ctx)
    end

    test "restores shape_handles", ctx do
      {shape_handle1, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle1, ctx.stack_id)
      restart_shape_cache(ctx)
      {shape_handle2, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle2, ctx.stack_id)
      assert shape_handle1 == shape_handle2
    end

    test "waits until publication filters are restored", ctx do
      {shape_handle1, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle1, ctx.stack_id)

      test_pid = self()

      Support.TestUtils.patch_calls(Electric.Replication.PublicationManager,
        wait_for_restore: fn _, _ ->
          send(test_pid, {:called, :wait_for_restore})
          :ok
        end
      )

      Support.TestUtils.activate_mocks_for_descendant_procs(Electric.ShapeCache)

      restart_shape_cache(ctx)

      assert_receive {:called, :wait_for_restore}

      {shape_handle2, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
      assert shape_handle1 == shape_handle2
      :started = ShapeCache.await_snapshot_start(shape_handle2, ctx.stack_id)
    end

    test "restores latest offset", ctx do
      offset = @change_offset
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      ref = Shapes.Consumer.register_for_changes(ctx.stack_id, shape_handle)

      ShapeLogCollector.handle_event(
        transaction(@xid, @lsn, [@change]),
        ctx.stack_id
      )

      assert_receive {^ref, :new_changes, ^offset}

      {^shape_handle, ^offset} = ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)

      # without this sleep, this test becomes unreliable due to
      # delays in persisting data to storage.
      Process.sleep(10)

      restart_shape_cache(ctx)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      assert {^shape_handle, ^offset} =
               ShapeCache.get_or_create_shape_handle(@shape, ctx.stack_id)
    end

    test "restores shapes with subqueries and their materializers", ctx do
      {shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_subquery, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      assert [{dep_handle, _}, {^shape_handle, _}] = ShapeCache.list_shapes(ctx.stack_id)

      # Materializer should be started
      assert Process.alive?(
               GenServer.whereis(
                 Electric.Shapes.Consumer.Materializer.name(ctx.stack_id, dep_handle)
               )
             )

      # Register this test as the connection manager to get "consumers ready" notification
      restart_shape_cache(ctx)

      assert [{^dep_handle, _}, {^shape_handle, _}] = ShapeCache.list_shapes(ctx.stack_id)
    end

    test "restores shapes with subqueries and their materializers when backup missing", ctx do
      {shape_handle, _} =
        ShapeCache.get_or_create_shape_handle(@shape_with_subquery, ctx.stack_id)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      assert [{dep_handle, _}, {^shape_handle, _}] = ShapeCache.list_shapes(ctx.stack_id)

      # Materializer should be started
      assert Process.alive?(
               GenServer.whereis(
                 Electric.Shapes.Consumer.Materializer.name(ctx.stack_id, dep_handle)
               )
             )

      restart_shape_cache(ctx)

      assert [{^dep_handle, _}, {^shape_handle, _}] = ShapeCache.list_shapes(ctx.stack_id)
    end

    defp restart_shape_cache(ctx, opts \\ []) do
      stop_shape_cache(ctx)

      with_lsn_tracker(ctx)

      ctx =
        ctx
        |> Map.merge(with_shape_status(ctx))
        |> Map.merge(with_shape_log_collector(ctx))

      with_shape_cache(ctx, opts)
    end

    defp stop_shape_cache(ctx) do
      for name <-
            [
              ctx.shape_cache,
              ctx.consumer_supervisor,
              ctx.shape_log_collector,
              ctx.shape_status_owner,
              ctx.shape_db,
              "shape_task_supervisor"
            ] do
        :ok = stop_supervised(name)
      end
    end
  end

  describe "start_consumer_for_handle/2" do
    setup [
      :with_noop_publication_manager,
      :with_log_chunking,
      :with_registry,
      :with_lsn_tracker,
      :with_shape_log_collector,
      :with_no_pool
    ]

    setup ctx do
      snapshot_data = ctx[:snapshot_data] || []

      Support.TestUtils.patch_snapshotter(fn parent,
                                             shape_handle,
                                             _shape,
                                             %{snapshot_fun: snapshot_fun} ->
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
        snapshot_fun.(snapshot_data)
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      with_shape_cache(ctx)
    end

    test "starts a consumer plus dependencies", ctx do
      %{stack_id: stack_id} = ctx

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape_with_subquery, stack_id)
      :started = ShapeCache.await_snapshot_start(shape_handle, stack_id)

      assert [{dep_handle, _}, {^shape_handle, _}] = ShapeCache.list_shapes(stack_id)

      # Materializer should be started
      assert Process.alive?(
               GenServer.whereis(Electric.Shapes.Consumer.Materializer.name(stack_id, dep_handle))
             )

      # Register this test as the connection manager to get "consumers ready" notification
      restart_shape_cache(ctx)

      assert [{^dep_handle, _}, {^shape_handle, _}] = ShapeCache.list_shapes(stack_id)

      refute Electric.Shapes.ConsumerRegistry.whereis(stack_id, shape_handle)
      refute Electric.Shapes.ConsumerRegistry.whereis(stack_id, dep_handle)

      refute GenServer.whereis(Electric.Shapes.Consumer.Materializer.name(stack_id, dep_handle))

      assert {:ok, _pid1} = ShapeCache.start_consumer_for_handle(shape_handle, stack_id)

      # Materializer should be started
      assert Process.alive?(
               GenServer.whereis(Electric.Shapes.Consumer.Materializer.name(stack_id, dep_handle))
             )
    end
  end

  defp stream_to_list(stream, sort_col \\ "value") do
    stream
    |> Enum.map(&Jason.decode!/1)
    |> Enum.filter(fn decoded -> Map.has_key?(decoded, "value") end)
    |> Enum.sort_by(fn %{"value" => value} -> value[sort_col] end)
  end

  defp await_for_consumer_to_have_waiters(consumer, num_attempts \\ 3)

  defp await_for_consumer_to_have_waiters(_consumer, 0) do
    raise "No process started waiting on shape in time"
  end

  defp await_for_consumer_to_have_waiters(consumer, num_attempts) do
    # We're looking up the process state directly here to be sure that the consumer has waiters
    # on the snapshot before proceeding with the snapshot failure simulation. This adds
    # coupling to the implementation of the consumer module but, on the other hand, it does
    # prevent flake we used to see here.
    case :sys.get_state(consumer).initial_snapshot_state.awaiting_snapshot_start do
      [] ->
        Process.sleep(50)
        await_for_consumer_to_have_waiters(consumer, num_attempts - 1)

      other ->
        other
    end
  end

  # prevent errors from consumers trying to register themselves with a consumer
  # registry that's been shutdown
  defp wait_shape_init(shape_handles, %{stack_id: stack_id}) do
    shape_handles
    |> List.wrap()
    |> wait_snapshot()
    |> Enum.map(fn handle ->
      Task.async(fn ->
        Enum.reduce_while(1..1000, [], fn _, _ ->
          if _pid = Shapes.ConsumerRegistry.whereis(stack_id, handle) do
            {:halt, []}
          else
            Process.sleep(1)
            {:cont, []}
          end
        end)
      end)
    end)
    |> Task.await_many()
  end

  defp wait_snapshot(handles) do
    handles
    |> List.wrap()
    |> Enum.map(fn handle ->
      assert_receive {:snapshot, ^handle, _snapshotter_pid}
      handle
    end)
  end

  defp transaction(xid, lsn, changes) do
    [%{log_offset: last_log_offset} | _] = Enum.reverse(changes)

    %TransactionFragment{
      xid: xid,
      lsn: lsn,
      last_log_offset: last_log_offset,
      has_begin?: true,
      commit: %Changes.Commit{},
      changes: changes,
      affected_relations: MapSet.new(changes, & &1.relation)
    }
  end
end
