defmodule Electric.ShapeCache.InMemoryStorageTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.InMemoryStorage
  alias Electric.Replication.Changes
  alias Electric.Postgres.Lsn

  setup %{test: test_id} do
    snapshot_table = :"snapshot_ets_table_#{test_id}"
    log_table = :"log_ets_table_#{test_id}"

    {:ok, opts} =
      InMemoryStorage.shared_opts(
        snapshot_ets_table: snapshot_table,
        log_ets_table: log_table
      )

    {:ok, pid} = InMemoryStorage.start_link(opts)

    %{opts: opts, pid: pid}
  end

  describe "shared_opts/1" do
    test "returns expected options", %{opts: opts} do
      assert Map.has_key?(opts, :snapshot_ets_table)
      assert Map.has_key?(opts, :log_ets_table)
      assert is_atom(opts.snapshot_ets_table)
      assert is_atom(opts.log_ets_table)
    end
  end

  describe "snapshot_exists?/2" do
    test "returns false for non-existent snapshot", %{opts: opts} do
      refute InMemoryStorage.snapshot_exists?("test_shape", opts)
    end
  end

  describe "make_new_snapshot!/4" do
    test " creates a snapshot", %{opts: opts} do
      shape_id = "test_shape"

      query_info = %Postgrex.Query{
        name: "\"public\".\"items\"",
        columns: ["id", "name"],
        result_types: [:uuid, :string]
      }

      data_stream = [["123e4567-e89b-12d3-a456-426614174000", "Test Name"]]

      :ok = InMemoryStorage.make_new_snapshot!(shape_id, query_info, data_stream, opts)

      assert InMemoryStorage.snapshot_exists?(shape_id, opts)
    end
  end

  describe "get_snapshot/2" do
    test "returns the correct snapshot", %{opts: opts} do
      shape_id = "test_shape"

      query_info = %Postgrex.Query{
        name: "\"public\".\"items\"",
        columns: ["id", "name"],
        result_types: [:uuid, :string]
      }

      data_stream = [["123e4567-e89b-12d3-a456-426614174000", "Test Name"]]

      :ok = InMemoryStorage.make_new_snapshot!(shape_id, query_info, data_stream, opts)

      assert {0, [element]} = InMemoryStorage.get_snapshot(shape_id, opts)

      assert element.key == "\"public\".\"items\"/123e4567-e89b-12d3-a456-426614174000"

      assert element.value == %{
               "id" => "123e4567-e89b-12d3-a456-426614174000",
               "name" => "Test Name"
             }

      assert element.headers == %{action: "insert"}
      assert element.offset == 0
    end

    test "does not leak results from other snapshots", %{opts: opts} do
      shape_id1 = "shape_a"
      shape_id2 = "shape_b"

      query_info = %Postgrex.Query{
        name: "test_query",
        columns: ["id", "name"],
        result_types: [:string, :string]
      }

      data_stream1 = [["123", "Test A"]]
      data_stream2 = [["456", "Test B"]]

      :ok = InMemoryStorage.make_new_snapshot!(shape_id1, query_info, data_stream1, opts)
      :ok = InMemoryStorage.make_new_snapshot!(shape_id2, query_info, data_stream2, opts)

      assert {0, [%{value: %{"name" => "Test A"}}]} =
               InMemoryStorage.get_snapshot(shape_id1, opts)
    end
  end

  describe "append_to_log!/5" do
    test "adds changes to the log", %{opts: opts} do
      shape_id = "test_shape"
      lsn = Lsn.from_integer(1000)
      xid = 1

      changes = [
        %Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "123", "name" => "Test"}
        }
      ]

      :ok = InMemoryStorage.append_to_log!(shape_id, lsn, xid, changes, opts)

      stream = InMemoryStorage.get_log_stream(shape_id, 0, opts)
      [entry] = Enum.to_list(stream)

      assert entry.key == ~S|"public"."test_table"/123|
      assert entry.value == %{"id" => "123", "name" => "Test"}
      assert entry.headers == %{action: "insert", txid: 1}
      assert entry.offset == 1000
    end
  end

  describe "get_log_stream/3-4" do
    test "returns correct stream of changes", %{opts: opts} do
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

      :ok = InMemoryStorage.append_to_log!(shape_id, lsn1, xid, changes1, opts)
      :ok = InMemoryStorage.append_to_log!(shape_id, lsn2, xid, changes2, opts)

      stream = InMemoryStorage.get_log_stream(shape_id, 0, opts)
      entries = Enum.to_list(stream)

      assert [
               %{headers: %{action: "insert"}},
               %{headers: %{action: "update"}},
               %{headers: %{action: "delete"}}
             ] = entries
    end

    test "returns only logs for the requested shape_id", %{opts: opts} do
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

      :ok = InMemoryStorage.append_to_log!(shape_id1, lsn1, xid, changes1, opts)
      :ok = InMemoryStorage.append_to_log!(shape_id2, lsn2, xid, changes2, opts)

      assert [%{value: %{"name" => "Test A"}}] =
               InMemoryStorage.get_log_stream(shape_id1, 0, opts) |> Enum.to_list()
    end
  end

  describe "has_log_entry?/3" do
    test "returns a boolean indicating whether there is a log entry with such an offset", %{
      opts: opts
    } do
      shape_id = "test_shape"
      lsn = Lsn.from_integer(1000)
      xid = 1

      changes = [
        %Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "123", "name" => "Test"}
        }
      ]

      :ok = InMemoryStorage.append_to_log!(shape_id, lsn, xid, changes, opts)

      assert InMemoryStorage.has_log_entry?(shape_id, 1000, opts)
      refute InMemoryStorage.has_log_entry?(shape_id, 1001, opts)
    end

    test "should return false when there is no log", %{opts: opts} do
      refute InMemoryStorage.has_log_entry?("shape_id", 1001, opts)
    end
  end

  describe "cleanup!/2" do
    test "removes all data for a shape", %{opts: opts} do
      shape_id = "test_shape"

      query_info = %Postgrex.Query{
        name: "\"public\".\"items\"",
        columns: ["id", "name"],
        result_types: [:uuid, :string]
      }

      data_stream = [["123e4567-e89b-12d3-a456-426614174000", "Test Name"]]

      :ok = InMemoryStorage.make_new_snapshot!(shape_id, query_info, data_stream, opts)

      :ok =
        InMemoryStorage.append_to_log!(
          shape_id,
          Lsn.from_integer(1000),
          1,
          [
            %Changes.NewRecord{
              relation: {"public", "test_table"},
              record: %{"id" => "123", "name" => "Test"}
            }
          ],
          opts
        )

      assert InMemoryStorage.snapshot_exists?(shape_id, opts)
      assert Enum.count(InMemoryStorage.get_log_stream(shape_id, -1, opts)) == 1

      :ok = InMemoryStorage.cleanup!(shape_id, opts)

      refute InMemoryStorage.snapshot_exists?(shape_id, opts)
      assert Enum.count(InMemoryStorage.get_log_stream(shape_id, -1, opts)) == 0
    end
  end

  describe "log_to_snapshot_entry/2" do
    test "correctly encodes UUID" do
      shape_id = "test_shape"

      query_info = %Postgrex.Query{
        name: "test_query",
        columns: ["id", "name"],
        result_types: [Postgrex.Extensions.UUID, :string]
      }

      uuid_binary = <<1, 35, 69, 103, 137, 171, 76, 222, 143, 227, 251, 149, 223, 249, 31, 215>>
      row = [uuid_binary, "Test Name"]

      {{^shape_id, key}, serialized_row} =
        InMemoryStorage.row_to_snapshot_entry(row, shape_id, query_info)

      assert key == "test_query/01234567-89ab-4cde-8fe3-fb95dff91fd7"

      assert serialized_row == %{
               "id" => "01234567-89ab-4cde-8fe3-fb95dff91fd7",
               "name" => "Test Name"
             }
    end
  end
end
