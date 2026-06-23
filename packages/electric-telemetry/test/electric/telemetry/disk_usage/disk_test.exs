defmodule ElectricTelemetry.DiskUsage.DiskTest do
  use ExUnit.Case, async: true

  alias ElectricTelemetry.DiskUsage.Disk

  @moduletag :tmp_dir

  defp write_file(path, size) do
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, :binary.copy("0", size), [:raw, :binary])
    size
  end

  describe "recursive_usage/2" do
    test "sums all regular files recursively", %{tmp_dir: dir} do
      write_file(Path.join(dir, "a/b/c/1.data"), 100)
      write_file(Path.join(dir, "a/b/c/2.data"), 50)
      write_file(Path.join(dir, "a/x/y/z/1.data"), 25)

      assert Disk.recursive_usage(dir, []) == 175
    end

    test "excludes listed files", %{tmp_dir: dir} do
      write_file(Path.join(dir, "keep.data"), 100)
      excluded = Path.join(dir, "skip.data")
      write_file(excluded, 999)

      assert Disk.recursive_usage(dir, [excluded]) == 100
    end
  end

  describe "recursive_usage_grouped/3" do
    test "total is byte-identical to recursive_usage/2 from a single walk", %{tmp_dir: dir} do
      write_file(Path.join(dir, "s1/p/q/shape-a/1.data"), 100)
      write_file(Path.join(dir, "s1/p/q/shape-a/2.data"), 200)
      write_file(Path.join(dir, "s1/p/q/shape-b/1.data"), 50)
      write_file(Path.join(dir, "loose.data"), 7)

      {total, _buckets} = Disk.recursive_usage_grouped(dir, [], 4)
      assert total == Disk.recursive_usage(dir, [])
      assert total == 357
    end

    test "buckets by directory name at the configured depth", %{tmp_dir: dir} do
      # Layout: <dir>/<stack>/<p1>/<p2>/<shape_handle>/...  => shape at depth 4
      write_file(Path.join(dir, "stack/aa/bb/shape-a/log/1.data"), 100)
      write_file(Path.join(dir, "stack/aa/bb/shape-a/log/2.data"), 200)
      write_file(Path.join(dir, "stack/aa/bb/shape-b/snap/1.data"), 50)
      write_file(Path.join(dir, "stack/cc/dd/shape-c/1.data"), 10)

      {total, buckets} = Disk.recursive_usage_grouped(dir, [], 4)

      assert total == 360
      assert buckets == %{"shape-a" => 300, "shape-b" => 50, "shape-c" => 10}
    end

    test "depth 0 buckets the whole tree under the root's basename", %{tmp_dir: dir} do
      write_file(Path.join(dir, "x/1.data"), 5)
      write_file(Path.join(dir, "y/1.data"), 5)

      {total, buckets} = Disk.recursive_usage_grouped(dir, [], 0)
      assert total == 10
      assert buckets == %{Path.basename(dir) => 10}
    end

    test "excluded files contribute to neither total nor buckets", %{tmp_dir: dir} do
      write_file(Path.join(dir, "stack/aa/bb/shape-a/1.data"), 100)
      excluded = Path.join(dir, "stack/aa/bb/shape-a/skip.data")
      write_file(excluded, 999)

      {total, buckets} = Disk.recursive_usage_grouped(dir, [excluded], 4)
      assert total == 100
      assert buckets == %{"shape-a" => 100}
    end

    test "unreadable / missing directory is skipped and contributes 0", %{tmp_dir: dir} do
      write_file(Path.join(dir, "stack/aa/bb/shape-a/1.data"), 100)
      missing = Path.join(dir, "stack/aa/bb/does-not-exist")

      # A nonexistent path stat fails -> contributes 0, no crash.
      {total, buckets} = Disk.recursive_usage_grouped(missing, [], 4)
      assert total == 0
      assert buckets == %{}

      # And the rest of a valid tree is still counted.
      {total, buckets} = Disk.recursive_usage_grouped(dir, [], 4)
      assert total == 100
      assert buckets == %{"shape-a" => 100}
    end

    test "total stays byte-identical to recursive_usage/2 when a dir is unreadable",
         %{tmp_dir: dir} do
      write_file(Path.join(dir, "stack/aa/bb/shape-a/1.data"), 100)
      bad = Path.join(dir, "stack/aa/bb/shape-b")
      write_file(Path.join(bad, "1.data"), 50)
      File.chmod!(bad, 0o000)

      on_exit(fn -> File.chmod(bad, 0o755) end)

      legacy = Disk.recursive_usage(dir, [])
      {grouped, _buckets} = Disk.recursive_usage_grouped(dir, [], 4)

      # The grouped total must match the legacy total bit-for-bit, including the
      # legacy reset-to-0 behaviour on an unreadable directory.
      assert grouped == legacy
    end

    test "directory with no files at the bucket depth yields no bucket", %{tmp_dir: dir} do
      File.mkdir_p!(Path.join(dir, "stack/aa/bb/empty-shape"))

      {total, buckets} = Disk.recursive_usage_grouped(dir, [], 4)
      assert total == 0
      assert buckets == %{}
    end
  end
end
