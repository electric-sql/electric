defmodule Electric.ShapeCache.FileStorageTest do
  use ExUnit.Case, async: true
  import Support.ComponentSetup
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.FileStorage

  @moduletag :tmp_dir

  @shape_handle "the-shape-handle"

  setup :with_stack_id_from_test

  setup %{tmp_dir: tmp_dir, stack_id: stack_id} do
    opts =
      FileStorage.shared_opts(
        db: String.to_atom("shape_mixed_disk_#{stack_id}"),
        storage_dir: tmp_dir,
        stack_id: stack_id
      )

    shape_opts = FileStorage.for_shape(@shape_handle, opts)
    {:ok, pid} = FileStorage.start_link(shape_opts)
    {:ok, %{opts: shape_opts, shared_opts: opts, pid: pid, storage: {FileStorage, shape_opts}}}
  end

  test "returns complete snapshot when writes are partially complete", %{
    opts: opts
  } do
    row_count = 10

    data_stream =
      for i <- 1..row_count, into: "" do
        Jason.encode!(%{
          offset: "0_0",
          value: %{id: "00000000-0000-0000-0000-00000000000#{i}", title: "row#{i}"},
          key: ~S|"public"."the-table"/"00000000-0000-0000-0000-00000000000#{i}"|,
          headers: %{operation: "insert"}
        }) <> "\n"
      end

    FileStorage.mark_snapshot_as_started(opts)
    stream = FileStorage.get_log_stream(LogOffset.before_all(), LogOffset.first(), opts)

    read_task =
      Task.async(fn ->
        log = Enum.to_list(stream)

        assert Enum.count(log) == row_count

        for {item, i} <- Enum.with_index(log, 1) do
          assert Jason.decode!(item, keys: :atoms).value.title == "row#{i}"
        end
      end)

    File.open!(FileStorage.snapshot_chunk_path(opts, 0), [:write, :raw], fn file ->
      data_stream
      |> chunk_string_every(10)
      |> Stream.each(fn chunk ->
        IO.binwrite(file, chunk)
        # Sync-write to file to ensure the concurrent reader sees this "incomplete" line
        :file.sync(file)
        Process.sleep(1)
      end)
      |> Stream.run()

      # Write EOF marker
      IO.binwrite(file, <<4::utf8>>)
      :file.sync(file)
    end)

    Task.await(read_task)
  end

  defp chunk_string_every(string, every) do
    string
    |> Stream.unfold(&String.split_at(&1, every))
    |> Stream.take_while(&(&1 != ""))
  end
end
