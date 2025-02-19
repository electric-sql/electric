defmodule Electric.UtilsTest do
  alias Electric.Utils
  use ExUnit.Case, async: true
  doctest Utils, import: true

  @moduletag :tmp_dir

  describe "external_merge_sort/4" do
    setup %{tmp_dir: tmp_dir, file_size: size} do
      {:ok, %{path: tmp_file_with_random_contents(tmp_dir, "test.txt", size)}}
    end

    @tag file_size: 1_000
    test "sorts a file", %{path: path} do
      refute stream_sorted?(stream_test_file(path))
      assert :ok = Utils.external_merge_sort(path, &stream_test_file/1, &<=/2)
      assert stream_sorted?(stream_test_file(path))
    end

    @tag file_size: 10_000
    test "sorts a large file externally", %{path: path} do
      refute stream_sorted?(stream_test_file(path))
      assert :ok = Utils.external_merge_sort(path, &stream_test_file/1, &<=/2, 1_000)
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
      assert :ok = Utils.external_merge_sort(path, &stream_test_file/1, &<=/2, 1_000)
      assert stream_sorted?(stream_test_file(path))

      for {_, line} <- stream_test_file(path) do
        assert <<_::32, _::binary-size(18), ?\r, ?\n, _::binary-size(20)>> = line
      end
    end
  end

  describe "concat_files/3" do
    @num_subtests 10

    test "concats files verbatim", %{tmp_dir: tmp_dir} do
      counts = [3, 5, 7]
      sizes = [1000, 10_000, 100_000]
      output_path = Path.join(tmp_dir, "output.txt")

      Stream.repeatedly(fn -> Enum.random(counts) end)
      |> Stream.with_index()
      |> Stream.take(@num_subtests)
      |> Enum.each(fn {count, i} ->
        paths =
          Enum.map(1..count, fn j ->
            filename = "test_#{i}_#{j}.txt"
            size = Enum.random(sizes)
            tmp_file_with_random_contents(tmp_dir, filename, size)
          end)

        :ok = Utils.concat_files(paths, output_path)

        concatenated_contents =
          Enum.reduce(paths, "", fn path, bin -> bin <> File.read!(path) end)

        assert concatenated_contents == File.read!(output_path)
      end)
    end
  end

  defp tmp_file_with_random_contents(tmp_dir, filename, size) do
    path = Path.join(tmp_dir, filename)

    Stream.unfold(0, fn
      bytes when bytes >= size ->
        nil

      bytes ->
        {<<Enum.random(0..0xFFFFFFFF)::32, :crypto.strong_rand_bytes(40)::binary>>,
         bytes + 4 + 40}
    end)
    |> Utils.write_stream_to_file!(path)

    path
  end

  defp stream_test_file(path) do
    Stream.resource(
      fn -> File.open!(path) end,
      fn file ->
        case IO.binread(file, 44) do
          <<key::32, data::binary>> ->
            {[{key, <<key::32, data::binary>>}], file}

          :eof ->
            {:halt, file}
        end
      end,
      &File.close/1
    )
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
