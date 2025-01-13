defmodule Electric.ShapeCache.FileStorage.OnDiskTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.FileStorage.OnDisk
  alias Electric.Replication.LogOffset
  require OnDisk

  @moduletag :tmp_dir

  describe "write_log_file/2" do
    test "writes a log file to disk", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream = [
        {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
        {%LogOffset{tx_offset: 2, op_offset: 2}, "key2", :insert, "value2"},
        {%LogOffset{tx_offset: 3, op_offset: 3}, "key3", :insert, "value3"}
      ]

      refute File.exists?(log_file_path)
      assert :ok = OnDisk.write_log_file(log_stream, log_file_path)
      assert File.exists?(log_file_path)

      assert File.read!(log_file_path) ==
               <<1::64, 1::64, 4::32, "key1", "i", 6::64, "value1">> <>
                 <<2::64, 2::64, 4::32, "key2", "i", 6::64, "value2">> <>
                 <<3::64, 3::64, 4::32, "key3", "i", 6::64, "value3">>
    end

    test "writes a chunk index alongside the log file", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream = [
        {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
        {%LogOffset{tx_offset: 2, op_offset: 2}, "key2", :insert, "value2"},
        {%LogOffset{tx_offset: 3, op_offset: 3}, "key3", :insert, "value3"}
      ]

      refute File.exists?(log_file_path)
      assert :ok = OnDisk.write_log_file(log_stream, log_file_path)
      assert File.exists?(log_file_path <> ".chunk_index")

      assert File.read!(log_file_path <> ".chunk_index") ==
               <<1::64, 1::64, 0::64, 3::64, 3::64, 117::64>>
    end

    test "writes a chunk index alongside the log file respecting chunk size", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream = [
        {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
        {%LogOffset{tx_offset: 1, op_offset: 2}, "key2", :insert, "value2"},
        {%LogOffset{tx_offset: 2, op_offset: 1}, "key3", :insert, "value3"},
        {%LogOffset{tx_offset: 2, op_offset: 2}, "key4", :insert, "value4"},
        {%LogOffset{tx_offset: 3, op_offset: 1}, "key5", :insert, "value5"},
        {%LogOffset{tx_offset: 3, op_offset: 2}, "key6", :insert, "value6"}
      ]

      refute File.exists?(log_file_path)
      # 10-byte chunks
      assert :ok = OnDisk.write_log_file(log_stream, log_file_path, 10)
      assert File.exists?(log_file_path <> ".chunk_index")

      assert File.read!(log_file_path <> ".chunk_index") ==
               <<1::64, 1::64, 0::64, 1::64, 2::64, 78::64>> <>
                 <<2::64, 1::64, 78::64, 2::64, 2::64, 156::64>> <>
                 <<3::64, 1::64, 156::64, 3::64, 2::64, 234::64>>
    end
  end

  describe "read_json_chunk/2" do
    test "reads a json chunk from disk according to the log offset", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream = [
        # Will be in chunk 1
        {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
        {%LogOffset{tx_offset: 1, op_offset: 2}, "key2", :insert, "value2"},
        # Will be in chunk 2
        {%LogOffset{tx_offset: 2, op_offset: 1}, "key3", :insert, "value3"},
        {%LogOffset{tx_offset: 2, op_offset: 2}, "key4", :insert, "value4"},
        # Will be in chunk 3
        {%LogOffset{tx_offset: 3, op_offset: 1}, "key5", :insert, "value5"},
        {%LogOffset{tx_offset: 3, op_offset: 2}, "key6", :insert, "value6"}
      ]

      refute File.exists?(log_file_path)
      # 10-byte chunks
      assert :ok = OnDisk.write_log_file(log_stream, log_file_path, 10)

      assert OnDisk.read_json_chunk(log_file_path, %LogOffset{tx_offset: 0, op_offset: 0}) ==
               ["value1", "value2"]

      # Skips the first element of the chunk
      assert OnDisk.read_json_chunk(log_file_path, %LogOffset{tx_offset: 1, op_offset: 1}) ==
               ["value2"]

      # Reads "next" chunk
      assert OnDisk.read_json_chunk(log_file_path, %LogOffset{tx_offset: 1, op_offset: 2}) ==
               ["value3", "value4"]

      # Reads "next" chunk
      assert OnDisk.read_json_chunk(log_file_path, %LogOffset{tx_offset: 2, op_offset: 2}) ==
               ["value5", "value6"]

      # Returns an empty list when out of bounds
      assert OnDisk.read_json_chunk(log_file_path, %LogOffset{tx_offset: 3, op_offset: 2}) == []
    end

    test "works when there are no chunks", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream = [
        {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
        {%LogOffset{tx_offset: 2, op_offset: 2}, "key2", :insert, "value2"},
        {%LogOffset{tx_offset: 3, op_offset: 3}, "key3", :insert, "value3"}
      ]

      assert :ok = OnDisk.write_log_file(log_stream, log_file_path)

      assert OnDisk.read_json_chunk(log_file_path, %LogOffset{tx_offset: 0, op_offset: 0}) ==
               ["value1", "value2", "value3"]
    end

    test "works when there is exactly one offset per chunk", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream = [
        {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
        {%LogOffset{tx_offset: 2, op_offset: 2}, "key2", :insert, "value2"},
        {%LogOffset{tx_offset: 3, op_offset: 3}, "key3", :insert, "value3"}
      ]

      # 5-byte chunks - one line per chunk
      assert :ok = OnDisk.write_log_file(log_stream, log_file_path, 5)

      assert OnDisk.read_json_chunk(log_file_path, %LogOffset{tx_offset: 0, op_offset: 0}) ==
               ["value1"]

      assert OnDisk.read_json_chunk(log_file_path, %LogOffset{tx_offset: 1, op_offset: 1}) ==
               ["value2"]
    end

    test "works when there are a lot of chunks", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream =
        for x <- 1..10_000 do
          {%LogOffset{tx_offset: x, op_offset: 0}, "key#{x}", :insert, "value#{x}"}
        end

      # 5-byte chunks - one line per chunk
      assert :ok = OnDisk.write_log_file(log_stream, log_file_path, 5)

      assert OnDisk.read_json_chunk(log_file_path, %LogOffset{tx_offset: 0, op_offset: 0}) ==
               ["value1"]

      assert OnDisk.read_json_chunk(log_file_path, %LogOffset{tx_offset: 5_000, op_offset: 0}) ==
               ["value5001"]

      assert OnDisk.read_json_chunk(log_file_path, %LogOffset{tx_offset: 10_000, op_offset: 0}) ==
               []
    end
  end

  describe "stream_log_file_info/2" do
    test "streams a log file", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream = [
        {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
        {%LogOffset{tx_offset: 2, op_offset: 2}, "key2", :insert, "value2"},
        {%LogOffset{tx_offset: 3, op_offset: 3}, "key1", :update, "value3"}
      ]

      assert :ok = OnDisk.write_log_file(log_stream, log_file_path)

      assert Enum.to_list(OnDisk.stream_log_file_info(log_file_path)) == [
               OnDisk.log_file_line_info(
                 log_offset: {1, 1},
                 key_size: 4,
                 key: "key1",
                 op_type: "i",
                 json_size: 6,
                 start_position: 0,
                 json_start_position: 8 + 8 + 4 + 4 + 1 + 8
               ),
               OnDisk.log_file_line_info(
                 log_offset: {2, 2},
                 key_size: 4,
                 key: "key2",
                 op_type: "i",
                 json_size: 6,
                 start_position: 39,
                 json_start_position: 72
               ),
               OnDisk.log_file_line_info(
                 log_offset: {3, 3},
                 key_size: 4,
                 key: "key1",
                 op_type: "u",
                 json_size: 6,
                 start_position: 78,
                 json_start_position: 111
               )
             ]
    end
  end

  @index_op1 <<4::32, "key1", 1::64, 1::64, "i", 33::64, 6::64>>
  @index_op2 <<4::32, "key1", 3::64, 3::64, "u", 111::64, 6::64>>
  @index_op3 <<4::32, "key2", 2::64, 2::64, "i", 72::64, 6::64>>

  describe "create_sorted_key_index/1" do
    test "creates a sorted key index of all the operations sorted by key and offset", %{
      tmp_dir: tmp_dir
    } do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream = [
        {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
        {%LogOffset{tx_offset: 2, op_offset: 2}, "key2", :insert, "value2"},
        {%LogOffset{tx_offset: 3, op_offset: 3}, "key1", :update, "value3"}
      ]

      refute File.exists?(log_file_path)
      assert :ok = OnDisk.write_log_file(log_stream, log_file_path)

      key_index_path = OnDisk.create_sorted_key_index(log_file_path)
      assert File.exists?(key_index_path)

      assert File.read!(key_index_path) ==
               <<@index_op1::binary, @index_op2::binary, @index_op3::binary>>
    end
  end

  describe "sort_key_index/1" do
    test "sorts the key index", %{tmp_dir: tmp_dir} do
      key_index_path = Path.join(tmp_dir, "key_index")

      data =
        <<@index_op3::binary, @index_op2::binary, @index_op1::binary>>

      File.write!(key_index_path, data)
      OnDisk.sort_key_index(key_index_path)

      assert File.read!(key_index_path) ==
               <<@index_op1::binary, @index_op2::binary, @index_op3::binary>>
    end
  end

  describe "create_action_file/1" do
    test "creates an action file that's offset sorted", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream = [
        {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, "value1"},
        {%LogOffset{tx_offset: 2, op_offset: 2}, "key2", :insert, "value2"},
        {%LogOffset{tx_offset: 3, op_offset: 3}, "key1", :update, "value3"},
        {%LogOffset{tx_offset: 4, op_offset: 4}, "key1", :update, "new value"}
      ]

      assert :ok = OnDisk.write_log_file(log_stream, log_file_path)
      sorted_key_index_path = OnDisk.create_sorted_key_index(log_file_path)
      action_file = OnDisk.create_action_file(log_file_path, sorted_key_index_path)

      assert File.read!(action_file) ==
               <<1::64, 1::64, "k">> <>
                 <<2::64, 2::64, "k">> <>
                 <<3::64, 3::64, "s">> <>
                 <<4::64, 4::64, "c", 2::32, 111::64, 6::64, 150::64, 9::64>>
    end
  end

  describe "apply_actions/2" do
    test "applies the actions to the log file", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream = [
        {%LogOffset{tx_offset: 1, op_offset: 1}, "key1", :insert, ~S|"value1"|},
        {%LogOffset{tx_offset: 2, op_offset: 2}, "key1", :update, ~S|"value3"|},
        {%LogOffset{tx_offset: 3, op_offset: 3}, "key2", :insert, ~S|"value2"|},
        {%LogOffset{tx_offset: 4, op_offset: 4}, "key1", :update, ~S|"new value"|}
      ]

      assert :ok = OnDisk.write_log_file(log_stream, log_file_path)
      sorted_key_index_path = OnDisk.create_sorted_key_index(log_file_path)
      action_file = OnDisk.create_action_file(log_file_path, sorted_key_index_path)
      assert :ok = OnDisk.apply_actions(log_file_path, action_file, fn a, b -> a <> "," <> b end)

      assert File.read!(log_file_path) ==
               <<1::64, 1::64, 4::32, "key1", "i", 8::64, ~S|"value1"|>> <>
                 <<3::64, 3::64, 4::32, "key2", "i", 8::64, ~S|"value2"|>> <>
                 <<4::64, 4::64, 4::32, "key1", "u", 18::64, ~S|"value3,new value"|>>
    end

    test "doesn't merge updates across a delete/insert boundary", %{tmp_dir: tmp_dir} do
      log_file_path = Path.join(tmp_dir, "log_file")

      log_stream = [
        {LogOffset.new(1, 1), "key1", :insert, ~S|"value1"|},
        {LogOffset.new(2, 2), "key1", :update, ~S|"value3"|},
        {LogOffset.new(3, 3), "key2", :insert, ~S|"value2"|},
        {LogOffset.new(4, 4), "key1", :update, ~S|"new value"|},
        {LogOffset.new(5, 5), "key1", :delete, ~S|"delete"|},
        {LogOffset.new(6, 6), "key1", :insert, ~S|"value4"|},
        {LogOffset.new(7, 7), "key1", :update, ~S|"value5"|},
        {LogOffset.new(8, 8), "key1", :update, ~S|"value6"|}
      ]

      assert :ok = OnDisk.write_log_file(log_stream, log_file_path)
      sorted_key_index_path = OnDisk.create_sorted_key_index(log_file_path)
      action_file = OnDisk.create_action_file(log_file_path, sorted_key_index_path)
      assert :ok = OnDisk.apply_actions(log_file_path, action_file, fn a, b -> a <> "," <> b end)

      assert File.read!(log_file_path) ==
               <<1::64, 1::64, 4::32, "key1", "i", 8::64, ~S|"value1"|>> <>
                 <<3::64, 3::64, 4::32, "key2", "i", 8::64, ~S|"value2"|>> <>
                 <<4::64, 4::64, 4::32, "key1", "u", 18::64, ~S|"value3,new value"|>> <>
                 <<5::64, 5::64, 4::32, "key1", "d", 8::64, ~S|"delete"|>> <>
                 <<6::64, 6::64, 4::32, "key1", "i", 8::64, ~S|"value4"|>> <>
                 <<8::64, 8::64, 4::32, "key1", "u", 15::64, ~S|"value5,value6"|>>
    end
  end
end
