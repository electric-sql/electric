defmodule Electric.UtilsTest do
  alias Electric.Utils
  use ExUnit.Case, async: true
  doctest Utils, import: true

  defp make_sorted_test_file(path, keys) do
    Stream.map(keys, fn key -> <<key::32, :crypto.strong_rand_bytes(40)::binary>> end)
    |> Utils.write_stream_to_file!(path)
  end

  describe "merge_sorted_files/4" do
    @describetag :tmp_dir

    test "should merge sorted files using the reader", %{tmp_dir: dir} do
      path1 = Path.join(dir, "test1.bin")
      path2 = Path.join(dir, "test2.bin")
      make_sorted_test_file(path1, [1, 3, 5])
      make_sorted_test_file(path2, [2, 4, 6])

      Utils.merge_sorted_files(
        [path1, path2],
        Path.join(dir, "test3.bin"),
        &read_next_item_test_file(&1, true)
      )

      # Ensure we're opening each file at most once
      assert_received {:line_read, fd1}
      assert_received {:line_read, fd2}
      assert_received {:line_read, ^fd1}
      assert_received {:line_read, ^fd2}
      assert_received {:line_read, ^fd1}
      assert_received {:line_read, ^fd2}

      assert stream_sorted?(stream_test_file(Path.join(dir, "test3.bin")))
    end
  end

  describe "external_merge_sort/4" do
    @describetag :tmp_dir

    setup %{tmp_dir: tmp_dir, file_size: size} do
      path = Path.join(tmp_dir, "test.txt")

      Stream.unfold(0, fn
        bytes when bytes >= size ->
          nil

        bytes ->
          {<<Enum.random(0..0xFFFFFFFF)::32, :crypto.strong_rand_bytes(40)::binary>>,
           bytes + 4 + 40}
      end)
      |> Utils.write_stream_to_file!(path)

      {:ok, %{path: path}}
    end

    @tag file_size: 1_000
    test "sorts a file", %{path: path} do
      refute stream_sorted?(stream_test_file(path))
      assert :ok = Utils.external_merge_sort(path, &read_next_item_test_file/1, &<=/2)
      assert stream_sorted?(stream_test_file(path))
    end

    @tag file_size: 10_000
    test "sorts a large file externally", %{path: path} do
      refute stream_sorted?(stream_test_file(path))
      assert :ok = Utils.external_merge_sort(path, &read_next_item_test_file/1, &<=/2, 1_000)
      assert stream_sorted?(stream_test_file(path))
    end

    @tag file_size: 10_000
    test ~S"sorts a large file externally if that file contains \r\n bytes mid-string", %{
      path: path
    } do
      Stream.unfold(0, fn
        bytes when bytes >= 10_000 ->
          nil

        bytes ->
          {<<Enum.random(0..0xFFFFFFFF)::32, :crypto.strong_rand_bytes(18)::binary, ?\r, ?\n,
             :crypto.strong_rand_bytes(20)::binary>>, bytes + 4 + 40}
      end)
      |> Utils.write_stream_to_file!(path)

      refute stream_sorted?(stream_test_file(path))
      assert :ok = Utils.external_merge_sort(path, &read_next_item_test_file/1, &<=/2, 1_000)
      assert stream_sorted?(stream_test_file(path))

      for {_, line} <- stream_test_file(path) do
        assert <<_::32, _::binary-size(18), ?\r, ?\n, _::binary-size(20)>> = line
      end
    end
  end

  defp read_next_item_test_file(file_descriptor, notify? \\ false) do
    if notify?, do: send(self(), {:line_read, file_descriptor})

    case IO.binread(file_descriptor, 44) do
      <<key::32, data::binary>> ->
        {key, <<key::32, data::binary>>}

      :eof ->
        :halt
    end
  end

  defp stream_test_file(path) do
    Utils.stream_file_items(path, &read_next_item_test_file/1)
  end

  defp stream_sorted?(stream, mapper \\ & &1, comparator \\ &<=/2) do
    Enum.reduce_while(stream, {true, nil}, fn value, {true, prev_value} ->
      new_value = mapper.(value)

      cond do
        is_nil(prev_value) -> {:cont, {true, new_value}}
        comparator.(prev_value, new_value) -> {:cont, {true, new_value}}
        true -> {:halt, {false, {prev_value, new_value}}}
      end
    end)
    |> elem(0)
  end
end
