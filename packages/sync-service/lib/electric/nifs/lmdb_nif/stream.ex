defmodule Electric.Nifs.LmdbNif.Stream do
  @moduledoc """
  A lazy, enumerable stream over an LMDB database.

  Iterates `{key, value}` tuples in key order starting from a given key,
  fetching entries in batches.
  """

  alias Electric.Nifs.LmdbNif

  defstruct [:db, :start_key, batch_size: 100]

  defimpl Enumerable do
    def count(_stream), do: {:error, __MODULE__}
    def member?(_stream, _element), do: {:error, __MODULE__}
    def slice(_stream), do: {:error, __MODULE__}

    def reduce(_stream, {:halt, acc}, _fun), do: {:halted, acc}
    def reduce(stream, {:suspend, acc}, fun), do: {:suspended, acc, &reduce(stream, &1, fun)}

    def reduce(stream, {:cont, acc}, fun) do
      case LmdbNif.iterate_from(stream.db, stream.start_key, stream.batch_size) do
        {:ok, []} ->
          {:done, acc}

        {:ok, entries} ->
          emit(entries, stream, {:cont, acc}, fun)
      end
    end

    defp emit(_entries, _stream, {:halt, acc}, _fun), do: {:halted, acc}

    defp emit(entries, stream, {:suspend, acc}, fun) do
      {:suspended, acc, &emit(entries, stream, &1, fun)}
    end

    defp emit([], stream, {:cont, acc}, fun) do
      reduce(stream, {:cont, acc}, fun)
    end

    defp emit([{key, _value} = entry | rest], stream, {:cont, acc}, fun) do
      new_stream =
        if rest == [] do
          %{stream | start_key: next_key(key)}
        else
          stream
        end

      emit(rest, new_stream, fun.(entry, acc), fun)
    end

    defp next_key(key) do
      size = byte_size(key)
      <<prefix::binary-size(size - 1), last_byte>> = key

      if last_byte < 255 do
        <<prefix::binary, last_byte + 1>>
      else
        <<key::binary, 0>>
      end
    end
  end
end
