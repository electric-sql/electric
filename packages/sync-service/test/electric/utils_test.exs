defmodule Electric.UtilsTest do
  alias Electric.Utils
  use ExUnit.Case, async: true
  doctest Utils, import: true

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
      |> Stream.into(File.stream!(path))
      |> Stream.run()

      {:ok, %{path: path}}
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
