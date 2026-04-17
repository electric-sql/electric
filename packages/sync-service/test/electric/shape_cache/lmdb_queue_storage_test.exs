defmodule Electric.ShapeCache.LmdbQueueStorageTest do
  use ExUnit.Case, async: true

  alias Electric.Nifs.DiskQueue
  alias Electric.ShapeCache.LmdbQueueStorage

  setup do
    dir = Path.join(System.tmp_dir!(), "lmdb_qs_test_#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)

    opts = %LmdbQueueStorage{
      base_path: dir,
      stack_id: "test_stack",
      shape_handle: "test_shape",
      chunk_bytes_threshold: 64 * 1024
    }

    %{dir: dir, opts: opts}
  end

  describe "make_new_snapshot!/2" do
    test "pushes rows into output/, never creates snapshot/", %{dir: dir, opts: opts} do
      stream = ["row1", "row2", "row3"]
      :ok = LmdbQueueStorage.make_new_snapshot!(stream, opts)

      assert File.dir?(Path.join([dir, "queue", "output"]))
      refute File.exists?(Path.join([dir, "queue", "snapshot"]))

      {:ok, q} = DiskQueue.open(Path.join([dir, "queue", "output"]))
      {:ok, entries} = DiskQueue.peek_n(q, 10)
      assert Enum.map(entries, fn {_id, v} -> v end) == ["row1", "row2", "row3"]
    end

    test "skips :chunk_boundary markers", %{opts: opts, dir: dir} do
      stream = ["a", :chunk_boundary, "b", :chunk_boundary, "c"]
      :ok = LmdbQueueStorage.make_new_snapshot!(stream, opts)

      {:ok, q} = DiskQueue.open(Path.join([dir, "queue", "output"]))
      {:ok, entries} = DiskQueue.peek_n(q, 10)
      assert Enum.map(entries, fn {_id, v} -> v end) == ["a", "b", "c"]
    end
  end

  describe "copy_buffer_to_output!/2" do
    test "copies streaming rows up to last_id into output", %{dir: dir, opts: opts} do
      queue_dir = Path.join(dir, "queue")
      File.mkdir_p!(queue_dir)

      {:ok, streaming} = DiskQueue.open(Path.join(queue_dir, "streaming"))
      {:ok, _output} = DiskQueue.open(Path.join(queue_dir, "output"))

      {:ok, _} = DiskQueue.push(streaming, "s1")
      {:ok, last_id} = DiskQueue.push(streaming, "s2")
      {:ok, _} = DiskQueue.push(streaming, "s3")

      assert 2 = LmdbQueueStorage.copy_buffer_to_output!(opts, last_id)

      {:ok, out} = DiskQueue.open(Path.join(queue_dir, "output"))
      {:ok, entries} = DiskQueue.peek_n(out, 10)
      assert Enum.map(entries, fn {_id, v} -> v end) == ["s1", "s2"]
    end

    test "nil last_id is a no-op even when streaming has data", %{dir: dir, opts: opts} do
      queue_dir = Path.join(dir, "queue")
      File.mkdir_p!(queue_dir)
      {:ok, streaming} = DiskQueue.open(Path.join(queue_dir, "streaming"))
      {:ok, _output} = DiskQueue.open(Path.join(queue_dir, "output"))

      {:ok, _} = DiskQueue.push(streaming, "s1")

      assert 0 = LmdbQueueStorage.copy_buffer_to_output!(opts, nil)

      {:ok, out} = DiskQueue.open(Path.join(queue_dir, "output"))
      {:ok, entries} = DiskQueue.peek_n(out, 10)
      assert entries == []
    end
  end
end
