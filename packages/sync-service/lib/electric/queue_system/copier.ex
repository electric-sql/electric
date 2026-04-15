defmodule Electric.QueueSystem.Copier do
  @moduledoc """
  Copies entries between LMDB databases in batches.

  Pure function module — no process state. Used by the consumer process
  to copy snapshot and streaming data into the output DB.
  """

  alias Electric.Nifs.LmdbNif

  @default_batch_size 1000

  @spec copy(reference(), reference(), keyword()) :: {:ok, non_neg_integer()}
  def copy(source_db, dest_db, opts \\ []) do
    batch_size = opts[:batch_size] || @default_batch_size
    copy_loop(source_db, dest_db, <<0>>, batch_size, 0)
  end

  @spec copy_until(reference(), reference(), binary(), keyword()) :: {:ok, non_neg_integer()}
  def copy_until(source_db, dest_db, last_key, opts \\ []) do
    batch_size = opts[:batch_size] || @default_batch_size
    copy_until_loop(source_db, dest_db, <<0>>, last_key, batch_size, 0)
  end

  defp copy_loop(source_db, dest_db, cursor, batch_size, count) do
    case LmdbNif.iterate_from(source_db, cursor, batch_size) do
      {:ok, []} ->
        {:ok, count}

      {:ok, entries} ->
        :ok = LmdbNif.batch_put(dest_db, entries)
        {last_key, _} = List.last(entries)
        copy_loop(source_db, dest_db, next_key(last_key), batch_size, count + length(entries))
    end
  end

  defp copy_until_loop(source_db, dest_db, cursor, last_key, batch_size, count) do
    case LmdbNif.iterate_from(source_db, cursor, batch_size) do
      {:ok, []} ->
        {:ok, count}

      {:ok, entries} ->
        entries = Enum.take_while(entries, fn {k, _v} -> k <= last_key end)

        if entries == [] do
          {:ok, count}
        else
          :ok = LmdbNif.batch_put(dest_db, entries)
          {final_key, _} = List.last(entries)

          if final_key >= last_key do
            {:ok, count + length(entries)}
          else
            copy_until_loop(
              source_db,
              dest_db,
              next_key(final_key),
              last_key,
              batch_size,
              count + length(entries)
            )
          end
        end
    end
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
