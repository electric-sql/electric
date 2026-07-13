defmodule Electric.ShapeCache.PureFileStorage.LogFileTest do
  use ExUnit.Case, async: false

  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.PureFileStorage
  alias Electric.ShapeCache.PureFileStorage.LogFile

  @moduletag :tmp_dir

  test "bounded streaming stops reading the file after the inclusive max", %{tmp_dir: tmp_dir} do
    path = Path.join(tmp_dir, "bounded-log.bin")
    max_offset = LogOffset.new(2, 0)

    entries = [
      {LogOffset.new(1, 0), "first", :insert, Jason.encode!(%{id: "first"})},
      {max_offset, "max", :insert, Jason.encode!(%{id: "max"})}
    ]

    tail =
      for tx <- 3..8 do
        json = Jason.encode!(%{id: "tail-#{tx}", padding: String.duplicate("x", 4_096)})
        {LogOffset.new(tx, 0), "tail-#{tx}", :insert, json}
      end

    LogFile.write_log_file(entries ++ tail, path, 1_000_000)

    test_pid = self()

    read_fun = fn file, size ->
      send(test_pid, :file_read)
      :file.read(file, size)
    end

    opts = %PureFileStorage{stack_id: "test", shape_handle: "test"}

    assert LogFile.stream_jsons_until_offset(
             opts,
             path,
             0,
             LogOffset.first(),
             max_offset,
             fn _offset, json -> json end,
             read_fun
           )
           |> Enum.map(&Jason.decode!/1) == [%{"id" => "first"}, %{"id" => "max"}]

    assert_receive :file_read
    refute_receive :file_read
  end
end
