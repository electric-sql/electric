defmodule Electric.ShapeCache.PureFileStorageTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit

  import Support.ComponentSetup
  import Support.TestUtils

  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache.PureFileStorage
  alias Electric.Shapes.Shape

  @moduletag :tmp_dir
  setup [
    :with_stack_id_from_test,
    :with_async_deleter
  ]

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

    test "active log reads", %{opts: opts, stack_id: stack_id} do
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

      # This cleans the shapes ets cache, retaining only the values
      # required for the read-path
      PureFileStorage.terminate(writer)

      assert PureFileStorage.fetch_latest_offset(opts) ==
               {:ok, LogOffset.new(11, 0)}

      assert PureFileStorage.fetch_pg_snapshot(opts) ==
               {:ok, %{xmin: 100}}

      assert PureFileStorage.get_log_stream(LogOffset.new(0, 0), LogOffset.last(), opts)
             |> Enum.to_list() == [~S|{"test": 1}|, ~S|{"test": 2}|]

      # this simulates a cold start
      stack_ets = PureFileStorage.stack_ets(stack_id)
      :ets.delete(stack_ets, @shape_handle)

      assert PureFileStorage.fetch_latest_offset(opts) ==
               {:ok, LogOffset.new(11, 0)}

      assert PureFileStorage.fetch_pg_snapshot(opts) ==
               {:ok, %{xmin: 100}}

      assert PureFileStorage.get_log_stream(LogOffset.new(0, 0), LogOffset.last(), opts)
             |> Enum.to_list() == [~S|{"test": 1}|, ~S|{"test": 2}|]
    end

    test "reads survive the later deletion of the snapshot file", %{
      opts: opts,
      base_opts: base_opts
    } do
      opts = %{opts | snapshot_file_timeout: 50}
      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([~S|{"test": 1}|, ~S|{"test": 2}|], opts)
      PureFileStorage.terminate(writer)

      stream =
        PureFileStorage.get_log_stream(
          LogOffset.before_all(),
          LogOffset.last_before_real_offsets(),
          opts
        )

      File.rename!(
        Path.join(base_opts.base_path, @shape_handle),
        Path.join(base_opts.base_path, @shape_handle <> "-deleted")
      )

      assert Enum.to_list(stream) == []
    end

    test "reads to a deleted shape do not raise", %{opts: opts, base_opts: base_opts} do
      opts = %{opts | snapshot_file_timeout: 50}
      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([~S|{"test": 1}|, ~S|{"test": 2}|], opts)
      PureFileStorage.terminate(writer)

      File.rename!(
        Path.join(base_opts.base_path, @shape_handle),
        Path.join(base_opts.base_path, @shape_handle <> "-deleted")
      )

      stream =
        PureFileStorage.get_log_stream(
          LogOffset.before_all(),
          LogOffset.last_before_real_offsets(),
          opts
        )

      assert Enum.to_list(stream) == []
    end

    test "enoent returned from an existing shape does raise", %{opts: opts} do
      opts = %{opts | snapshot_file_timeout: 50}
      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([~S|{"test": 1}|, ~S|{"test": 2}|], opts)
      PureFileStorage.terminate(writer)

      chunk_file_path = PureFileStorage.Snapshot.chunk_file_path(opts, 0)

      File.rm!(chunk_file_path)

      assert_raise File.Error, fn ->
        PureFileStorage.get_log_stream(
          LogOffset.before_all(),
          LogOffset.last_before_real_offsets(),
          opts
        )
        |> Enum.to_list()
      end
    end
  end

  describe "read-through cache -" do
    test "is always populated", %{
      opts: opts,
      stack_id: stack_id
    } do
      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([], opts)

      writer =
        PureFileStorage.append_to_log!(
          [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test": 1}|}],
          writer
        )

      stack_ets = PureFileStorage.stack_ets(stack_id)

      # Should populate read through cache even while writer is active
      assert PureFileStorage.snapshot_started?(opts) == true
      assert PureFileStorage.fetch_latest_offset(opts) == {:ok, LogOffset.new(10, 0)}

      assert [_] = :ets.lookup(stack_ets, @shape_handle)

      PureFileStorage.terminate(writer)

      # terminating the writer does not delete the entry, just cleans the writer-only fields
      assert [_] = :ets.lookup(stack_ets, @shape_handle)

      assert PureFileStorage.snapshot_started?(opts) == true
      assert PureFileStorage.fetch_latest_offset(opts) == {:ok, LogOffset.new(10, 0)}

      # Verify cache is retained when writer is re-activated
      PureFileStorage.init_writer!(opts, @shape)

      assert [_] = :ets.lookup(stack_ets, @shape_handle)
    end

    test "is cleaned of writer metadata after writer termination", %{
      opts: opts,
      stack_id: stack_id
    } do
      import Electric.ShapeCache.PureFileStorage.SharedRecords,
        only: [storage_meta: 0, storage_meta: 1]

      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([], opts)

      writer =
        PureFileStorage.append_to_log!(
          [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test": 1}|}],
          writer
        )

      stack_ets = PureFileStorage.stack_ets(stack_id)

      # Should populate read through cache even while writer is active
      assert PureFileStorage.snapshot_started?(opts) == true
      assert PureFileStorage.fetch_latest_offset(opts) == {:ok, LogOffset.new(10, 0)}

      assert [storage_meta() = meta] = :ets.lookup(stack_ets, @shape_handle)

      assert storage_meta(ets_table: ets_table) = meta
      assert is_list(:ets.info(ets_table))

      PureFileStorage.terminate(writer)

      # terminating the writer does not delete the entry, just cleans the writer-only fields
      assert [storage_meta() = meta] = :ets.lookup(stack_ets, @shape_handle)

      assert storage_meta(ets_table: nil) = meta
      assert :undefined == :ets.info(ets_table)
    end

    test "subsequent reads use cached values without disk access", %{
      opts: opts,
      base_opts: base_opts
    } do
      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([], opts)

      writer =
        PureFileStorage.append_to_log!(
          [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test": 1}|}],
          writer
        )

      PureFileStorage.terminate(writer)

      # First read populates cache
      assert PureFileStorage.snapshot_started?(opts) == true
      assert PureFileStorage.fetch_latest_offset(opts) == {:ok, LogOffset.new(10, 0)}

      # Delete shape failes to confirm cache is used
      File.rm_rf!(Path.join([base_opts.base_path, @shape_handle]))

      assert PureFileStorage.snapshot_started?(opts) == true
      assert PureFileStorage.fetch_latest_offset(opts) == {:ok, LogOffset.new(10, 0)}
    end

    test "cache is cleaned up on shape deletion", %{opts: opts, stack_id: stack_id} do
      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([], opts)
      PureFileStorage.terminate(writer)

      # Populate cache
      PureFileStorage.snapshot_started?(opts)

      stack_ets = PureFileStorage.stack_ets(stack_id)
      assert [_meta] = :ets.lookup(stack_ets, @shape_handle)

      # Verify cache entry is removed on cleanup
      {PureFileStorage, base_opts} = Storage.for_stack(stack_id)
      PureFileStorage.cleanup!(base_opts, @shape_handle)
      assert :ets.lookup(stack_ets, @shape_handle) == []
    end

    test "reads work for missing metadata", %{opts: opts} do
      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.terminate(writer)

      assert PureFileStorage.snapshot_started?(opts) == false

      assert PureFileStorage.fetch_latest_offset(opts) ==
               {:ok, LogOffset.last_before_real_offsets()}
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

    test "survive the deletion of the chunk file mid stream", %{
      writer: writer,
      opts: opts,
      base_opts: base_opts
    } do
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

      stream = PureFileStorage.get_log_stream(LogOffset.new(9, 0), LogOffset.last(), opts)

      File.rename!(
        Path.join(base_opts.base_path, @shape_handle),
        Path.join(base_opts.base_path, @shape_handle <> "-deleted")
      )

      assert Enum.to_list(stream) == []
    end

    test "returns an empty stream if the files have been deleted", %{writer: writer, opts: opts} do
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

      shape_data_dir = PureFileStorage.shape_data_dir(opts)

      File.rm_rf!(shape_data_dir)

      assert [] =
               PureFileStorage.get_log_stream(LogOffset.new(9, 0), LogOffset.last(), opts)
               |> Enum.to_list()
    end

    test "returns an empty stream if the shape has been deleted", %{writer: writer, opts: opts} do
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
      PureFileStorage.cleanup!(opts)

      assert [] = PureFileStorage.get_log_stream(LogOffset.new(9, 0), LogOffset.last(), opts)
    end

    test "raises if the files are gone but the shape still exists", %{writer: writer, opts: opts} do
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

      json_file = PureFileStorage.json_file(opts, "latest.0")

      File.rm!(json_file)

      assert_raise File.Error, fn ->
        PureFileStorage.get_log_stream(LogOffset.new(9, 0), LogOffset.last(), opts)
        |> Enum.to_list()
      end
    end

    test "returns empty stream if some files deleted and the shape has gone", %{
      writer: writer,
      opts: opts,
      base_opts: base_opts
    } do
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

      File.rename!(
        Path.join(base_opts.base_path, @shape_handle),
        Path.join(base_opts.base_path, @shape_handle <> "-deleted")
      )

      assert [] =
               PureFileStorage.get_log_stream(LogOffset.new(9, 0), LogOffset.last(), opts)
               |> Enum.to_list()
    end

    test "correctly skips over lines when max offset is less than the one written", %{
      writer: writer,
      opts: opts
    } do
      writer =
        PureFileStorage.append_to_log!(
          [
            {LogOffset.new(10, 0), "test_key", :insert, ~s|{"test":"1"}|},
            {LogOffset.new(12, 0), "test_key", :update, ~s|{"test":"2"}|},
            {LogOffset.new(14, 0), "test_key", :delete, ~s|{"test":"3"}|}
          ],
          writer
        )

      PureFileStorage.terminate(writer)

      assert PureFileStorage.get_log_stream(LogOffset.new(9, 0), LogOffset.new(11, 0), opts)
             |> Enum.to_list() == [~s|{"test":"1"}|]
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

        assert PureFileStorage.fetch_latest_offset(opts) == {:ok, LogOffset.new(10, 0)}

        assert PureFileStorage.fetch_pg_snapshot(opts) == {:ok, %{xmin: 100}}
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

      assert PureFileStorage.fetch_latest_offset(opts) ==
               {:ok, LogOffset.new(10, 0)}

      assert PureFileStorage.fetch_pg_snapshot(opts) ==
               {:ok, %{xmin: 100}}

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

      assert PureFileStorage.fetch_latest_offset(opts) ==
               {:ok, LogOffset.new(10, 0)}

      assert PureFileStorage.fetch_pg_snapshot(opts) ==
               {:ok, %{xmin: 100}}

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

      assert PureFileStorage.fetch_latest_offset(opts) ==
               {:ok, LogOffset.new(0, 0)}

      assert PureFileStorage.fetch_pg_snapshot(opts) ==
               {:ok, %{xmin: 100}}

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

  describe "ETS read/write race condition" do
    setup :with_started_writer
    @describetag flush_period: 50

    test "reader retries when ETS is unexpectedly empty due to concurrent flush", %{
      writer: writer,
      opts: opts,
      stack_id: stack_id
    } do
      import Electric.ShapeCache.PureFileStorage.SharedRecords

      # Write data - goes to ETS buffer
      writer =
        PureFileStorage.append_to_log!(
          [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test": 1}|}],
          writer
        )

      # Wait for and trigger flush - data now on disk, ETS cleared
      assert_receive {Storage, {PureFileStorage, :perform_scheduled_flush, [0]}}
      writer = PureFileStorage.perform_scheduled_flush(writer, 0)

      # Get the fresh (correct) metadata after flush
      stack_ets = PureFileStorage.stack_ets(stack_id)
      [fresh_meta] = :ets.lookup(stack_ets, @shape_handle)

      assert storage_meta(last_persisted_offset: fresh_last_persisted, ets_table: ets_ref) =
               fresh_meta

      assert fresh_last_persisted == LogOffset.new(10, 0)
      assert :ets.info(ets_ref, :size) == 0

      # Create stale metadata - same as fresh but with old last_persisted
      # This simulates what a reader would see if it read metadata BEFORE the flush
      stale_meta =
        storage_meta(fresh_meta, last_persisted_offset: LogOffset.last_before_real_offsets())

      # Simulate the race condition by patching LogOffset.min to synchronize:
      # 1. First call to LogOffset.min (during first read) updates metadata to fresh
      # 2. First read continues with stale metadata, tries ETS, gets empty
      # 3. Retry reads fresh metadata and reads from disk
      {:ok, call_counter} = start_supervised({Agent, fn -> 0 end})

      # Insert stale metadata first
      :ets.insert(stack_ets, stale_meta)

      # Patch LogOffset.min to signal when the first read starts
      # This gives us a synchronization point during the read
      Repatch.patch(LogOffset, :min, [mode: :shared], fn a, b ->
        count = Agent.get_and_update(call_counter, fn n -> {n, n + 1} end)

        # On first call (during first read attempt), update metadata to fresh
        # The retry will then see fresh metadata
        if count == 0 do
          :ets.insert(stack_ets, fresh_meta)
        end

        # Call original implementation
        Repatch.real(LogOffset, :min, [a, b])
      end)

      # THE FIX TEST: Reader should recover data despite seeing stale metadata initially
      # First read: sees stale metadata (last_persisted = before_real), tries ETS, gets empty
      # During first read, LogOffset.min is called, which updates metadata to fresh
      # Retry: sees fresh metadata (last_persisted = 10,0), reads from disk
      result =
        PureFileStorage.get_log_stream(
          LogOffset.new(0, 0),
          LogOffset.last(),
          opts
        )
        |> Enum.to_list()

      assert result == [~S|{"test": 1}|],
             "Reader should recover data via retry after seeing stale metadata"

      PureFileStorage.terminate(writer)
    end

    test "reader retries when ETS returns partial data due to concurrent flush", %{
      writer: writer,
      opts: opts,
      stack_id: stack_id
    } do
      import Electric.ShapeCache.PureFileStorage.SharedRecords

      # Write multiple entries - all go to ETS buffer
      writer =
        PureFileStorage.append_to_log!(
          [
            {LogOffset.new(10, 0), "test_key", :insert, ~S|{"test": 1}|}
          ],
          writer
        )

      writer =
        PureFileStorage.append_to_log!(
          [
            {LogOffset.new(11, 0), "test_key", :insert, ~S|{"test": 2}|}
          ],
          writer
        )

      writer =
        PureFileStorage.append_to_log!(
          [
            {LogOffset.new(12, 0), "test_key", :insert, ~S|{"test": 3}|}
          ],
          writer
        )

      # Wait for and trigger flush - all data now on disk, ETS cleared
      assert_receive {Storage, {PureFileStorage, :perform_scheduled_flush, [0]}}
      writer = PureFileStorage.perform_scheduled_flush(writer, 0)

      # Get the fresh (correct) metadata after flush
      stack_ets = PureFileStorage.stack_ets(stack_id)
      [fresh_meta] = :ets.lookup(stack_ets, @shape_handle)

      assert storage_meta(last_persisted_offset: fresh_last_persisted, ets_table: ets_ref) =
               fresh_meta

      assert fresh_last_persisted == LogOffset.new(12, 0)
      assert :ets.info(ets_ref, :size) == 0

      # Simulate partial ETS state: put only SOME entries back in ETS
      # This simulates what a reader would see if ETS was cleared mid-iteration
      :ets.insert(ets_ref, {LogOffset.to_tuple(LogOffset.new(10, 0)), ~S|{"test": 1}|})
      # Entry at offset 11 and 12 are "missing" - simulating they were cleared mid-read

      # Create stale metadata - reader thinks all data should be in ETS
      stale_meta =
        storage_meta(fresh_meta, last_persisted_offset: LogOffset.last_before_real_offsets())

      # Simulate the race condition by patching LogOffset.min to synchronize
      {:ok, call_counter} = start_supervised({Agent, fn -> 0 end})

      # Insert stale metadata first
      :ets.insert(stack_ets, stale_meta)

      Repatch.patch(LogOffset, :min, [mode: :shared], fn a, b ->
        count = Agent.get_and_update(call_counter, fn n -> {n, n + 1} end)

        # On first call, update metadata to fresh but DON'T clear ETS yet
        # This allows the reader to get partial data from ETS
        # The key insight: reader already decided to read from ETS based on stale metadata,
        # but ETS only has partial data (entry 10, missing 11 and 12)
        if count == 0 do
          :ets.insert(stack_ets, fresh_meta)
        end

        Repatch.real(LogOffset, :min, [a, b])
      end)

      # THE FIX TEST: Reader should recover ALL data despite partial ETS read
      # First read: sees stale metadata, tries ETS, gets only entry at offset 10
      # Fix detects: last_offset_read (10,0) < upper_read_bound, retries
      # Retry: sees fresh metadata (last_persisted = 12,0), reads from disk
      result =
        PureFileStorage.get_log_stream(
          LogOffset.new(0, 0),
          LogOffset.last(),
          opts
        )
        |> Enum.to_list()

      assert result == [~S|{"test": 1}|, ~S|{"test": 2}|, ~S|{"test": 3}|],
             "Reader should recover ALL data via retry after partial ETS read"

      PureFileStorage.terminate(writer)
    end
  end

  defp with_started_writer(%{opts: opts}) do
    writer = PureFileStorage.init_writer!(opts, @shape)
    PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
    PureFileStorage.mark_snapshot_as_started(opts)
    PureFileStorage.make_new_snapshot!([], opts)

    %{writer: writer}
  end
end
