defmodule Electric.QueueSystem.QueueTest do
  use ExUnit.Case, async: true

  alias Electric.Nifs.DiskQueue
  alias Electric.QueueSystem.Queue

  setup do
    dir = Path.join(System.tmp_dir!(), "queue_test_#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)
    %{dir: dir}
  end

  describe "new/1" do
    test "creates only the streaming/ subdirectory; output/ is opened lazily", %{dir: dir} do
      _queue = Queue.new(dir)

      assert File.dir?(Path.join(dir, "streaming"))
      refute File.exists?(Path.join(dir, "output"))
      refute File.exists?(Path.join(dir, "snapshot"))
    end

    test "starts in :streaming mode with no output handle", %{dir: dir} do
      assert %Queue{mode: :streaming, output: nil} = Queue.new(dir)
    end
  end

  describe "push/2 + state machine" do
    test "in :streaming mode, writes to streaming queue and tracks last id", %{dir: dir} do
      q = Queue.new(dir) |> Queue.push("a") |> Queue.push("b")
      assert q.last_streaming_id != nil
    end

    test "in :buffering mode, writes accumulate in in-memory buffer", %{dir: dir} do
      q = Queue.new(dir) |> Queue.push("a")
      {q, _last_id} = Queue.start_buffering(q)

      q = q |> Queue.push("b") |> Queue.push("c")

      assert q.mode == :buffering
      assert q.buffer == ["c", "b"]
    end

    test "go_live opens output/, flushes buffer into it, drops streaming handle", %{dir: dir} do
      q = Queue.new(dir) |> Queue.push("a")
      {q, _last_id} = Queue.start_buffering(q)
      q = q |> Queue.push("b") |> Queue.push("c")
      q = Queue.go_live(q)

      assert q.mode == :live
      assert q.buffer == []
      assert q.streaming == nil
      assert is_reference(q.output)
      assert File.dir?(Path.join(dir, "output"))

      {:ok, entries} = DiskQueue.peek_n(q.output, 10)
      assert Enum.map(entries, fn {_id, v} -> v end) == ["b", "c"]
    end

    test "go_live preserves records the snapshotter wrote into output/ before transition", %{dir: dir} do
      # Simulates the real flow: snapshotter opens output/ directly and
      # pushes snapshot rows, then drops its handle. The consumer's Queue
      # then transitions to :live, and the fresh output handle opened there
      # must see the snapshotter's rows and append the buffered replication
      # events after them.
      output_dir = Path.join(dir, "output")
      File.mkdir_p!(output_dir)
      {:ok, snap_handle} = DiskQueue.open(output_dir)
      {:ok, _} = DiskQueue.push(snap_handle, "snap1")
      {:ok, _} = DiskQueue.push(snap_handle, "snap2")

      q = Queue.new(dir) |> Queue.push("stream1")
      {q, _last_id} = Queue.start_buffering(q)
      q = Queue.push(q, "buf1")
      q = Queue.go_live(q)

      {:ok, entries} = DiskQueue.peek_n(q.output, 10)

      assert Enum.map(entries, fn {_id, v} -> v end) == ["snap1", "snap2", "buf1"]
    end
  end

  describe "cleanup_temp/1" do
    test "removes streaming/ but leaves output/ intact (after go_live has opened it)", %{dir: dir} do
      q = Queue.new(dir) |> Queue.push("a")
      {q, _} = Queue.start_buffering(q)
      q = Queue.go_live(q)

      _q = Queue.cleanup_temp(q)

      refute File.exists?(Path.join(dir, "streaming"))
      assert File.dir?(Path.join(dir, "output"))
    end
  end

  describe "copy_streaming_to_output/3" do
    test "copies src records up to and including last_id into dst", %{dir: dir} do
      {:ok, src} = DiskQueue.open(Path.join(dir, "src"))
      {:ok, dst} = DiskQueue.open(Path.join(dir, "dst"))

      {:ok, _} = DiskQueue.push(src, "a")
      {:ok, last_id} = DiskQueue.push(src, "b")
      {:ok, _} = DiskQueue.push(src, "c")

      assert {:ok, 2} = Queue.copy_streaming_to_output(src, dst, last_id)

      {:ok, entries} = DiskQueue.peek_n(dst, 10)
      assert Enum.map(entries, fn {_id, v} -> v end) == ["a", "b"]
    end

    test "nil last_id copies nothing", %{dir: dir} do
      {:ok, src} = DiskQueue.open(Path.join(dir, "src"))
      {:ok, dst} = DiskQueue.open(Path.join(dir, "dst"))
      {:ok, _} = DiskQueue.push(src, "a")

      assert {:ok, 0} = Queue.copy_streaming_to_output(src, dst, nil)

      {:ok, entries} = DiskQueue.peek_n(dst, 10)
      assert entries == []
    end
  end
end
