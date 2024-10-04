defmodule Electric.ShapeCache.StorageImplimentationsTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.FileStorage
  alias Electric.Postgres.Lsn
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes
  alias Electric.ShapeCache.InMemoryStorage
  alias Electric.Utils

  import Support.TestUtils

  @moduletag :tmp_dir

  @shape_handle "the-shape-id"
  @shape %Shape{
    root_table: {"public", "items"},
    root_table_id: 1,
    table_info: %{
      {"public", "items"} => %{
        columns: [%{name: "id", type: :text}, %{name: "value", type: :text}],
        pk: ["id"]
      }
    }
  }

  @snapshot_offset LogOffset.first()
  @snapshot_offset_encoded to_string(@snapshot_offset)
  @zero_offset LogOffset.first()
  @data_stream [
                 %{
                   offset: @snapshot_offset,
                   value: %{id: "00000000-0000-0000-0000-000000000001", title: "row1"},
                   key: ~S|"public"."the-table"/"00000000-0000-0000-0000-000000000001"|,
                   headers: %{operation: "insert"}
                 },
                 %{
                   offset: @snapshot_offset,
                   value: %{id: "00000000-0000-0000-0000-000000000002", title: "row2"},
                   key: ~S|"public"."the-table"/"00000000-0000-0000-0000-000000000002"|,
                   headers: %{operation: "insert"}
                 }
               ]
               |> Enum.map(&Jason.encode_to_iodata!/1)

  setup :with_electric_instance_id

  for module <- [InMemoryStorage, FileStorage] do
    module_name = module |> Module.split() |> List.last()

    doctest module, import: true

    describe "#{module_name}.snapshot_started?/2" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "returns false when shape does not exist", %{module: storage, opts: opts} do
        assert storage.snapshot_started?(opts) == false
      end

      test "returns true when snapshot has started", %{module: storage, opts: opts} do
        storage.mark_snapshot_as_started(opts)

        assert storage.snapshot_started?(opts) == true
      end
    end

    describe "#{module_name}.get_snapshot/2" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "returns snapshot when shape does exist", %{module: storage, opts: opts} do
        storage.mark_snapshot_as_started(opts)
        storage.make_new_snapshot!(@data_stream, opts)

        {@snapshot_offset, stream} = storage.get_snapshot(opts)

        assert [
                 %{
                   offset: @snapshot_offset_encoded,
                   value: %{id: "00000000-0000-0000-0000-000000000001", title: "row1"},
                   key: ~S|"public"."the-table"/"00000000-0000-0000-0000-000000000001"|,
                   headers: %{operation: "insert"}
                 },
                 %{
                   offset: @snapshot_offset_encoded,
                   value: %{id: "00000000-0000-0000-0000-000000000002", title: "row2"},
                   key: ~S|"public"."the-table"/"00000000-0000-0000-0000-000000000002"|,
                   headers: %{operation: "insert"}
                 }
               ] = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))
      end

      test "returns snapshot offset when shape does exist", %{module: storage, opts: opts} do
        storage.mark_snapshot_as_started(opts)
        storage.make_new_snapshot!(@data_stream, opts)

        {@snapshot_offset, _} = storage.get_snapshot(opts)
      end

      test "does not return items not in the snapshot", %{module: storage, opts: opts} do
        log_items =
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "123", "name" => "Test"},
              log_offset: LogOffset.new(Lsn.from_integer(1000), 0)
            }
          ]
          |> changes_to_log_items()

        storage.mark_snapshot_as_started(opts)
        storage.make_new_snapshot!(@data_stream, opts)
        storage.append_to_log!(log_items, opts)

        {@snapshot_offset, stream} = storage.get_snapshot(opts)
        assert Enum.count(stream) == Enum.count(@data_stream)
      end

      test "returns complete snapshot when the snapshot is concurrently being written", %{
        module: storage,
        opts: opts
      } do
        row_count = 10

        data_stream =
          Stream.map(1..row_count, fn i ->
            # Sleep to give the read process time to run
            Process.sleep(1)

            [
              %{
                offset: @snapshot_offset_encoded,
                value: %{id: "00000000-0000-0000-0000-00000000000#{i}", title: "row#{i}"},
                key: ~S|"public"."the-table"/"00000000-0000-0000-0000-00000000000#{i}"|,
                headers: %{operation: "insert"}
              }
              |> Jason.encode_to_iodata!()
            ]
          end)

        storage.mark_snapshot_as_started(opts)
        {@snapshot_offset, stream} = storage.get_snapshot(opts)

        read_task =
          Task.async(fn ->
            log = Enum.to_list(stream)

            assert Enum.count(log) == row_count

            for {item, i} <- Enum.with_index(log, 1) do
              assert Jason.decode!(item, keys: :atoms).value.title == "row#{i}"
            end
          end)

        storage.make_new_snapshot!(data_stream, opts)

        Task.await(read_task)
      end
    end

    describe "#{module_name}.append_to_log!/3" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "adds items to the log", %{module: storage, opts: opts} do
        lsn = Lsn.from_integer(1000)
        offset = LogOffset.new(lsn, 0)

        log_items =
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "123", "name" => "Test"},
              log_offset: offset
            }
          ]
          |> changes_to_log_items()

        storage.append_to_log!(log_items, opts)

        stream = storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)

        assert [
                 %{
                   key: ~S|"public"."test_table"/"123"|,
                   value: %{id: "123", name: "Test"},
                   offset: offset |> LogOffset.to_iolist() |> :erlang.iolist_to_binary(),
                   headers: %{
                     operation: "insert",
                     txid: 1,
                     relation: ["public", "test_table"]
                   }
                 }
               ] == Enum.map(stream, &Jason.decode!(&1, keys: :atoms))
      end

      test "adds items to the log in idempotent way", %{module: storage, opts: opts} do
        lsn = Lsn.from_integer(1000)
        offset = LogOffset.new(lsn, 0)

        log_items =
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "123", "name" => "Test"},
              log_offset: offset
            }
          ]
          |> changes_to_log_items()

        :ok = storage.append_to_log!(log_items, opts)

        log1 =
          storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
          |> Enum.map(&:json.decode/1)

        :ok = storage.append_to_log!(log_items, opts)

        log2 =
          storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
          |> Enum.map(&:json.decode/1)

        assert log1 == log2
      end
    end

    describe "#{module_name}.get_log_stream/4" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "returns correct stream of log items", %{module: storage, opts: opts} do
        lsn1 = Lsn.from_integer(1000)
        lsn2 = Lsn.from_integer(2000)

        log_items1 =
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "123", "name" => "Test1"},
              log_offset: LogOffset.new(lsn1, 0)
            }
          ]
          |> changes_to_log_items()

        log_items2 =
          [
            %Changes.UpdatedRecord{
              relation: {"public", "test_table"},
              old_record: %{"id" => "123", "name" => "Test1"},
              record: %{"id" => "123", "name" => "Test2"},
              log_offset: LogOffset.new(lsn2, 0)
            },
            %Changes.DeletedRecord{
              relation: {"public", "test_table"},
              old_record: %{"id" => "123", "name" => "Test1"},
              log_offset: LogOffset.new(lsn2, 1)
            }
          ]
          |> changes_to_log_items()

        :ok = storage.append_to_log!(log_items1, opts)
        :ok = storage.append_to_log!(log_items2, opts)

        stream = storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
        entries = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        assert [
                 %{headers: %{operation: "insert"}},
                 %{headers: %{operation: "update"}},
                 %{headers: %{operation: "delete"}}
               ] = entries
      end

      test "returns stream of log items after offset", %{module: storage, opts: opts} do
        lsn1 = Lsn.from_integer(1000)
        lsn2 = Lsn.from_integer(2000)

        log_items1 =
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "123", "name" => "Test1"},
              log_offset: LogOffset.new(lsn1, 0)
            }
          ]
          |> changes_to_log_items()

        log_items2 =
          [
            %Changes.UpdatedRecord{
              relation: {"public", "test_table"},
              old_record: %{"id" => "123", "name" => "Test1"},
              record: %{"id" => "123", "name" => "Test2"},
              log_offset: LogOffset.new(lsn2, 0)
            },
            %Changes.DeletedRecord{
              relation: {"public", "test_table"},
              old_record: %{"id" => "123", "name" => "Test1"},
              log_offset: LogOffset.new(lsn2, 1)
            }
          ]
          |> changes_to_log_items()

        :ok = storage.append_to_log!(log_items1, opts)
        :ok = storage.append_to_log!(log_items2, opts)

        stream =
          storage.get_log_stream(LogOffset.new(lsn1, 0), LogOffset.last(), opts)

        entries = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        assert [
                 %{headers: %{operation: "update"}},
                 %{headers: %{operation: "delete"}}
               ] = entries
      end

      test "returns stream of log items after offset and before max_offset (inclusive)", %{
        module: storage,
        opts: opts
      } do
        lsn1 = Lsn.from_integer(1000)
        lsn2 = Lsn.from_integer(2000)

        log_items1 =
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "123", "name" => "Test1"},
              log_offset: LogOffset.new(lsn1, 0)
            }
          ]
          |> changes_to_log_items()

        log_items2 =
          [
            %Changes.UpdatedRecord{
              relation: {"public", "test_table"},
              old_record: %{"id" => "123", "name" => "Test1"},
              record: %{"id" => "123", "name" => "Test2"},
              log_offset: LogOffset.new(lsn2, 0)
            },
            %Changes.DeletedRecord{
              relation: {"public", "test_table"},
              old_record: %{"id" => "123", "name" => "Test1"},
              log_offset: LogOffset.new(lsn2, 1)
            }
          ]
          |> changes_to_log_items()

        :ok = storage.append_to_log!(log_items1, opts)
        :ok = storage.append_to_log!(log_items2, opts)

        stream =
          storage.get_log_stream(
            LogOffset.new(lsn1, 0),
            LogOffset.new(lsn2, 0),
            opts
          )

        entries = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        assert [%{headers: %{operation: "update"}}] = entries
      end
    end

    describe "#{module_name}.cleanup!/2" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "causes snapshot_started?/2 to return false", %{module: storage, opts: opts} do
        storage.make_new_snapshot!(@data_stream, opts)

        storage.cleanup!(opts)

        assert storage.snapshot_started?(opts) == false
      end

      test "causes get_snapshot/2 to raise an error", %{module: storage, opts: opts} do
        storage.mark_snapshot_as_started(opts)
        storage.make_new_snapshot!(@data_stream, opts)

        storage.cleanup!(opts)

        assert_raise RuntimeError, fn ->
          {@zero_offset, stream} = storage.get_snapshot(opts)
          Stream.run(stream)
        end
      end

      test "causes get_log_stream/4 to return empty stream", %{module: storage, opts: opts} do
        lsn = Lsn.from_integer(1000)

        log_items =
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "123", "name" => "Test"},
              log_offset: LogOffset.new(lsn, 0)
            }
          ]
          |> changes_to_log_items()

        storage.append_to_log!(log_items, opts)

        storage.cleanup!(opts)

        assert storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
               |> Enum.to_list() == []
      end
    end
  end

  # Tests for storage implementations that are recoverable
  for module <- [FileStorage] do
    module_name = module |> Module.split() |> List.last()

    describe "#{module_name}.initialise/1" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "removes the shape if the shape definition has not been set", %{
        module: storage,
        opts: opts
      } do
        storage.initialise(opts)

        # storage.set_shape_definition(@shape, opts)
        storage.mark_snapshot_as_started(opts)
        storage.make_new_snapshot!(@data_stream, opts)
        storage.set_snapshot_xmin(11, opts)
        assert storage.snapshot_started?(opts)

        storage.initialise(opts)

        refute storage.snapshot_started?(opts)
      end

      test "removes the shape if the snapshot_xmin has not been set", %{
        module: storage,
        opts: opts
      } do
        storage.initialise(opts)

        storage.set_shape_definition(@shape, opts)
        storage.mark_snapshot_as_started(opts)
        storage.make_new_snapshot!(@data_stream, opts)
        # storage.set_snapshot_xmin(11, opts)
        assert storage.snapshot_started?(opts)

        storage.initialise(opts)

        refute storage.snapshot_started?(opts)
      end

      test "removes the shape if the snapshot has not finished", %{
        module: storage,
        opts: opts
      } do
        storage.initialise(opts)

        storage.set_shape_definition(@shape, opts)
        storage.mark_snapshot_as_started(opts)
        storage.set_snapshot_xmin(22, opts)

        storage.initialise(opts)

        refute storage.snapshot_started?(opts)
      end

      test "removes all shapes if the storage version has changed", %{
        module: storage,
        opts: opts
      } do
        storage.initialise(opts)

        storage.set_shape_definition(@shape, opts)
        storage.mark_snapshot_as_started(opts)
        storage.make_new_snapshot!(@data_stream, opts)
        storage.set_snapshot_xmin(11, opts)

        storage.initialise(%{opts | version: "new-version"})

        refute storage.snapshot_started?(opts)
      end
    end

    describe "#{module_name}.get_all_stored_shapes/1" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "retrieves no shapes if no shapes persisted", %{
        module: storage,
        opts: opts
      } do
        assert {:ok, %{}} = Electric.ShapeCache.Storage.get_all_stored_shapes({storage, opts})
      end

      test "retrieves stored shapes", %{
        module: storage,
        opts: opts
      } do
        storage.initialise(opts)
        storage.set_shape_definition(@shape, opts)

        assert {:ok, %{@shape_id => @shape}} =
                 Electric.ShapeCache.Storage.get_all_stored_shapes({storage, opts})
      end
    end
  end

  defp start_storage(%{module: module} = context) do
    opts = module |> opts(context) |> module.shared_opts()
    shape_opts = module.for_shape(@shape_handle, opts)
    {:ok, _} = module.start_link(shape_opts)
    {:ok, %{module: module, opts: shape_opts}}
  end

  defp opts(InMemoryStorage, %{electric_instance_id: electric_instance_id}) do
    [
      snapshot_ets_table: String.to_atom("snapshot_ets_table_#{Utils.uuid4()}"),
      log_ets_table: String.to_atom("log_ets_table_#{Utils.uuid4()}"),
      chunk_checkpoint_ets_table: String.to_atom("chunk_checkpoint_ets_table_#{Utils.uuid4()}"),
      electric_instance_id: electric_instance_id
    ]
  end

  defp opts(FileStorage, %{tmp_dir: tmp_dir, electric_instance_id: electric_instance_id}) do
    [
      db: String.to_atom("shape_mixed_disk_#{Utils.uuid4()}"),
      storage_dir: tmp_dir,
      electric_instance_id: electric_instance_id
    ]
  end
end
