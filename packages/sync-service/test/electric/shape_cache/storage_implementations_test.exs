defmodule Electric.ShapeCache.StorageImplimentationsTest do
  use ExUnit.Case, async: true
  import Support.TestUtils

  alias Electric.LogItems
  alias Electric.Postgres.Lsn
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes
  alias Electric.ShapeCache.CubDbStorage
  alias Electric.ShapeCache.InMemoryStorage
  alias Electric.Shapes.Shape
  alias Electric.Utils
  @moduletag :tmp_dir

  @shape_id "the-shape-id"
  @shape %Shape{
    root_table: {"public", "the-table"},
    table_info: %{
      {"public", "the-table"} => %{
        pk: ["id"]
      }
    }
  }
  @snapshot_offset LogOffset.first()
  @snapshot_offset_encoded to_string(@snapshot_offset)
  @zero_offset LogOffset.first()
  @query_info %Postgrex.Query{
    name: "the-table",
    columns: ["id", "title"],
    result_types: [Postgrex.Extensions.UUID, Postgrex.Extensions.Raw]
  }
  @data_stream [
    [<<1::128>>, "row1"],
    [<<2::128>>, "row2"]
  ]

  for module <- [InMemoryStorage, CubDbStorage] do
    module_name = module |> Module.split() |> List.last()

    doctest module, import: true

    describe "#{module_name}.snapshot_started?/2" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "returns false when shape does not exist", %{module: storage, opts: opts} do
        assert storage.snapshot_started?(@shape_id, opts) == false
      end

      test "returns true when snapshot has started", %{module: storage, opts: opts} do
        storage.mark_snapshot_as_started(@shape_id, opts)

        assert storage.snapshot_started?(@shape_id, opts) == true
      end
    end

    describe "#{module_name}.get_snapshot/2" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "returns snapshot when shape does exist", %{module: storage, opts: opts} do
        storage.mark_snapshot_as_started(@shape_id, opts)
        storage.make_new_snapshot!(@shape_id, @shape, @query_info, @data_stream, opts)

        {@snapshot_offset, stream} = storage.get_snapshot(@shape_id, opts)

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

      test "does not leak results from other snapshots", %{module: storage, opts: opts} do
        another_data_stream = [
          [<<3::128>>, "row3"],
          [<<4::128>>, "row4"]
        ]

        storage.mark_snapshot_as_started(@shape_id, opts)
        storage.make_new_snapshot!(@shape_id, @shape, @query_info, @data_stream, opts)

        storage.mark_snapshot_as_started("another-shape-id", opts)

        storage.make_new_snapshot!(
          "another-shape-id",
          @shape,
          @query_info,
          another_data_stream,
          opts
        )

        {@snapshot_offset, stream} = storage.get_snapshot(@shape_id, opts)

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
        storage.mark_snapshot_as_started(@shape_id, opts)
        storage.make_new_snapshot!(@shape_id, @shape, @query_info, @data_stream, opts)

        {@snapshot_offset, _} = storage.get_snapshot(@shape_id, opts)
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

        storage.mark_snapshot_as_started(@shape_id, opts)
        storage.make_new_snapshot!(@shape_id, @shape, @query_info, @data_stream, opts)
        :ok = storage.append_to_log!(@shape_id, log_items, opts)

        {@snapshot_offset, stream} = storage.get_snapshot(@shape_id, opts)
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
            [<<i::128>>, "row#{i}"]
          end)

        storage.mark_snapshot_as_started(@shape_id, opts)
        {@snapshot_offset, stream} = storage.get_snapshot(@shape_id, opts)

        read_task =
          Task.async(fn ->
            log = Enum.to_list(stream)

            assert Enum.count(log) == row_count

            for {item, i} <- Enum.with_index(log, 1) do
              assert Jason.decode!(item, keys: :atoms).value.title == "row#{i}"
            end
          end)

        storage.make_new_snapshot!(@shape_id, @shape, @query_info, data_stream, opts)

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

        :ok = storage.append_to_log!(@shape_id, log_items, opts)

        stream = storage.get_log_stream(@shape_id, LogOffset.first(), LogOffset.last(), opts)

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

        :ok = storage.append_to_log!(@shape_id, log_items, opts)

        log1 =
          storage.get_log_stream(@shape_id, LogOffset.first(), LogOffset.last(), opts)
          |> Enum.map(&:json.decode/1)

        :ok = storage.append_to_log!(@shape_id, log_items, opts)

        log2 =
          storage.get_log_stream(@shape_id, LogOffset.first(), LogOffset.last(), opts)
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
        shape_id = "test_shape"
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

        :ok = storage.append_to_log!(shape_id, log_items1, opts)
        :ok = storage.append_to_log!(shape_id, log_items2, opts)

        stream = storage.get_log_stream(shape_id, LogOffset.first(), LogOffset.last(), opts)
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

        :ok = storage.append_to_log!(@shape_id, log_items1, opts)
        :ok = storage.append_to_log!(@shape_id, log_items2, opts)

        stream =
          storage.get_log_stream(@shape_id, LogOffset.new(lsn1, 0), LogOffset.last(), opts)

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

        :ok = storage.append_to_log!(@shape_id, log_items1, opts)
        :ok = storage.append_to_log!(@shape_id, log_items2, opts)

        stream =
          storage.get_log_stream(
            @shape_id,
            LogOffset.new(lsn1, 0),
            LogOffset.new(lsn2, 0),
            opts
          )

        entries = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        assert [%{headers: %{operation: "update"}}] = entries
      end

      test "returns only logs for the requested shape_id", %{module: storage, opts: opts} do
        shape_id1 = "shape_a"
        shape_id2 = "shape_b"
        lsn1 = Lsn.from_integer(1000)
        lsn2 = Lsn.from_integer(2000)

        log_items1 =
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "123", "name" => "Test A"},
              log_offset: LogOffset.new(lsn1, 0)
            }
          ]
          |> changes_to_log_items()

        log_items2 =
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "456", "name" => "Test B"},
              log_offset: LogOffset.new(lsn2, 0)
            }
          ]
          |> changes_to_log_items()

        :ok = storage.append_to_log!(shape_id1, log_items1, opts)
        :ok = storage.append_to_log!(shape_id2, log_items2, opts)

        assert [%{value: %{name: "Test A"}}] =
                 storage.get_log_stream(shape_id1, LogOffset.first(), LogOffset.last(), opts)
                 |> Enum.map(&Jason.decode!(&1, keys: :atoms))
      end
    end

    describe "#{module_name}.cleanup!/2" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "causes snapshot_started?/2 to return false", %{module: storage, opts: opts} do
        storage.make_new_snapshot!(@shape_id, @shape, @query_info, @data_stream, opts)

        storage.cleanup!(@shape_id, opts)

        assert storage.snapshot_started?(@shape_id, opts) == false
      end

      test "causes get_snapshot/2 to raise an error", %{module: storage, opts: opts} do
        storage.mark_snapshot_as_started(@shape_id, opts)
        storage.make_new_snapshot!(@shape_id, @shape, @query_info, @data_stream, opts)

        storage.cleanup!(@shape_id, opts)

        assert_raise RuntimeError, fn ->
          {@zero_offset, stream} = storage.get_snapshot(@shape_id, opts)
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

        :ok = storage.append_to_log!(@shape_id, log_items, opts)

        storage.cleanup!(@shape_id, opts)

        assert storage.get_log_stream(@shape_id, LogOffset.first(), LogOffset.last(), opts)
               |> Enum.to_list() == []
      end
    end

    describe "#{module_name}.has_log_entry?/3" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "returns a boolean indicating whether there is a log entry with such an offset", %{
        module: storage,
        opts: opts
      } do
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

        :ok = storage.append_to_log!(@shape_id, log_items, opts)

        assert storage.has_log_entry?(@shape_id, LogOffset.new(lsn, 0), opts)
        refute storage.has_log_entry?(@shape_id, LogOffset.new(lsn, 1), opts)
        refute storage.has_log_entry?(@shape_id, LogOffset.new(1001, 0), opts)
      end

      test "should detect whether there is a snapshot with given offset", %{
        module: storage,
        opts: opts
      } do
        refute storage.has_log_entry?(@shape_id, @snapshot_offset, opts)
        storage.mark_snapshot_as_started(@shape_id, opts)
        assert storage.has_log_entry?(@shape_id, @snapshot_offset, opts)
      end

      test "should return false when there is no log", %{module: storage, opts: opts} do
        refute storage.has_log_entry?("another_shape_id", LogOffset.new(1001, 0), opts)
      end
    end
  end

  # Tests for storage implimentations that are recoverable
  for module <- [CubDbStorage] do
    module_name = module |> Module.split() |> List.last()

    describe "#{module_name}.list_shapes/1" do
      @shape %Shape{
        root_table: {"public", "items"},
        table_info: %{
          {"public", "items"} => %{
            pk: ["id"]
          }
        }
      }
      @first_offset LogOffset.first()
      @change_offset LogOffset.new(Lsn.from_integer(123), 0)
      @log_items [
                   %Changes.NewRecord{
                     relation: {"public", "test_table"},
                     record: %{"id" => "123", "name" => "Test"},
                     log_offset: @change_offset
                   }
                 ]
                 |> Enum.map(&Changes.fill_key(&1, ["id"]))
                 |> Enum.flat_map(&LogItems.from_change(&1, 0, ["id"]))

      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "returns shapes with it's snapshot xmins", %{module: storage, opts: opts} do
        storage.add_shape("shape-1", @shape, opts)
        storage.add_shape("shape-2", @shape, opts)
        storage.set_snapshot_xmin("shape-1", 11, opts)
        storage.set_snapshot_xmin("shape-2", 22, opts)

        assert [
                 %{shape_id: "shape-1", snapshot_xmin: 11},
                 %{shape_id: "shape-2", snapshot_xmin: 22}
               ] =
                 storage.list_shapes(opts)
      end

      test "returns shapes with it's latest offset", %{module: storage, opts: opts} do
        storage.add_shape("shape-1", @shape, opts)
        storage.add_shape("shape-2", @shape, opts)
        storage.add_shape("shape-3", @shape, opts)

        storage.make_new_snapshot!("shape-1", @shape, @query_info, @data_stream, opts)
        storage.append_to_log!("shape-1", @log_items, opts)

        storage.make_new_snapshot!("shape-2", @shape, @query_info, @data_stream, opts)

        assert [
                 %{shape_id: "shape-1", latest_offset: @change_offset},
                 %{shape_id: "shape-2", latest_offset: @first_offset},
                 %{shape_id: "shape-3", latest_offset: @first_offset}
               ] =
                 storage.list_shapes(opts)
      end

      test "does not return cleaned up shape", %{module: storage, opts: opts} do
        storage.add_shape("shape-1", @shape, opts)
        storage.add_shape("shape-2", @shape, opts)
        storage.add_shape("shape-3", @shape, opts)

        storage.cleanup!("shape-2", opts)

        assert [%{shape_id: "shape-1"}, %{shape_id: "shape-3"}] =
                 storage.list_shapes(opts)
      end
    end

    describe "#{module_name}.initialise/1" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "removes the shape if the snapshot_xmin has not been set", %{
        module: storage,
        opts: opts
      } do
        storage.initialise(opts)

        storage.add_shape("shape-1", @shape, opts)
        storage.add_shape("shape-2", @shape, opts)
        storage.add_shape("shape-3", @shape, opts)
        storage.mark_snapshot_as_started("shape-1", opts)
        storage.mark_snapshot_as_started("shape-2", opts)
        storage.mark_snapshot_as_started("shape-3", opts)
        storage.make_new_snapshot!("shape-1", @shape, @query_info, @data_stream, opts)
        storage.make_new_snapshot!("shape-2", @shape, @query_info, @data_stream, opts)
        storage.make_new_snapshot!("shape-3", @shape, @query_info, @data_stream, opts)
        storage.set_snapshot_xmin("shape-1", 11, opts)
        storage.set_snapshot_xmin("shape-3", 33, opts)

        storage.initialise(opts)

        assert storage.snapshot_started?("shape-1", opts) == true
        assert storage.snapshot_started?("shape-2", opts) == false
        assert storage.snapshot_started?("shape-3", opts) == true
      end

      test "removes the shape if the snapshot has not finished", %{
        module: storage,
        opts: opts
      } do
        storage.initialise(opts)

        storage.add_shape("shape-1", @shape, opts)
        storage.add_shape("shape-2", @shape, opts)
        storage.add_shape("shape-3", @shape, opts)
        storage.mark_snapshot_as_started("shape-1", opts)
        storage.mark_snapshot_as_started("shape-2", opts)
        storage.mark_snapshot_as_started("shape-3", opts)
        storage.make_new_snapshot!("shape-1", @shape, @query_info, @data_stream, opts)
        storage.make_new_snapshot!("shape-3", @shape, @query_info, @data_stream, opts)
        storage.set_snapshot_xmin("shape-1", 11, opts)
        storage.set_snapshot_xmin("shape-2", 22, opts)
        storage.set_snapshot_xmin("shape-3", 33, opts)

        storage.initialise(opts)

        assert storage.snapshot_started?("shape-1", opts) == true
        assert storage.snapshot_started?("shape-2", opts) == false
        assert storage.snapshot_started?("shape-3", opts) == true
      end

      test "removes all shapes if the storage version has changed", %{
        module: storage,
        opts: opts
      } do
        storage.initialise(opts)

        storage.add_shape("shape-1", @shape, opts)
        storage.add_shape("shape-2", @shape, opts)
        storage.add_shape("shape-3", @shape, opts)
        storage.mark_snapshot_as_started("shape-1", opts)
        storage.mark_snapshot_as_started("shape-2", opts)
        storage.mark_snapshot_as_started("shape-3", opts)
        storage.make_new_snapshot!("shape-1", @shape, @query_info, @data_stream, opts)
        storage.make_new_snapshot!("shape-2", @shape, @query_info, @data_stream, opts)
        storage.make_new_snapshot!("shape-3", @shape, @query_info, @data_stream, opts)
        storage.set_snapshot_xmin("shape-1", 11, opts)
        storage.set_snapshot_xmin("shape-2", 22, opts)
        storage.set_snapshot_xmin("shape-3", 33, opts)

        storage.initialise(%{opts | version: "new-version"})

        assert storage.snapshot_started?("shape-1", opts) == false
        assert storage.snapshot_started?("shape-2", opts) == false
        assert storage.snapshot_started?("shape-3", opts) == false
      end
    end
  end

  defp start_storage(%{module: module} = context) do
    {:ok, opts} = module |> opts(context) |> module.shared_opts()
    {:ok, _} = module.start_link(opts)

    {:ok, %{module: module, opts: opts}}
  end

  defp opts(InMemoryStorage, _context) do
    [
      snapshot_ets_table: String.to_atom("snapshot_ets_table_#{Utils.uuid4()}"),
      log_ets_table: String.to_atom("log_ets_table_#{Utils.uuid4()}")
    ]
  end

  defp opts(CubDbStorage, %{tmp_dir: tmp_dir}) do
    [
      db: String.to_atom("shape_cubdb_#{Utils.uuid4()}"),
      file_path: tmp_dir
    ]
  end
end
