defmodule Electric.ShapeCache.StorageImplimentationsTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit

  alias Electric.ShapeCache.PureFileStorage
  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.Storage
  alias Electric.Postgres.Lsn
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes
  alias Electric.ShapeCache.InMemoryStorage
  alias Electric.Utils

  import Support.ComponentSetup
  import Support.TestUtils

  @moduletag :tmp_dir

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

  @snapshot_offset LogOffset.first()
  @snapshot_offset_encoded to_string(@snapshot_offset)
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

  setup [:with_stack_id_from_test, :with_async_deleter]

  for module <- [InMemoryStorage, PureFileStorage] do
    module_name = module |> Module.split() |> List.last()

    @moduletag storage: module_name
    @moduletag mod: module

    doctest module, import: true

    describe "#{module_name}.snapshot_started?/2" do
      setup :start_storage

      test "returns false when shape does not exist", %{storage: opts} do
        assert Storage.snapshot_started?(opts) == false
      end

      test "returns true when snapshot has started", %{storage: opts} do
        Storage.mark_snapshot_as_started(opts)

        assert Storage.snapshot_started?(opts) == true
      end
    end

    describe "#{module_name}.get_current_position/1 and get_latest_offset/1" do
      setup :start_storage

      test "returns the earliest possible position on startup", %{storage: opts} do
        assert Storage.get_current_position(opts) ==
                 {:ok, LogOffset.last_before_real_offsets(), nil}

        assert Storage.get_latest_offset(opts) ==
                 {:ok, LogOffset.last_before_real_offsets()}
      end

      test "returns the saved position for snapshot", %{storage: opts} do
        Storage.set_pg_snapshot(%{xmin: 100}, opts)

        assert Storage.get_current_position(opts) ==
                 {:ok, LogOffset.last_before_real_offsets(), %{xmin: 100}}
      end

      @tag chunk_size: 100
      test "returns the last known position for snapshot if snapshot is multiple chunks", %{
        storage: opts
      } do
        Storage.mark_snapshot_as_started(opts)
        Storage.make_new_snapshot!(@data_stream |> Enum.intersperse(:chunk_boundary), opts)

        assert Storage.get_current_position(opts) == {:ok, LogOffset.new(0, 1), nil}
        assert Storage.get_latest_offset(opts) == {:ok, LogOffset.new(0, 1)}
      end

      @tag chunk_size: 100
      test "returns the last written position after writing to the log", %{
        storage: opts,
        writer: writer
      } do
        Storage.mark_snapshot_as_started(opts)
        Storage.make_new_snapshot!(@data_stream |> Enum.intersperse(:chunk_boundary), opts)

        %Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "123", "name" => "Test"},
          log_offset: LogOffset.new(1000, 0)
        }
        |> List.wrap()
        |> changes_to_log_items()
        |> Storage.append_to_log!(writer)

        assert Storage.get_current_position(opts) == {:ok, LogOffset.new(1000, 0), nil}
        assert Storage.get_latest_offset(opts) == {:ok, LogOffset.new(1000, 0)}
      end
    end

    describe "#{module_name}.append_to_log!/3" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage
      setup :start_empty_snapshot

      test "adds items to the log", %{storage: opts, writer: writer} do
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

        Storage.append_to_log!(log_items, writer)

        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)

        assert [
                 %{
                   key: ~S|"public"."test_table"/"123"|,
                   value: %{id: "123", name: "Test"},
                   headers: %{
                     operation: "insert",
                     txids: [1],
                     relation: ["public", "test_table"],
                     lsn: "1000",
                     op_position: 0
                   }
                 }
               ] == Enum.map(stream, &Jason.decode!(&1, keys: :atoms))
      end

      test "adds a lot of items to the log correctly", %{storage: opts, writer: writer} do
        lsn = Lsn.from_integer(1000)

        # Roughly 24MB
        log_items =
          for x <- 0..100_000 do
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "123", "name" => "Test"},
              log_offset: LogOffset.new(lsn, x)
            }
          end
          |> changes_to_log_items()

        Storage.append_to_log!(log_items, writer)

        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)

        expected =
          for x <- 0..100_000 do
            %{
              key: ~S|"public"."test_table"/"123"|,
              value: %{id: "123", name: "Test"},
              headers: %{
                operation: "insert",
                txids: [1],
                relation: ["public", "test_table"],
                lsn: "1000",
                op_position: x
              }
            }
          end

        assert expected == Enum.map(stream, &Jason.decode!(&1, keys: :atoms))
      end

      test "adds a lot of items to the log correctly in separate steps", %{
        storage: opts,
        writer: writer
      } do
        log_items =
          for x <- 1..10_000 do
            changes_to_log_items([
              %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "123", "name" => "Test"},
                log_offset: LogOffset.new(x, 0)
              }
            ])
          end

        Enum.reduce(log_items, writer, &Storage.append_to_log!/2)

        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)

        expected =
          for x <- 1..10000 do
            %{
              key: ~S|"public"."test_table"/"123"|,
              value: %{id: "123", name: "Test"},
              headers: %{
                operation: "insert",
                txids: [1],
                relation: ["public", "test_table"],
                lsn: "#{x}",
                op_position: 0
              }
            }
          end

        assert expected == Enum.map(stream, &Jason.decode!(&1, keys: :atoms))
      end

      test "adds items to the log in idempotent way", %{storage: opts, writer: writer} do
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

        writer = Storage.append_to_log!(log_items, writer)

        log1 =
          Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
          |> Enum.map(&:json.decode/1)

        _writer = Storage.append_to_log!(log_items, writer)

        log2 =
          Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
          |> Enum.map(&:json.decode/1)

        assert log1 == log2
      end
    end

    describe "#{module_name}.get_log_stream/4 for appended txns" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage
      setup :start_empty_snapshot

      test "returns correct stream of log items", %{storage: opts, writer: writer} do
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

        writer = Storage.append_to_log!(log_items1, writer)
        _writer = Storage.append_to_log!(log_items2, writer)

        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
        entries = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        assert [
                 %{headers: %{operation: "insert"}},
                 %{headers: %{operation: "update"}},
                 %{headers: %{operation: "delete"}}
               ] = entries
      end

      test "returns stream of log items after offset", %{storage: opts, writer: writer} do
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

        writer = Storage.append_to_log!(log_items1, writer)
        _writer = Storage.append_to_log!(log_items2, writer)

        stream =
          Storage.get_log_stream(LogOffset.new(lsn1, 0), LogOffset.last(), opts)

        entries = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        assert [
                 %{headers: %{operation: "update"}},
                 %{headers: %{operation: "delete"}}
               ] = entries
      end

      test "returns stream of log items after offset and before max_offset (inclusive)", %{
        storage: opts,
        writer: writer
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

        writer = Storage.append_to_log!(log_items1, writer)
        _writer = Storage.append_to_log!(log_items2, writer)

        stream =
          Storage.get_log_stream(
            LogOffset.new(lsn1, 0),
            LogOffset.new(lsn2, 0),
            opts
          )

        entries = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        assert [%{headers: %{operation: "update"}}] = entries
      end
    end

    describe "#{module_name}.append_control_message!/2" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage
      setup :start_empty_snapshot

      test "appends a control message to the log", %{storage: opts, writer: writer} do
        control_message = %{headers: %{control: "must_refetch"}}

        {inserted_range, _writer} = Storage.append_control_message!(control_message, writer)

        # Verify the inserted range
        assert {%LogOffset{}, %LogOffset{}} = inserted_range

        # Verify we can read the control message back
        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
        assert [json] = Enum.to_list(stream)

        decoded = Jason.decode!(json, keys: :atoms)
        assert decoded == control_message
      end

      test "control message preserves structure", %{storage: opts, writer: writer} do
        control_message = %{
          headers: %{
            event: "move-out",
            patterns: [%{value: "test"}]
          }
        }

        {_inserted_range, _writer} = Storage.append_control_message!(control_message, writer)

        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
        [json] = Enum.to_list(stream)

        decoded = Jason.decode!(json, keys: :atoms)
        assert decoded == control_message
      end

      test "appends multiple control messages", %{storage: opts, writer: writer} do
        writer =
          Storage.append_control_message!(%{headers: %{control: "must_refetch"}}, writer)
          |> elem(1)

        writer =
          Storage.append_control_message!(%{headers: %{control: "up_to_date"}}, writer)
          |> elem(1)

        Storage.append_control_message!(%{headers: %{control: "another_message"}}, writer)

        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
        messages = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        assert length(messages) == 3
        assert Enum.at(messages, 0).headers.control == "must_refetch"
        assert Enum.at(messages, 1).headers.control == "up_to_date"
        assert Enum.at(messages, 2).headers.control == "another_message"
      end
    end

    describe "#{module_name}.write_move_in_snapshot!/3 and append_move_in_snapshot_to_log!/2" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage
      setup :start_empty_snapshot

      test "writes and appends basic move-in snapshot", %{
        storage: opts,
        writer: writer
      } do
        move_in_data = [
          ["key1", [], Jason.encode!(%{id: "1", name: "row1"})],
          ["key2", ["tag1"], Jason.encode!(%{id: "2", name: "row2"})],
          ["key3", ["tag2", "tag3"], Jason.encode!(%{id: "3", name: "row3"})]
        ]

        # Write the move-in snapshot
        Storage.write_move_in_snapshot!(move_in_data, "test-move-in", opts)

        # Append to log without filtering (unfiltered version)
        {inserted_range, _writer} =
          Storage.append_move_in_snapshot_to_log!("test-move-in", writer)

        # Verify the inserted range
        assert {%LogOffset{}, %LogOffset{}} = inserted_range

        # Verify all rows were included
        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
        items = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        assert length(items) == 3

        # Check that items have expected data
        assert Enum.any?(items, &(&1.id == "1" && &1.name == "row1"))
        assert Enum.any?(items, &(&1.id == "2" && &1.name == "row2"))
        assert Enum.any?(items, &(&1.id == "3" && &1.name == "row3"))
      end
    end

    describe "#{module_name}.append_move_in_snapshot_to_log_filtered!/5" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage
      setup :start_empty_snapshot

      test "includes rows with keys in touch_tracker and visible txid", %{
        storage: opts,
        writer: writer
      } do
        move_in_data = [
          ["key1", [], Jason.encode!(%{id: "1", name: "row1"})],
          ["key2", [], Jason.encode!(%{id: "2", name: "row2"})],
          ["key3", [], Jason.encode!(%{id: "3", name: "row3"})]
        ]

        Storage.write_move_in_snapshot!(move_in_data, "test-move-in", opts)

        # Touch tracker: key2 was touched by txid 120
        touch_tracker = %{"key2" => 120}

        # Snapshot: {xmin: 100, xmax: 200, xip_list: [150]}
        # txid 120 is visible in this snapshot (100 <= 120 < 200 and not in xip_list)
        # This means the touch happened BEFORE the snapshot, so query data is fresher
        snapshot = {100, 200, [150]}

        tags_to_skip = MapSet.new()

        {inserted_range, _writer} =
          Storage.append_move_in_snapshot_to_log_filtered!(
            "test-move-in",
            writer,
            touch_tracker,
            snapshot,
            tags_to_skip
          )

        assert {%LogOffset{}, %LogOffset{}} = inserted_range

        # All rows should be included (key2's touch was before snapshot)
        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
        items = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        assert length(items) == 3
        assert Enum.any?(items, &(&1.id == "1" && &1.name == "row1"))
        assert Enum.any?(items, &(&1.id == "2" && &1.name == "row2"))
        assert Enum.any?(items, &(&1.id == "3" && &1.name == "row3"))
      end

      test "filters out rows with keys in touch_tracker and non-visible txid", %{
        storage: opts,
        writer: writer
      } do
        move_in_data = [
          ["key1", [], Jason.encode!(%{id: "1", name: "row1"})],
          ["key2", [], Jason.encode!(%{id: "2", name: "row2"})],
          ["key3", [], Jason.encode!(%{id: "3", name: "row3"})]
        ]

        Storage.write_move_in_snapshot!(move_in_data, "test-move-in", opts)

        # Touch tracker: key2 was touched by txid 150
        touch_tracker = %{"key2" => 150}

        # Snapshot: {xmin: 100, xmax: 200, xip_list: [150]}
        # txid 150 is NOT visible (in xip_list = in progress during snapshot)
        # This means the touch happened AFTER the snapshot, so we have fresher data in stream
        snapshot = {100, 200, [150]}

        tags_to_skip = MapSet.new()

        {inserted_range, _writer} =
          Storage.append_move_in_snapshot_to_log_filtered!(
            "test-move-in",
            writer,
            touch_tracker,
            snapshot,
            tags_to_skip
          )

        assert {%LogOffset{}, %LogOffset{}} = inserted_range

        # Only key1 and key3 should be included (key2 filtered out due to fresher data)
        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
        items = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        assert length(items) == 2
        assert Enum.any?(items, &(&1.id == "1"))
        assert Enum.any?(items, &(&1.id == "3"))
        refute Enum.any?(items, &(&1.id == "2"))
      end

      test "filters out rows where all tags are in tags_to_skip", %{
        storage: opts,
        writer: writer
      } do
        move_in_data = [
          ["key1", [], Jason.encode!(%{id: "1", name: "row1"})],
          ["key2", ["tag1"], Jason.encode!(%{id: "2", name: "row2"})],
          ["key3", ["tag1", "tag2"], Jason.encode!(%{id: "3", name: "row3"})],
          ["key4", ["tag3"], Jason.encode!(%{id: "4", name: "row4"})]
        ]

        Storage.write_move_in_snapshot!(move_in_data, "test-move-in", opts)

        touch_tracker = %{}
        snapshot = {100, 200, []}
        # Skip rows where ALL tags are in this set
        tags_to_skip = MapSet.new(["tag1", "tag2"])

        {inserted_range, _writer} =
          Storage.append_move_in_snapshot_to_log_filtered!(
            "test-move-in",
            writer,
            touch_tracker,
            snapshot,
            tags_to_skip
          )

        assert {%LogOffset{}, %LogOffset{}} = inserted_range

        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
        items = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        # key1: no tags -> included
        # key2: [tag1] -> all in tags_to_skip -> FILTERED OUT
        # key3: [tag1, tag2] -> all in tags_to_skip -> FILTERED OUT
        # key4: [tag3] -> not all in tags_to_skip -> included
        assert length(items) == 2
        assert Enum.any?(items, &(&1.id == "1"))
        assert Enum.any?(items, &(&1.id == "4"))
        refute Enum.any?(items, &(&1.id == "2"))
        refute Enum.any?(items, &(&1.id == "3"))
      end

      test "includes rows with partial tag overlap", %{
        storage: opts,
        writer: writer
      } do
        move_in_data = [
          ["key1", ["tag1", "tag_other"], Jason.encode!(%{id: "1", name: "row1"})],
          ["key2", ["tag2", "tag_other"], Jason.encode!(%{id: "2", name: "row2"})]
        ]

        Storage.write_move_in_snapshot!(move_in_data, "test-move-in", opts)

        touch_tracker = %{}
        snapshot = {100, 200, []}
        # Only skip if ALL tags are in this set
        tags_to_skip = MapSet.new(["tag1", "tag2"])

        {inserted_range, _writer} =
          Storage.append_move_in_snapshot_to_log_filtered!(
            "test-move-in",
            writer,
            touch_tracker,
            snapshot,
            tags_to_skip
          )

        assert {%LogOffset{}, %LogOffset{}} = inserted_range

        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
        items = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        # Both rows have tag_other which is NOT in tags_to_skip
        # So they are NOT full subsets -> both included
        assert length(items) == 2
        assert Enum.any?(items, &(&1.id == "1"))
        assert Enum.any?(items, &(&1.id == "2"))
      end

      test "combines touch_tracker and tag filtering", %{
        storage: opts,
        writer: writer
      } do
        move_in_data = [
          ["key1", [], Jason.encode!(%{id: "1", name: "row1"})],
          ["key2", ["tag1"], Jason.encode!(%{id: "2", name: "row2"})],
          ["key3", ["tag1"], Jason.encode!(%{id: "3", name: "row3"})],
          ["key4", ["tag2"], Jason.encode!(%{id: "4", name: "row4"})]
        ]

        Storage.write_move_in_snapshot!(move_in_data, "test-move-in", opts)

        # key2 was touched by non-visible txid -> will be filtered by touch_tracker
        touch_tracker = %{"key2" => 150}
        snapshot = {100, 200, [150]}
        # key3 will be filtered by tags (all tags in skip set)
        tags_to_skip = MapSet.new(["tag1"])

        {inserted_range, _writer} =
          Storage.append_move_in_snapshot_to_log_filtered!(
            "test-move-in",
            writer,
            touch_tracker,
            snapshot,
            tags_to_skip
          )

        assert {%LogOffset{}, %LogOffset{}} = inserted_range

        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
        items = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        # key1: no touch, no tags -> included
        # key2: touched with non-visible txid (fresher data in stream) -> filtered by touch_tracker
        # key3: all tags in skip set -> filtered by tags
        # key4: has tag2 which is not in skip set -> included
        assert length(items) == 2
        assert Enum.any?(items, &(&1.id == "1"))
        assert Enum.any?(items, &(&1.id == "4"))
        refute Enum.any?(items, &(&1.id == "2"))
        refute Enum.any?(items, &(&1.id == "3"))
      end

      test "handles empty touch_tracker and tags_to_skip", %{
        storage: opts,
        writer: writer
      } do
        move_in_data = [
          ["key1", [], Jason.encode!(%{id: "1", name: "row1"})],
          ["key2", ["tag1"], Jason.encode!(%{id: "2", name: "row2"})]
        ]

        Storage.write_move_in_snapshot!(move_in_data, "test-move-in", opts)

        touch_tracker = %{}
        snapshot = {100, 200, []}
        tags_to_skip = MapSet.new()

        {inserted_range, _writer} =
          Storage.append_move_in_snapshot_to_log_filtered!(
            "test-move-in",
            writer,
            touch_tracker,
            snapshot,
            tags_to_skip
          )

        assert {%LogOffset{}, %LogOffset{}} = inserted_range

        # No filtering should occur
        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
        items = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        assert length(items) == 2
        assert Enum.any?(items, &(&1.id == "1"))
        assert Enum.any?(items, &(&1.id == "2"))
      end

      test "filters all rows when all conditions match", %{
        storage: opts,
        writer: writer
      } do
        move_in_data = [
          ["key1", ["skip_tag"], Jason.encode!(%{id: "1", name: "row1"})],
          ["key2", ["skip_tag"], Jason.encode!(%{id: "2", name: "row2"})]
        ]

        Storage.write_move_in_snapshot!(move_in_data, "test-move-in", opts)

        touch_tracker = %{}
        snapshot = {100, 200, []}
        tags_to_skip = MapSet.new(["skip_tag"])

        {inserted_range, _writer} =
          Storage.append_move_in_snapshot_to_log_filtered!(
            "test-move-in",
            writer,
            touch_tracker,
            snapshot,
            tags_to_skip
          )

        assert {%LogOffset{}, %LogOffset{}} = inserted_range

        # All rows should be filtered out
        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
        items = Enum.to_list(stream)

        assert items == []
      end

      test "correctly handles empty tag list on rows", %{
        storage: opts,
        writer: writer
      } do
        move_in_data = [
          ["key1", [], Jason.encode!(%{id: "1", name: "row1"})],
          ["key2", [], Jason.encode!(%{id: "2", name: "row2"})]
        ]

        Storage.write_move_in_snapshot!(move_in_data, "test-move-in", opts)

        touch_tracker = %{}
        snapshot = {100, 200, []}
        # Tags to skip set is non-empty
        tags_to_skip = MapSet.new(["tag1"])

        {inserted_range, _writer} =
          Storage.append_move_in_snapshot_to_log_filtered!(
            "test-move-in",
            writer,
            touch_tracker,
            snapshot,
            tags_to_skip
          )

        assert {%LogOffset{}, %LogOffset{}} = inserted_range

        # Empty tag lists should NOT be filtered (not a full subset of tags_to_skip)
        stream = Storage.get_log_stream(LogOffset.first(), LogOffset.last(), opts)
        items = Enum.map(stream, &Jason.decode!(&1, keys: :atoms))

        assert length(items) == 2
        assert Enum.any?(items, &(&1.id == "1"))
        assert Enum.any?(items, &(&1.id == "2"))
      end
    end

    describe "#{module_name}.get_log_stream/4 for snapshots" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "returns snapshot when shape does exist", %{storage: opts} do
        Storage.mark_snapshot_as_started(opts)
        Storage.make_new_snapshot!(@data_stream, opts)

        stream =
          Storage.get_log_stream(LogOffset.before_all(), LogOffset.new(0, 0), opts)

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

      test "does not return items not in the snapshot", %{storage: opts, writer: writer} do
        log_items =
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "123", "name" => "Test"},
              log_offset: LogOffset.new(Lsn.from_integer(1000), 0)
            }
          ]
          |> changes_to_log_items()

        Storage.mark_snapshot_as_started(opts)
        Storage.make_new_snapshot!(@data_stream, opts)
        Storage.append_to_log!(log_items, writer)

        stream =
          Storage.get_log_stream(
            LogOffset.before_all(),
            LogOffset.last_before_real_offsets(),
            opts
          )

        assert Enum.count(stream) == Enum.count(@data_stream)
      end

      test "returns complete snapshot when the snapshot is concurrently being written", %{
        storage: opts
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

        Storage.mark_snapshot_as_started(opts)
        stream = Storage.get_log_stream(LogOffset.before_all(), LogOffset.first(), opts)

        read_task =
          Task.async(fn ->
            log = Enum.to_list(stream)

            assert Enum.count(log) == row_count

            for {item, i} <- Enum.with_index(log, 1) do
              assert Jason.decode!(item, keys: :atoms).value.title == "row#{i}"
            end
          end)

        Storage.make_new_snapshot!(data_stream, opts)

        Task.await(read_task)
      end
    end
  end

  # Tests for storage implementations that are recoverable
  for module <- [PureFileStorage] do
    module_name = module |> Module.split() |> List.last()
    @moduletag storage: module_name
    @moduletag mod: module

    # FS is occasionally slow so we set a high timeout for compaction
    @default_compaction_timeout 2000

    describe "#{module_name}.compact/1" do
      setup :start_storage

      # Super small chunk size so that each update is its own chunk
      @tag chunk_size: 5
      test "can compact operations within a shape", %{storage: storage, writer: writer} do
        Storage.mark_snapshot_as_started(storage)
        Storage.make_new_snapshot!([], storage)
        Storage.set_pg_snapshot(%{xmin: 1, xmax: 10}, storage)

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
        |> Storage.append_to_log!(writer)

        Storage.terminate(writer)

        assert Storage.get_log_stream(LogOffset.first(), LogOffset.new(7, 0), storage)
               |> Enum.to_list()
               |> length() == 7

        assert :ok = Storage.compact(storage)

        assert_receive {Storage, msg}, @default_compaction_timeout
        writer = Storage.init_writer!(storage, @shape)
        _writer = Storage.apply_message(writer, msg)

        assert [line] =
                 Storage.get_log_stream(LogOffset.first(), LogOffset.new(7, 0), storage)
                 |> Enum.to_list()

        assert Jason.decode!(line, keys: :atoms) == %{
                 value: %{id: "sameid", name: "Test8"},
                 key: ~S|"public"."test_table"/"sameid"|,
                 headers: %{operation: "update", relation: ["public", "test_table"]}
               }
      end

      @tag chunk_size: 5
      test "compaction doesn't bridge deletes", %{storage: storage, writer: writer} do
        Storage.mark_snapshot_as_started(storage)
        Storage.make_new_snapshot!([], storage)
        Storage.set_pg_snapshot(%{xmin: 1, xmax: 10}, storage)

        writer =
          for i <- 1..10 do
            update = %Changes.UpdatedRecord{
              relation: {"public", "test_table"},
              old_record: %{"id" => "sameid", "name" => "Test#{i - 1}"},
              record: %{"id" => "sameid", "name" => "Test#{i}"},
              log_offset: LogOffset.new(i, 0),
              changed_columns: MapSet.new(["name"])
            }

            if i == 5 do
              delete = %Changes.DeletedRecord{
                relation: {"public", "test_table"},
                old_record: %{"id" => "sameid", "name" => "Test#{i}"},
                log_offset: LogOffset.new(i, 1)
              }

              insert = %Changes.NewRecord{
                relation: {"public", "test_table"},
                record: %{"id" => "sameid", "name" => "Test#{i}"},
                log_offset: LogOffset.new(i, 2)
              }

              [update, delete, insert]
            else
              [update]
            end
          end
          |> List.flatten()
          # Super small chunk size so that each update is its own chunk
          |> changes_to_log_items()
          |> Storage.append_to_log!(writer)

        Storage.terminate(writer)

        assert Storage.get_log_stream(LogOffset.first(), LogOffset.new(7, 0), storage)
               |> Enum.to_list()
               |> length() == 9

        assert :ok = Storage.compact(storage)

        assert_receive {Storage, msg}, @default_compaction_timeout
        writer = Storage.init_writer!(storage, @shape)
        _writer = Storage.apply_message(writer, msg)

        assert [op1, op2, op3, op4] =
                 Storage.get_log_stream(LogOffset.first(), LogOffset.new(7, 0), storage)
                 |> Enum.to_list()

        assert %{value: %{name: "Test5"}} = Jason.decode!(op1, keys: :atoms)
        assert %{headers: %{operation: "delete"}} = Jason.decode!(op2, keys: :atoms)
        assert %{headers: %{operation: "insert"}} = Jason.decode!(op3, keys: :atoms)

        assert %{headers: %{operation: "update"}, value: %{name: "Test8"}} =
                 Jason.decode!(op4, keys: :atoms)
      end

      @tag chunk_size: 5
      test "compaction works multiple times", %{storage: storage, writer: writer} do
        # shape = @shape
        Storage.mark_snapshot_as_started(storage)
        Storage.make_new_snapshot!([], storage)
        Storage.set_pg_snapshot(%{xmin: 1, xmax: 10}, storage)

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
          |> Storage.append_to_log!(writer)

        Storage.terminate(writer)

        assert Storage.get_log_stream(LogOffset.first(), LogOffset.new(7, 0), storage)
               |> Enum.to_list()
               |> length() == 7

        # Force compaction of all the lines
        assert :ok = Storage.compact(storage, 0)

        assert_receive {Storage, msg}, @default_compaction_timeout
        writer = Storage.init_writer!(storage, @shape)
        writer = Storage.apply_message(writer, msg)

        assert Storage.get_log_stream(LogOffset.first(), LogOffset.new(10, 0), storage)
               |> Enum.map(&Jason.decode!(&1, keys: :atoms)) == [
                 %{
                   value: %{id: "sameid", name: "Test10"},
                   key: ~S|"public"."test_table"/"sameid"|,
                   headers: %{operation: "update", relation: ["public", "test_table"]}
                 }
               ]

        writer =
          for i <- 11..20 do
            %Changes.UpdatedRecord{
              relation: {"public", "test_table"},
              old_record: %{"id" => "sameid", "other_name" => "Test#{i - 1}"},
              record: %{"id" => "sameid", "other_name" => "Test#{i}"},
              log_offset: LogOffset.new(i, 0),
              # Change the other column here to make sure previous are also included in the compaction
              changed_columns: MapSet.new(["other_name"])
            }
          end
          # Super small chunk size so that each update is its own chunk
          |> changes_to_log_items()
          |> Storage.append_to_log!(writer)

        Storage.terminate(writer)

        assert :ok = Storage.compact(storage)

        assert_receive {Storage, msg}, @default_compaction_timeout
        writer = Storage.init_writer!(storage, @shape)
        _writer = Storage.apply_message(writer, msg)

        assert [line] =
                 Storage.get_log_stream(LogOffset.first(), LogOffset.new(17, 0), storage)
                 |> Enum.to_list()

        assert Jason.decode!(line, keys: :atoms) == %{
                 value: %{id: "sameid", name: "Test10", other_name: "Test18"},
                 key: ~S|"public"."test_table"/"sameid"|,
                 headers: %{operation: "update", relation: ["public", "test_table"]}
               }
      end
    end

    describe "#{module_name}.init_writer!/1" do
      @describetag skip_initialise: true
      setup :start_storage

      test "removes the shape if pg_snapshot has not been set", %{storage: opts} do
        writer = Storage.init_writer!(opts, @shape)
        Storage.mark_snapshot_as_started(opts)
        Storage.make_new_snapshot!(@data_stream, opts)
        assert Storage.snapshot_started?(opts)

        Storage.terminate(writer)
        _writer = Storage.init_writer!(opts, @shape)

        refute Storage.snapshot_started?(opts)
      end

      test "removes the shape if the snapshot has not finished", %{storage: opts} do
        writer = Storage.init_writer!(opts, @shape)
        Storage.mark_snapshot_as_started(opts)
        Storage.set_pg_snapshot(%{xmin: 22, xmax: 23, xip_list: []}, opts)

        Storage.terminate(writer)
        _writer = Storage.init_writer!(opts, @shape)

        refute Storage.snapshot_started?(opts)
      end

      test "removes all shapes if the storage version has changed", %{storage: opts} do
        writer = Storage.init_writer!(opts, @shape)
        Storage.mark_snapshot_as_started(opts)
        Storage.make_new_snapshot!(@data_stream, opts)
        Storage.set_pg_snapshot(%{xmin: 22, xmax: 23, xip_list: []}, opts)

        Storage.terminate(writer)
        {mod, arg} = opts
        opts = {mod, %{arg | version: "different version"}}
        _writer = Storage.init_writer!(opts, @shape)

        refute Storage.snapshot_started?(opts)
      end
    end

    describe "#{module_name}.get_all_stored_shape_handles/1" do
      @describetag skip_initialise: true
      setup :start_storage

      test "retrieves no shape handles if no shapes persisted", %{storage_base: storage_base} do
        assert {:ok, MapSet.new()} == Storage.get_all_stored_shape_handles(storage_base)
      end

      test "retrieves stored shape handles", %{storage: opts, storage_base: storage_base} do
        _writer = Storage.init_writer!(opts, @shape)

        assert {:ok, MapSet.new([@shape_handle])} ==
                 Storage.get_all_stored_shape_handles(storage_base)
      end
    end

    describe "#{module_name}.get_stored_shapes/1" do
      @describetag skip_initialise: true
      setup :start_storage

      test "retrieves no shapes if no shapes persisted", %{storage_base: storage_base} do
        assert %{} = Storage.get_stored_shapes(storage_base, [])
      end

      test "retrieves stored shapes", %{storage: opts, storage_base: storage_base} do
        _writer = Storage.init_writer!(opts, @shape)
        invalid_handle = "invalid-handle"

        assert %{@shape_handle => {:ok, parsed}, ^invalid_handle => {:error, _}} =
                 Storage.get_stored_shapes(storage_base, [@shape_handle, invalid_handle])

        assert @shape == parsed
      end

      test "restores shape snapshot started flag", %{storage: opts, storage_base: storage_base} do
        _writer = Storage.init_writer!(opts, @shape)
        :ok = Storage.mark_snapshot_as_started(opts)

        assert %{@shape_handle => {:ok, parsed}} =
                 Storage.get_stored_shapes(storage_base, [@shape_handle])

        assert @shape == parsed
      end
    end

    describe "#{module_name}.metadata_backup_dir/1" do
      @describetag skip_initialise: true
      setup :start_storage

      test "returns metadata backup directory", %{storage_base: storage_base} do
        assert dir = Storage.metadata_backup_dir(storage_base)
        assert is_binary(dir)
        assert Path.type(dir) == :absolute
      end
    end

    describe "#{module_name}.cleanup!/1" do
      setup :start_storage

      test "should remove entire data directory without requiring process to run", %{
        storage: storage,
        storage_base: storage_base,
        writer: writer
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

        Storage.append_to_log!(log_items, writer)
        Storage.terminate(writer)
        assert Storage.get_total_disk_usage(storage_base) > 0

        Storage.cleanup!(storage)
        assert Storage.get_total_disk_usage(storage_base) == 0
      end

      test "should handle entire base directory already missing", %{
        storage: storage,
        storage_base: storage_base
      } do
        base_path =
          case storage do
            {_, %{base_path: base_path}} ->
              base_path

            _ ->
              {_, stack_opts} = storage_base
              stack_opts.base_path
          end

        File.rm_rf!(base_path)
        Storage.cleanup!(storage)
      end
    end

    describe "#{module_name}.cleanup_all!/1" do
      setup :start_storage

      test "should remove entire base directory without requiring process to run", %{
        storage_base: storage_base,
        writer: writer
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

        Storage.append_to_log!(log_items, writer)
        Storage.terminate(writer)
        assert Storage.get_total_disk_usage(storage_base) > 0

        Storage.cleanup_all!(storage_base)
        assert Storage.get_total_disk_usage(storage_base) == 0
        refute File.dir?(Storage.metadata_backup_dir(storage_base))
      end

      test "should handle entire base directory already missing", %{storage_base: storage_base} do
        {_, stack_opts} = storage_base
        File.rm_rf!(stack_opts.base_path)
        Storage.cleanup_all!(storage_base)
      end
    end

    describe "#{module_name}.get_total_disk_usage/1" do
      test "returns 0 if no shapes exist", %{mod: module} = context do
        storage_base = Storage.shared_opts({module, opts(module, context)})

        assert 0 = Storage.get_total_disk_usage(storage_base)
      end

      test "returns the total disk usage for all shapes", context do
        {:ok, %{storage_base: storage_base}} = start_storage(context)

        assert Storage.get_total_disk_usage(storage_base) > 0
      end
    end
  end

  defp start_storage(%{mod: module} = context) do
    storage_base = Storage.shared_opts({module, opts(module, context)})

    start_supervised!(Storage.stack_child_spec(storage_base))

    storage = Storage.for_shape(@shape_handle, storage_base)
    pid = start_supervised!(Storage.child_spec(storage))
    if is_pid(pid), do: Process.link(pid)

    writer =
      if not Map.get(context, :skip_initialise, false) do
        Storage.init_writer!(storage, @shape)
      end

    {:ok, %{storage: storage, storage_base: storage_base, writer: writer}}
  end

  defp start_empty_snapshot(%{storage: storage}) do
    Storage.mark_snapshot_as_started(storage)
    Storage.make_new_snapshot!([], storage)

    :ok
  end

  defp opts(InMemoryStorage, %{stack_id: stack_id}) do
    [
      snapshot_ets_table: String.to_atom("snapshot_ets_table_#{Utils.uuid4()}"),
      log_ets_table: String.to_atom("log_ets_table_#{Utils.uuid4()}"),
      chunk_checkpoint_ets_table: String.to_atom("chunk_checkpoint_ets_table_#{Utils.uuid4()}"),
      stack_id: stack_id
    ]
  end

  defp opts(PureFileStorage, %{tmp_dir: tmp_dir, stack_id: stack_id} = ctx) do
    # keep tmp_dir out of storage dir because it messes with disk usage stats
    [
      storage_dir: random_subdir(tmp_dir),
      tmp_dir: random_subdir(tmp_dir),
      stack_id: stack_id,
      chunk_bytes_threshold: ctx[:chunk_size] || 10 * 1024 * 1024
    ]
  end

  defp random_subdir(base) do
    Path.join(base, :crypto.strong_rand_bytes(16) |> Base.encode32(case: :lower, padding: false))
  end
end
