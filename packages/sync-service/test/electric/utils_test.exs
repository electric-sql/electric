defmodule Electric.UtilsTest do
  alias Electric.Utils
  use ExUnit.Case, async: true
  doctest Utils, import: true

  @moduletag :tmp_dir

  defp make_sorted_test_file(path, keys) do
    Stream.map(keys, fn key -> <<key::32, :crypto.strong_rand_bytes(40)::binary>> end)
    |> Enum.into(File.stream!(path))
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

  defp tmp_file_with_random_contents(tmp_dir, filename, size) do
    path = Path.join(tmp_dir, filename)

    Stream.unfold(0, fn
      bytes when bytes >= size ->
        nil

      bytes ->
        {<<Enum.random(0..0xFFFFFFFF)::32, :crypto.strong_rand_bytes(40)::binary>>,
         bytes + 4 + 40}
    end)
    |> Enum.into(File.stream!(path))

    path
  end
end
