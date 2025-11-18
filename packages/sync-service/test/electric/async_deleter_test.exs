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
    [trash_dir: AsyncDeleter.trash_dir(ctx.tmp_dir, ctx.stack_id)]
  end

  setup ctx do
    if ctx[:add_initial_files] do
      File.mkdir_p!(ctx.trash_dir)
      # create some dummy files in trash dir
      for i <- 1..3 do
        create_temp_file(ctx.trash_dir, "file_#{i}.txt", "initial data #{i}")
      end
    end

    :ok
  end

  setup ctx do
    start_link_supervised!(
      {AsyncDeleter,
       stack_id: ctx.stack_id, storage_dir: ctx.tmp_dir, cleanup_interval_ms: @interval}
    )

    :ok
  end

  test "delete moves directory into trash and later removes it", %{
    stack_id: stack_id,
    tmp_dir: base,
    trash_dir: trash_dir
  } do
    dir = create_temp_dir(%{tmp_dir: base}, "to_delete")
    file_path = create_temp_file(dir, "f.txt")

    assert File.exists?(file_path)

    assert :ok = AsyncDeleter.delete(stack_id, dir)

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
    assert File.dir?(trash_dir)
    assert_dir_empty(trash_dir)
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

    assert :ok = AsyncDeleter.delete(stack_id, d1)
    # quickly queue second before cleanup interval
    assert :ok = AsyncDeleter.delete(stack_id, d2)

    # Both originals gone
    refute File.exists?(d1)
    refute File.exists?(d2)

    # Should contain at least two renamed dirs before cleanup
    entries = File.ls!(trash_dir)
    assert length(entries) >= 2

    # After cleanup interval, trash dir should be empty
    assert_dir_empty(trash_dir)
  end

  test "deleting missing path returns ok and does nothing", %{
    tmp_dir: base,
    stack_id: stack_id,
    trash_dir: trash_dir
  } do
    path = Path.join(base, "nonexistent_#{System.unique_integer()}")
    refute File.exists?(path)

    assert :ok = AsyncDeleter.delete(stack_id, path)
    # nothing to assert further; just ensure no crash and no entries after interval
    assert_dir_empty(trash_dir)
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
        assert :ok = AsyncDeleter.delete(stack_id, f)
        sleep_time
      end)

    {:ok, max_sleep_time} = Enum.to_list(stream) |> Enum.max()

    # ensure all files are deleted
    assert_dir_empty(d1, 0)
    assert_dir_empty(trash_dir, max_sleep_time + 500)
  end

  @tag add_initial_files: true
  test "performs initial cleanup", %{trash_dir: trash_dir} do
    # ensure no files exist after startup
    assert_dir_empty(trash_dir)
  end

  defp assert_dir_empty(dir, timeout \\ 500) do
    assert File.ls!(dir) == []
  rescue
    e in ExUnit.AssertionError ->
      if timeout <= 0 do
        reraise e, __STACKTRACE__
      else
        Process.sleep(@interval)
        assert_dir_empty(dir, timeout - @interval)
      end
  end
end
