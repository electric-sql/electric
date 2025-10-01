defmodule Electric.AsyncDeleterTest do
  use ExUnit.Case, async: true
  import Support.ComponentSetup

  alias Electric.AsyncDeleter
  @moduletag :tmp_dir

  # Use a very short interval to keep tests fast
  @interval 25

  setup [
    :with_stack_id_from_test,
    :with_registry
  ]

  defp create_temp_dir(ctx, name) do
    dir = Path.join(ctx.tmp_dir, name)
    File.mkdir_p!(dir)
    dir
  end

  defp create_temp_file(dir, name, contents \\ "data") do
    path = Path.join(dir, name)
    File.write!(path, contents)
    path
  end

  setup ctx do
    start_link_supervised!(
      {AsyncDeleter,
       stack_id: ctx.stack_id, storage_dir: ctx.tmp_dir, cleanup_interval_ms: @interval}
    )

    [trash_dir: AsyncDeleter.trash_dir!(ctx.stack_id)]
  end

  test "delete moves directory into trash and later removes it", %{
    stack_id: stack_id,
    tmp_dir: base,
    trash_dir: trash_dir
  } do
    dir = create_temp_dir(%{tmp_dir: base}, "to_delete")
    file_path = create_temp_file(dir, "f.txt")

    assert File.exists?(file_path)

    assert :ok = AsyncDeleter.delete(dir, stack_id: stack_id)

    # Original dir should no longer exist (moved)
    refute File.exists?(dir)

    # Something should now exist in trash dir
    assert File.dir?(trash_dir)
    # Wait a moment to allow rename to complete (should be immediate)
    assert Enum.any?(File.ls!(trash_dir), fn _ -> true end)

    # Before interval passes, the moved content still exists in trash
    moved_entries_before = File.ls!(trash_dir)
    assert moved_entries_before != []

    # After interval passes, cleanup should have run and trash dir should be empty again
    Process.sleep(@interval + 30)
    assert File.dir?(trash_dir)
    assert File.ls!(trash_dir) == []
  end

  test "multiple deletes are batched into single cleanup", %{
    stack_id: stack_id,
    tmp_dir: base,
    trash_dir: trash_dir
  } do
    d1 = create_temp_dir(%{tmp_dir: base}, "d1")
    d2 = create_temp_dir(%{tmp_dir: base}, "d2")

    f1 = create_temp_file(d1, "a")
    f2 = create_temp_file(d2, "b")

    assert File.exists?(f1)
    assert File.exists?(f2)

    assert :ok = AsyncDeleter.delete(d1, stack_id: stack_id)
    # quickly queue second before cleanup interval
    assert :ok = AsyncDeleter.delete(d2, stack_id: stack_id)

    # Both originals gone
    refute File.exists?(d1)
    refute File.exists?(d2)

    # Should contain at least two renamed dirs before cleanup
    entries = File.ls!(trash_dir)
    assert length(entries) >= 2

    Process.sleep(@interval + 30)

    # After cleanup interval, trash dir should be empty
    assert File.ls!(trash_dir) == []
  end

  test "deleting missing path returns ok and does nothing", %{
    tmp_dir: base,
    stack_id: stack_id,
    trash_dir: trash_dir
  } do
    path = Path.join(base, "nonexistent_#{System.unique_integer()}")
    refute File.exists?(path)

    assert :ok = AsyncDeleter.delete(path, stack_id: stack_id)
    # nothing to assert further; just ensure no crash and no entries after interval
    Process.sleep(@interval + 30)
    assert File.ls!(trash_dir) == []
  end

  test "can manage concurrent deletes while cleaning up", %{
    stack_id: stack_id,
    tmp_dir: base,
    trash_dir: trash_dir
  } do
    d1 = create_temp_dir(%{tmp_dir: base}, "d1")

    stream =
      Task.async_stream(1..1000, fn i ->
        f = create_temp_file(d1, "tmp_#{i}")
        sleep_time = round(Enum.random(1..10) * 0.1 * (2 * @interval))
        Process.sleep(sleep_time)
        assert :ok = AsyncDeleter.delete(f, stack_id: stack_id)
      end)

    Enum.to_list(stream)

    # ensure all files are deleted
    Process.sleep(@interval + 30)
    assert File.ls!(d1) == []
    assert File.ls!(trash_dir) == []
  end
end
