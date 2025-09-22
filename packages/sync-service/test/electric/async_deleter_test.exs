defmodule Electric.AsyncDeleterTest do
  use ExUnit.Case, async: true
  import Support.ComponentSetup
  @moduletag :tmp_dir

  # Use a very short interval to keep tests fast
  @interval 25

  setup [
    :with_stack_id_from_test,
    :with_registry
  ]

  defp trash_dir(stack_id) do
    Path.join(System.tmp_dir!(), ".electric_trash_" <> stack_id)
  end

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
      {Electric.AsyncDeleter, stack_id: ctx.stack_id, cleanup_interval_ms: @interval}
    )

    Map.put(ctx, :trash_dir, trash_dir(ctx.stack_id))
  end

  test "delete moves directory into trash and later removes it", %{
    stack_id: stack_id,
    tmp_dir: base
  } do
    dir = create_temp_dir(%{tmp_dir: base}, "to_delete")
    file_path = create_temp_file(dir, "f.txt")

    assert File.exists?(file_path)

    assert :ok = Electric.AsyncDeleter.delete(dir, stack_id: stack_id)

    # Original dir should no longer exist (moved)
    refute File.exists?(dir)

    # Something should now exist in trash dir
    tdir = trash_dir(stack_id)
    assert File.dir?(tdir)
    # Wait a moment to allow rename to complete (should be immediate)
    assert Enum.any?(File.ls!(tdir), fn _ -> true end)

    # Before interval passes, the moved content still exists in trash
    moved_entries_before = File.ls!(tdir)
    assert moved_entries_before != []

    # After interval passes, cleanup should have run and trash dir should be empty again
    Process.sleep(@interval + 30)
    assert File.dir?(tdir)
    assert File.ls!(tdir) == []
  end

  test "multiple deletes are batched into single cleanup", %{
    stack_id: stack_id,
    tmp_dir: base
  } do
    d1 = create_temp_dir(%{tmp_dir: base}, "d1")
    d2 = create_temp_dir(%{tmp_dir: base}, "d2")

    f1 = create_temp_file(d1, "a")
    f2 = create_temp_file(d2, "b")

    assert File.exists?(f1)
    assert File.exists?(f2)

    assert :ok = Electric.AsyncDeleter.delete(d1, stack_id: stack_id)
    # quickly queue second before cleanup interval
    assert :ok = Electric.AsyncDeleter.delete(d2, stack_id: stack_id)

    # Both originals gone
    refute File.exists?(d1)
    refute File.exists?(d2)

    tdir = trash_dir(stack_id)
    # Should contain at least two renamed dirs before cleanup
    entries = File.ls!(tdir)
    assert length(entries) >= 2

    Process.sleep(@interval + 30)

    # After cleanup interval, trash dir should be empty
    assert File.ls!(tdir) == []
  end

  test "deleting missing path returns ok and does nothing", %{stack_id: stack_id} do
    path = Path.join(System.tmp_dir!(), "nonexistent_#{System.unique_integer()}")
    refute File.exists?(path)

    assert :ok = Electric.AsyncDeleter.delete(path, stack_id: stack_id)
    # nothing to assert further; just ensure no crash and no entries after interval
    Process.sleep(@interval + 30)
    assert File.ls!(trash_dir(stack_id)) == []
  end
end
