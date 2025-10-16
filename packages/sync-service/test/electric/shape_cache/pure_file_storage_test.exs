defmodule Electric.ShapeCache.PureFileStorageTest do
  use ExUnit.Case, async: true

  import Support.ComponentSetup
  import Support.TestUtils

  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache.PureFileStorage
  import Electric.ShapeCache.PureFileStorage.SharedRecords, only: [storage_meta: 2]
  alias Electric.Shapes.Shape

  @moduletag :tmp_dir
  setup :with_stack_id_from_test

  @shape_handle "the-shape-handle"
  @shape %Shape{
    root_table: {"public", "items"},
    root_table_id: 1,
    root_pk: ["id"],
    selected_columns: ["id"],
    explicitly_selected_columns: ["id"],
    where:
      Electric.Replication.Eval.Parser.parse_and_validate_expression!("id != '1'",
        refs: %{["id"] => :text}
      )
  }

  setup ctx do
    base_opts =
      PureFileStorage.shared_opts(
        stack_id: ctx.stack_id,
        storage_dir: ctx.tmp_dir,
        chunk_bytes_threshold: ctx[:chunk_size] || 10 * 1024 * 1024,
        flush_period: ctx[:flush_period] || 1000
      )

    storage_base = {PureFileStorage, base_opts}
    start_link_supervised!(Storage.stack_child_spec(storage_base))

    %{base_opts: base_opts, opts: PureFileStorage.for_shape(@shape_handle, base_opts)}
  end

  describe "reads without writer -" do
    test "snapshot only reads from disk", %{opts: opts} do
      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([~S|{"test": 1}|, ~S|{"test": 2}|], opts)
      PureFileStorage.terminate(writer)

      assert PureFileStorage.get_log_stream(
               LogOffset.before_all(),
               LogOffset.last_before_real_offsets(),
               opts
             )
             |> Enum.to_list() == [~S|{"test": 1}|, ~S|{"test": 2}|]
    end

    test "active log reads", %{opts: opts} do
      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([], opts)

      writer =
        PureFileStorage.append_to_log!(
          [
            {LogOffset.new(10, 0), "test_key", :insert, ~S|{"test": 1}|},
            {LogOffset.new(11, 0), "test_key", :insert, ~S|{"test": 2}|}
          ],
          writer
        )

      # This deregisters the writer from the ETS
      PureFileStorage.terminate(writer)

      assert PureFileStorage.get_current_position(opts) ==
               {:ok, LogOffset.new(11, 0), %{xmin: 100}}

      assert PureFileStorage.get_log_stream(LogOffset.new(0, 0), LogOffset.last(), opts)
             |> Enum.to_list() == [~S|{"test": 1}|, ~S|{"test": 2}|]
    end
  end

  describe "key index writes" do
    test "are correct", %{opts: opts} do
      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([], opts)

      suffix = PureFileStorage.latest_name(opts)

      writer =
        PureFileStorage.append_to_log!(
          [
            {LogOffset.new(10, 0), "test_key", :insert, ~S|{"test":1}|},
            {LogOffset.new(11, 0), "test_key", :update, ~S|{"test":2}|},
            {LogOffset.new(12, 0), "test_key", :delete, ~S|{"test":2}|}
          ],
          writer
        )

      PureFileStorage.terminate(writer)

      key_file = PureFileStorage.key_file(opts, suffix)

      PureFileStorage.KeyIndex.create_from_log(
        PureFileStorage.json_file(opts, suffix),
        key_file
      )

      assert File.exists?(key_file)

      assert PureFileStorage.KeyIndex.read_key_file(PureFileStorage.key_file(opts, suffix)) == [
               {"test_key", LogOffset.new(10, 0), ?i, 0, byte_size(~S|{"test":1}|)},
               {"test_key", LogOffset.new(11, 0), ?u, 48, byte_size(~S|{"test":2}|)},
               {"test_key", LogOffset.new(12, 0), ?d, 96, byte_size(~S|{"test":2}|)}
             ]
    end

    @tag chunk_size: 5
    test "are correct with small chunks too", %{opts: opts} do
      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([], opts)

      writer =
        for i <- 1..10 do
          %Changes.UpdatedRecord{
            relation: {"public", "test_table"},
            old_record: %{"id" => "sameid", "name" => "Test#{i - 1}"},
            record: %{"id" => "sameid", "name" => "Test#{i}"},
            log_offset: LogOffset.new(i, 0),
            changed_columns: MapSet.new(["name"])
          }
        end
        |> changes_to_log_items()
        |> PureFileStorage.append_to_log!(writer)

      PureFileStorage.terminate(writer)

      key_file = PureFileStorage.key_file(opts, PureFileStorage.latest_name(opts))

      PureFileStorage.KeyIndex.create_from_log(
        PureFileStorage.json_file(opts, PureFileStorage.latest_name(opts)),
        key_file
      )

      assert File.exists?(key_file)

      assert PureFileStorage.KeyIndex.read_key_file(key_file) == [
               {"\"public\".\"test_table\"/\"sameid\"", LogOffset.new(1, 0), 117, 0, 191},
               {"\"public\".\"test_table\"/\"sameid\"", LogOffset.new(2, 0), 117, 251, 191},
               {"\"public\".\"test_table\"/\"sameid\"", LogOffset.new(3, 0), 117, 502, 191},
               {"\"public\".\"test_table\"/\"sameid\"", LogOffset.new(4, 0), 117, 753, 191},
               {"\"public\".\"test_table\"/\"sameid\"", LogOffset.new(5, 0), 117, 1004, 191},
               {"\"public\".\"test_table\"/\"sameid\"", LogOffset.new(6, 0), 117, 1255, 191},
               {"\"public\".\"test_table\"/\"sameid\"", LogOffset.new(7, 0), 117, 1506, 191},
               {"\"public\".\"test_table\"/\"sameid\"", LogOffset.new(8, 0), 117, 1757, 191},
               {"\"public\".\"test_table\"/\"sameid\"", LogOffset.new(9, 0), 117, 2008, 191},
               {"\"public\".\"test_table\"/\"sameid\"", LogOffset.new(10, 0), 117, 2259, 193}
             ]
    end
  end

  describe "chunk reads" do
    setup :with_started_writer

    @tag chunk_size: 100
    test "correctly finds a chunk to read from", %{writer: writer, opts: opts} do
      long_word = String.duplicate("0", 100)

      writer =
        PureFileStorage.append_to_log!(
          [
            {LogOffset.new(10, 0), "test_key", :insert, ~s|{"test":"#{long_word}1"}|},
            {LogOffset.new(11, 0), "test_key", :update, ~s|{"test":"#{long_word}2"}|},
            {LogOffset.new(12, 0), "test_key", :delete, ~s|{"test":"#{long_word}3"}|}
          ],
          writer
        )

      PureFileStorage.terminate(writer)

      assert PureFileStorage.ChunkIndex.read_chunk_file(
               PureFileStorage.chunk_file(opts, PureFileStorage.latest_name(opts))
             ) == [
               {{LogOffset.new(10, 0), LogOffset.new(10, 0)}, {0, 150}, {0, 0}},
               {{LogOffset.new(11, 0), LogOffset.new(11, 0)}, {150, 300}, {0, 0}},
               {{LogOffset.new(12, 0), LogOffset.new(12, 0)}, {300, 450}, {0, 0}}
             ]

      assert PureFileStorage.get_log_stream(LogOffset.new(9, 0), LogOffset.new(10, 0), opts)
             |> Enum.to_list() == [~s|{"test":"#{long_word}1"}|]

      assert PureFileStorage.get_log_stream(LogOffset.new(10, 0), LogOffset.new(11, 0), opts)
             |> Enum.to_list() == [~s|{"test":"#{long_word}2"}|]

      assert PureFileStorage.get_log_stream(LogOffset.new(11, 0), LogOffset.new(12, 0), opts)
             |> Enum.to_list() == [~s|{"test":"#{long_word}3"}|]
    end
  end

  describe "crash recovery" do
    # These tests make use of known log file structures to test that the storage recovers correctly
    # If underlying file structure changes, these tests will need to be updated.
    setup :with_started_writer

    setup %{writer: writer, opts: opts} = ctx do
      if Map.get(ctx, :init_log, true) do
        writer =
          PureFileStorage.append_to_log!(
            [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test":1}|}],
            writer
          )

        PureFileStorage.terminate(writer)

        assert PureFileStorage.get_current_position(opts) ==
                 {:ok, LogOffset.new(10, 0), %{xmin: 100}}
      end

      :ok
    end

    test "incomplete transaction write before crash is discarded", %{opts: opts} do
      # Transaction got partially flushed, but not "closed" i.e. persisted boundary wasn't updated
      File.open!(
        PureFileStorage.json_file(opts, PureFileStorage.latest_name(opts)),
        [:append, :raw],
        fn file ->
          json = Jason.encode!(%{test: 2})

          IO.binwrite(
            file,
            <<LogOffset.to_int128(LogOffset.new(11, 0))::binary, 4::32, "test"::binary, ?i::8,
              0::8, byte_size(json)::64, json::binary>>
          )
        end
      )

      writer = PureFileStorage.init_writer!(opts, @shape)

      assert PureFileStorage.get_current_position(opts) ==
               {:ok, LogOffset.new(10, 0), %{xmin: 100}}

      # After recovery we see the same line
      writer =
        PureFileStorage.append_to_log!(
          [
            {LogOffset.new(11, 0), "test", :insert, ~S|{"test":2}|},
            {LogOffset.new(12, 0), "test", :insert, ~S|{"test":3}|}
          ],
          writer
        )

      PureFileStorage.terminate(writer)

      assert [~S|{"test":1}|, ~S|{"test":2}|, ~S|{"test":3}|] =
               PureFileStorage.get_log_stream(
                 LogOffset.last_before_real_offsets(),
                 LogOffset.last(),
                 opts
               )
               |> Enum.to_list()
    end

    test "chunk boundary without an actual write is trimmed", %{opts: opts} do
      # Transaction got partially flushed, but not "closed" i.e. persisted boundary wasn't updated
      File.open!(
        PureFileStorage.chunk_file(opts, PureFileStorage.latest_name(opts)),
        [:append, :raw],
        fn file ->
          IO.binwrite(
            file,
            <<LogOffset.to_int128(LogOffset.new(20, 0))::binary, 100::64, 100::64>>
          )
        end
      )

      # And a partial write cut midline just for good measure
      File.open!(
        PureFileStorage.json_file(opts, PureFileStorage.latest_name(opts)),
        [:append, :raw],
        fn file ->
          IO.binwrite(
            file,
            <<LogOffset.to_int128(LogOffset.new(20, 0))::binary, 4::32, "test"::binary, ?i::8,
              0::8, 0::32>>
          )
        end
      )

      assert PureFileStorage.ChunkIndex.read_chunk_file(
               PureFileStorage.chunk_file(opts, PureFileStorage.latest_name(opts))
             ) == [
               {{LogOffset.new(10, 0), LogOffset.new(20, 0)}, {0, 100}, {0, 100}}
             ]

      writer = PureFileStorage.init_writer!(opts, @shape)

      assert PureFileStorage.get_current_position(opts) ==
               {:ok, LogOffset.new(10, 0), %{xmin: 100}}

      # After recovery we see the same line
      writer =
        PureFileStorage.append_to_log!(
          [
            {LogOffset.new(11, 0), "test", :insert, ~S|{"test":2}|},
            {LogOffset.new(12, 0), "test", :insert, ~S|{"test":3}|}
          ],
          writer
        )

      PureFileStorage.terminate(writer)
      assert PureFileStorage.get_chunk_end_log_offset(LogOffset.new(10, 0), opts) == nil

      assert [~S|{"test":1}|, ~S|{"test":2}|, ~S|{"test":3}|] =
               PureFileStorage.get_log_stream(
                 LogOffset.last_before_real_offsets(),
                 LogOffset.last(),
                 opts
               )
               |> Enum.to_list()

      assert PureFileStorage.ChunkIndex.read_chunk_file(
               PureFileStorage.chunk_file(opts, PureFileStorage.latest_name(opts))
             ) == [
               {{LogOffset.new(10, 0), nil}, {0, nil}, {0, nil}}
             ]
    end

    @tag init_log: false
    test "correctly handles incomplete chunks as part of the recovery", %{opts: opts} do
      path = PureFileStorage.chunk_file(opts, PureFileStorage.latest_name(opts))

      File.mkdir_p!(Path.dirname(path))

      File.open!(
        path,
        [:append, :raw],
        fn file ->
          IO.binwrite(
            file,
            <<LogOffset.to_int128(LogOffset.new(20, 0))::binary, 100::64, 100::64>>
          )
        end
      )

      writer = PureFileStorage.init_writer!(opts, @shape)

      assert PureFileStorage.get_current_position(opts) ==
               {:ok, LogOffset.new(0, 0), %{xmin: 100}}

      writer =
        PureFileStorage.append_to_log!(
          [
            {LogOffset.new(11, 0), "test", :insert, ~S|{"test":2}|},
            {LogOffset.new(12, 0), "test", :insert, ~S|{"test":3}|}
          ],
          writer
        )

      PureFileStorage.terminate(writer)
      assert PureFileStorage.get_chunk_end_log_offset(LogOffset.new(10, 0), opts) == nil

      assert [~S|{"test":2}|, ~S|{"test":3}|] =
               PureFileStorage.get_log_stream(
                 LogOffset.last_before_real_offsets(),
                 LogOffset.last(),
                 opts
               )
               |> Enum.to_list()

      assert PureFileStorage.ChunkIndex.read_chunk_file(
               PureFileStorage.chunk_file(opts, PureFileStorage.latest_name(opts))
             ) == [
               {{LogOffset.new(11, 0), nil}, {0, nil}, {0, nil}}
             ]
    end
  end

  describe "chunk writes - " do
    setup :with_started_writer

    @tag chunk_size: 11
    test "chunk size is counted by JSON size and not full entry size", %{
      writer: writer,
      opts: opts
    } do
      writer =
        PureFileStorage.append_to_log!(
          [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test":1}|}],
          writer
        )

      PureFileStorage.terminate(writer)

      # Chunk shoudn't be closed, because byte_size(~S|{"test":1}|) == 10 < 11
      refute PureFileStorage.get_chunk_end_log_offset(LogOffset.new(9, 0), opts) ==
               LogOffset.new(10, 0)
    end
  end

  @tag chunk_size: 30
  test "correctly continues a chunk after a reboot", %{opts: opts} do
    %{writer: writer} = with_started_writer(%{opts: opts})

    writer =
      PureFileStorage.append_to_log!(
        [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test":1}|}],
        writer
      )

    PureFileStorage.terminate(writer)

    assert PureFileStorage.get_chunk_end_log_offset(LogOffset.new(10, 0), opts) == nil

    writer = PureFileStorage.init_writer!(opts, @shape)

    writer =
      PureFileStorage.append_to_log!(
        [
          {LogOffset.new(11, 0), "test_key", :insert, ~S|{"test":2}|},
          {LogOffset.new(12, 0), "test_key", :insert, ~S|{"test":3}|},
          {LogOffset.new(13, 0), "test_key", :insert, ~S|{"test":4}|}
        ],
        writer
      )

    PureFileStorage.terminate(writer)

    assert PureFileStorage.get_chunk_end_log_offset(LogOffset.new(10, 0), opts) ==
             LogOffset.new(11, 0)

    assert PureFileStorage.get_log_stream(LogOffset.new(9, 0), LogOffset.new(13, 0), opts)
           |> Enum.to_list() == [~S|{"test":1}|, ~S|{"test":2}|, ~S|{"test":3}|, ~S|{"test":4}|]
  end

  test "get_chunk_end_log_offset/2 returns nil when no chunk file is found", %{
    base_opts: base_opts,
    opts: opts
  } do
    chunk_index_path =
      Path.join([base_opts.base_path, @shape_handle, "log", "log.latest.0.chunk.bin"])

    refute File.exists?(chunk_index_path)

    assert nil == PureFileStorage.get_chunk_end_log_offset(LogOffset.new(1, 0), opts)
  end

  describe "flush timer" do
    setup :with_started_writer
    @describetag flush_period: 100

    test "flush message arrives after flush period", %{writer: writer} do
      PureFileStorage.append_to_log!(
        [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test":1}|}],
        writer
      )

      assert_receive {Storage, {PureFileStorage, :perform_scheduled_flush, [0]}}
    end

    @tag flush_period: 100
    test "multiple writes cause only one flush message", %{writer: writer} do
      writer =
        PureFileStorage.append_to_log!(
          [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test":1}|}],
          writer
        )

      PureFileStorage.append_to_log!(
        [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test":1}|}],
        writer
      )

      assert_receive {Storage, {PureFileStorage, :perform_scheduled_flush, [0]}}
      refute_receive {Storage, {PureFileStorage, :perform_scheduled_flush, _}}, 200
    end

    @tag flush_period: 50
    test "state after flush is correct", %{writer: writer} do
      writer =
        PureFileStorage.append_to_log!(
          [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test":1}|}],
          writer
        )

      assert_receive {Storage, {PureFileStorage, :perform_scheduled_flush, [0]}}

      writer = PureFileStorage.perform_scheduled_flush(writer, 0)

      PureFileStorage.append_to_log!(
        [{LogOffset.new(11, 0), "test_key", :insert, ~S|{"test":1}|}],
        writer
      )

      assert_receive {Storage, {PureFileStorage, :perform_scheduled_flush, [1]}}
    end

    @tag flush_period: 50
    test "hibernate with empty buffer doesn't schedule a flush", %{writer: writer} do
      writer =
        PureFileStorage.append_to_log!(
          [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test":1}|}],
          writer
        )

      assert_receive {Storage, {PureFileStorage, :perform_scheduled_flush, [0]}}

      writer = PureFileStorage.perform_scheduled_flush(writer, 0)

      PureFileStorage.append_to_log!(
        [{LogOffset.new(11, 0), "test_key", :insert, ~S|{"test":1}|}],
        writer
      )

      assert_receive {Storage, {PureFileStorage, :perform_scheduled_flush, [1]}}
      assert_receive {Storage, :flushed, _last_seen_offset}, 200
      refute_receive {Storage, {PureFileStorage, :perform_scheduled_flush, _}}, 200

      _writer = PureFileStorage.hibernate(writer)

      refute_receive {Storage, :flushed, _last_seen_offset}, 200
    end

    @flush_alignment_bytes 64 * 1024
    @tag flush_period: 100
    test "should run scheduled flush after empty buffer alignment", %{writer: writer} do
      large_data = String.duplicate("x", @flush_alignment_bytes + 1000)

      # write small piece of data to trigger scheduling of flush
      writer =
        PureFileStorage.append_to_log!(
          [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test":1}|}],
          writer
        )

      # write large piece of data that goes over buffer limit and forces a flush
      writer =
        PureFileStorage.append_to_log!(
          [{LogOffset.new(11, 0), "test_key", :insert, ~s|{"test":"#{large_data}"}|}],
          writer
        )

      # next small piece of data should schedule new flush with larger flush counter
      PureFileStorage.append_to_log!(
        [{LogOffset.new(12, 0), "test_key", :insert, ~S|{"test":1}|}],
        writer
      )

      assert_receive {Storage, {PureFileStorage, :perform_scheduled_flush, [times_flushed]}}
      assert times_flushed > 0
      refute_receive {Storage, {PureFileStorage, :perform_scheduled_flush, [_]}}
    end
  end

  describe "restore cached state" do
    test "should use new table on every restore", %{opts: opts} do
      %{writer: writer} = with_started_writer(%{opts: opts})
      [meta] = :ets.lookup(PureFileStorage.stack_ets(opts.stack_id), opts.shape_handle)
      old_ets_table = storage_meta(meta, :ets_table)
      assert old_ets_table != nil

      recovery_state = PureFileStorage.terminate(writer)
      assert {_ver, _writer_acc, meta} = recovery_state
      assert storage_meta(meta, :ets_table) == nil

      PureFileStorage.init_writer!(opts, @shape, recovery_state)
      [meta] = :ets.lookup(PureFileStorage.stack_ets(opts.stack_id), opts.shape_handle)
      new_ets_table = storage_meta(meta, :ets_table)
      assert new_ets_table != nil
      assert new_ets_table != old_ets_table
    end
  end

  describe "schedule_compaction/1" do
    test "sends a message to the calling process within the predefined time period", ctx do
      compaction_config = Map.put(ctx.base_opts.compaction_config, :period, 5)
      PureFileStorage.schedule_compaction(compaction_config)
      assert_receive {Storage, {PureFileStorage, :scheduled_compaction, [^compaction_config]}}, 20
    end
  end

  test "correctly continues writing after hibernation", %{opts: opts} do
    %{writer: writer} = with_started_writer(%{opts: opts})

    writer =
      PureFileStorage.append_to_log!(
        [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test":1}|}],
        writer
      )

    writer = PureFileStorage.hibernate(writer)

    assert PureFileStorage.get_log_stream(LogOffset.new(9, 0), LogOffset.new(13, 0), opts)
           |> Enum.to_list() == [~S|{"test":1}|]

    writer =
      PureFileStorage.append_to_log!(
        [{LogOffset.new(11, 0), "test_key", :insert, ~S|{"test":2}|}],
        writer
      )

    PureFileStorage.terminate(writer)

    assert PureFileStorage.get_log_stream(LogOffset.new(9, 0), LogOffset.new(12, 0), opts)
           |> Enum.to_list() == [~S|{"test":1}|, ~S|{"test":2}|]
  end

  defp with_started_writer(%{opts: opts}) do
    writer = PureFileStorage.init_writer!(opts, @shape)
    PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
    PureFileStorage.mark_snapshot_as_started(opts)
    PureFileStorage.make_new_snapshot!([], opts)

    %{writer: writer}
  end
end
