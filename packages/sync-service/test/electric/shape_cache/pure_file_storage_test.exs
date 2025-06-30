defmodule Electric.ShapeCache.PureFileStorageTest do
  use ExUnit.Case

  import Support.ComponentSetup

  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache.PureFileStorage
  alias Electric.Shapes.Shape

  @moduletag :tmp_dir
  setup :with_stack_id_from_test

  @shape_handle "the-shape-handle"
  @shape %Shape{
    root_table: {"public", "items"},
    root_table_id: 1,
    root_pk: ["id"],
    selected_columns: ["id"],
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
        chunk_bytes_threshold: ctx[:chunk_size] || 10 * 1024 * 1024
      )

    start_link_supervised!(Storage.stack_child_spec({PureFileStorage, base_opts}))

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

  describe "crash recovery" do
    # These tests make use of known log file structures to test that the storage recovers correctly
    # If underlying file structure changes, these tests will need to be updated.
    setup %{opts: opts} do
      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([], opts)

      writer =
        PureFileStorage.append_to_log!(
          [{LogOffset.new(10, 0), "test_key", :insert, ~S|{"test":1}|}],
          writer
        )

      PureFileStorage.terminate(writer)

      assert PureFileStorage.get_current_position(opts) ==
               {:ok, LogOffset.new(10, 0), %{xmin: 100}}

      :ok
    end

    test "incomplete transaction write before crash is discarded", %{opts: opts} do
      # Transaction got partially flushed, but not "closed" i.e. persisted boundary wasn't updated
      File.open!(PureFileStorage.json_file(opts), [:append, :raw], fn file ->
        json = Jason.encode!(%{test: 2})

        IO.binwrite(
          file,
          <<LogOffset.to_int128(LogOffset.new(11, 0))::binary, 4::32, "test"::binary, ?i::8, 0::8,
            byte_size(json)::64, json::binary>>
        )
      end)

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
      File.open!(PureFileStorage.chunk_file(opts), [:append, :raw], fn file ->
        IO.binwrite(file, <<LogOffset.to_int128(LogOffset.new(20, 0))::binary, 100::64>>)
      end)

      # And a partial write cut midline just for good measure
      File.open!(PureFileStorage.json_file(opts), [:append, :raw], fn file ->
        IO.binwrite(
          file,
          <<LogOffset.to_int128(LogOffset.new(20, 0))::binary, 4::32, "test"::binary, ?i::8, 0::8,
            0::32>>
        )
      end)

      assert PureFileStorage.ChunkIndex.read_chunk_file(PureFileStorage.chunk_file(opts)) == [
               {{LogOffset.new(10, 0), LogOffset.new(20, 0)}, {0, 100}}
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

      assert PureFileStorage.ChunkIndex.read_chunk_file(PureFileStorage.chunk_file(opts)) == [
               {{LogOffset.new(10, 0), nil}, {0, nil}}
             ]
    end
  end
end
