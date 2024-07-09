defmodule Electric.ShapeCache.StorageImplimentationsTest do
  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes
  alias Electric.ShapeCache.CubDbStorage
  alias Electric.ShapeCache.InMemoryStorage
  alias Electric.Utils
  use ExUnit.Case, async: true
  @shape_id "the-shape-id"
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

    describe "#{module_name}.snapshot_exists?/2" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "returns false when shape does not exist", %{module: storage, opts: opts} do
        assert storage.snapshot_exists?(@shape_id, opts) == false
      end

      test "returns true when shape does exist", %{module: storage, opts: opts} do
        storage.make_new_snapshot!(@shape_id, @query_info, @data_stream, opts)

        assert storage.snapshot_exists?(@shape_id, opts) == true
      end
    end

    describe "#{module_name}.get_snapshot/2" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "returns empty list when shape does not exist", %{module: storage, opts: opts} do
        assert {_, []} = storage.get_snapshot(@shape_id, opts)
      end

      test "returns offset of 0 when shape does not exist", %{module: storage, opts: opts} do
        assert {0, _} = storage.get_snapshot(@shape_id, opts)
      end

      test "returns snapshot when shape does exist", %{module: storage, opts: opts} do
        storage.make_new_snapshot!(@shape_id, @query_info, @data_stream, opts)

        assert {_,
                [
                  %{
                    offset: 0,
                    value: %{"id" => "00000000-0000-0000-0000-000000000001", "title" => "row1"},
                    key: "the-table/00000000-0000-0000-0000-000000000001",
                    headers: %{action: "insert"}
                  },
                  %{
                    offset: 0,
                    value: %{"id" => "00000000-0000-0000-0000-000000000002", "title" => "row2"},
                    key: "the-table/00000000-0000-0000-0000-000000000002",
                    headers: %{action: "insert"}
                  }
                ]} = storage.get_snapshot(@shape_id, opts)
      end

      test "does not leak results from other snapshots", %{module: storage, opts: opts} do
        another_data_stream = [
          [<<3::128>>, "row3"],
          [<<4::128>>, "row4"]
        ]

        storage.make_new_snapshot!(@shape_id, @query_info, @data_stream, opts)
        storage.make_new_snapshot!("another-shape-id", @query_info, another_data_stream, opts)

        assert {_,
                [
                  %{
                    offset: 0,
                    value: %{"id" => "00000000-0000-0000-0000-000000000001", "title" => "row1"},
                    key: "the-table/00000000-0000-0000-0000-000000000001",
                    headers: %{action: "insert"}
                  },
                  %{
                    offset: 0,
                    value: %{"id" => "00000000-0000-0000-0000-000000000002", "title" => "row2"},
                    key: "the-table/00000000-0000-0000-0000-000000000002",
                    headers: %{action: "insert"}
                  }
                ]} = storage.get_snapshot(@shape_id, opts)
      end

      test "returns snapshot offset when shape does exist", %{module: storage, opts: opts} do
        storage.make_new_snapshot!(@shape_id, @query_info, @data_stream, opts)

        {0, _} = storage.get_snapshot(@shape_id, opts)
      end

      test "does not return log entries", %{module: storage, opts: opts} do
        lsn = Lsn.from_integer(1000)
        xid = 1

        changes = [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "123", "name" => "Test"}
          }
        ]

        :ok = storage.append_to_log!(@shape_id, lsn, xid, changes, opts)

        assert {0, []} = storage.get_snapshot(@shape_id, opts)
      end
    end

    describe "#{module_name}.append_to_log!/5" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "adds changes to the log", %{module: storage, opts: opts} do
        lsn = Lsn.from_integer(1000)
        xid = 1

        changes = [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "123", "name" => "Test"}
          }
        ]

        :ok = storage.append_to_log!(@shape_id, lsn, xid, changes, opts)

        stream = storage.get_log_stream(@shape_id, 0, opts)
        [entry] = Enum.to_list(stream)

        assert entry.key == ~S|"public"."test_table"/123|
        assert entry.value == %{"id" => "123", "name" => "Test"}
        assert entry.headers == %{action: "insert", txid: 1}
        assert entry.offset == 1000
      end
    end

    describe "#{module_name}.get_log_stream/3-4" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "returns correct stream of changes", %{module: storage, opts: opts} do
        shape_id = "test_shape"
        lsn1 = Lsn.from_integer(1000)
        lsn2 = Lsn.from_integer(2000)
        xid = 1

        changes1 = [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "123", "name" => "Test1"}
          }
        ]

        changes2 = [
          %Changes.UpdatedRecord{
            relation: {"public", "test_table"},
            old_record: %{"id" => "123", "name" => "Test1"},
            record: %{"id" => "123", "name" => "Test2"}
          },
          %Changes.DeletedRecord{
            relation: {"public", "test_table"},
            old_record: %{"id" => "123", "name" => "Test1"}
          }
        ]

        :ok = storage.append_to_log!(shape_id, lsn1, xid, changes1, opts)
        :ok = storage.append_to_log!(shape_id, lsn2, xid, changes2, opts)

        stream = storage.get_log_stream(shape_id, 0, opts)
        entries = Enum.to_list(stream)

        assert [
                 %{headers: %{action: "insert"}},
                 %{headers: %{action: "update"}},
                 %{headers: %{action: "delete"}}
               ] = entries
      end

      test "returns stream of changes after offset", %{module: storage, opts: opts} do
        lsn1 = Lsn.from_integer(1000)
        lsn2 = Lsn.from_integer(2000)
        xid = 1

        changes1 = [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "123", "name" => "Test1"}
          }
        ]

        changes2 = [
          %Changes.UpdatedRecord{
            relation: {"public", "test_table"},
            old_record: %{"id" => "123", "name" => "Test1"},
            record: %{"id" => "123", "name" => "Test2"}
          },
          %Changes.DeletedRecord{
            relation: {"public", "test_table"},
            old_record: %{"id" => "123", "name" => "Test1"}
          }
        ]

        :ok = storage.append_to_log!(@shape_id, lsn1, xid, changes1, opts)
        :ok = storage.append_to_log!(@shape_id, lsn2, xid, changes2, opts)

        stream = storage.get_log_stream(@shape_id, 1000, opts)
        entries = Enum.to_list(stream)

        assert [
                 %{headers: %{action: "update"}},
                 %{headers: %{action: "delete"}}
               ] = entries
      end

      test "returns only logs for the requested shape_id", %{module: storage, opts: opts} do
        shape_id1 = "shape_a"
        shape_id2 = "shape_b"
        lsn1 = Lsn.from_integer(1000)
        lsn2 = Lsn.from_integer(2000)
        xid = 1

        changes1 = [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "123", "name" => "Test A"}
          }
        ]

        changes2 = [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "456", "name" => "Test B"}
          }
        ]

        :ok = storage.append_to_log!(shape_id1, lsn1, xid, changes1, opts)
        :ok = storage.append_to_log!(shape_id2, lsn2, xid, changes2, opts)

        assert [%{value: %{"name" => "Test A"}}] =
                 storage.get_log_stream(shape_id1, 0, opts) |> Enum.to_list()
      end
    end

    describe "#{module_name}.cleanup!/2" do
      setup do
        {:ok, %{module: unquote(module)}}
      end

      setup :start_storage

      test "causes snapshot_exists?/2 to return false", %{module: storage, opts: opts} do
        storage.make_new_snapshot!(@shape_id, @query_info, @data_stream, opts)

        storage.cleanup!(@shape_id, opts)

        assert storage.snapshot_exists?(@shape_id, opts) == false
      end

      test "causes get_snapshot/2 to return empty list", %{module: storage, opts: opts} do
        storage.make_new_snapshot!(@shape_id, @query_info, @data_stream, opts)

        storage.cleanup!(@shape_id, opts)

        assert {_, []} = storage.get_snapshot(@shape_id, opts)
      end

      test "causes get_snapshot/2 to return an offset of 0", %{module: storage, opts: opts} do
        storage.make_new_snapshot!(@shape_id, @query_info, @data_stream, opts)

        storage.cleanup!(@shape_id, opts)

        assert {0, _} = storage.get_snapshot(@shape_id, opts)
      end

      test "causes get_log_stream/2 to return empty stream", %{module: storage, opts: opts} do
        lsn = Lsn.from_integer(1000)
        xid = 1

        changes = [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "123", "name" => "Test"}
          }
        ]

        :ok = storage.append_to_log!(@shape_id, lsn, xid, changes, opts)

        storage.cleanup!(@shape_id, opts)

        assert storage.get_log_stream(@shape_id, 0, opts) |> Enum.to_list() == []
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
        xid = 1

        changes = [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "123", "name" => "Test"}
          }
        ]

        :ok = storage.append_to_log!(@shape_id, lsn, xid, changes, opts)

        assert storage.has_log_entry?(@shape_id, 1000, opts)
        refute storage.has_log_entry?(@shape_id, 1001, opts)
      end

      test "should return false when there is no log", %{module: storage, opts: opts} do
        refute storage.has_log_entry?("another_shape_id", 1001, opts)
      end
    end
  end

  defp start_storage(%{module: module}) do
    {:ok, opts} = module |> opts() |> module.shared_opts()
    {:ok, _} = module.start_link(opts)

    on_exit(fn ->
      teardown(module, opts)
    end)

    {:ok, %{module: module, opts: opts}}
  end

  defp opts(InMemoryStorage) do
    [
      snapshot_ets_table: String.to_atom("snapshot_ets_table_#{Utils.uuid4()}"),
      log_ets_table: String.to_atom("log_ets_table_#{Utils.uuid4()}")
    ]
  end

  defp opts(CubDbStorage) do
    [
      db: String.to_atom("shape_cubdb_#{Utils.uuid4()}"),
      file_path: "./test/db"
    ]
  end

  defp teardown(InMemoryStorage, _opts), do: :ok

  defp teardown(CubDbStorage, opts) do
    File.rm_rf!(opts.file_path)
  end
end
