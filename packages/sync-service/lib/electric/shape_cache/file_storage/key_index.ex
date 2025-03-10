defmodule Electric.ShapeCache.FileStorage.KeyIndex do
  @moduledoc false
  alias Electric.Replication.LogOffset
  alias Electric.Utils
  alias Electric.ShapeCache.FileStorage.LogFile

  require Record

  @doc """
  Write an unsorted key index from the stream of log items to the given path.

  Key index maps the keys of operation to the offsets for further processing.
  We care about sorted index maps, but it's easier to generate them on the fly
  and sort them later.

  Key index format is, in elixir binary:

      <<key_size::32, key::binary, operation_offset::128, operation_type::8, json_start_position::64, json_size::64>>
  """
  @spec write_from_stream(Enumerable.t(LogFile.log_item_with_sizes()), path :: String.t()) ::
          Enumerable.t(LogFile.log_item_with_sizes())
  def write_from_stream(stream, path) do
    Utils.stream_add_side_effect(
      stream,
      # We're using delayed writes to avoid interfering with writing the log. Write size here is 64KB or 1s delay
      # It's used here because we're writing a line per log line, so this reduces disk contention
      fn -> {File.open!(path, [:write, :raw, {:delayed_write, 64 * 1024, 1000}]), 0} end,
      fn {log_offset, key_size, key, op_type, _, json_size, _} = line, {file, write_position} ->
        IO.binwrite(
          file,
          <<key_size::32, key::binary, LogFile.offset(log_offset)::binary, op_type::8,
            LogFile.expected_json_position(write_position, line)::64, json_size::64>>
        )

        {file, LogFile.expected_position(write_position, line)}
      end,
      &File.close(elem(&1, 0))
    )
  end

  Record.defrecord(:key_index_item, key: nil, op_type: nil, offset: nil, json: nil)

  @type key_index_item() ::
          record(:key_index_item,
            key: binary(),
            op_type: LogFile.op_type(),
            offset: LogOffset.t(),
            json: {json_start_position :: non_neg_integer, json_size :: non_neg_integer}
          )

  @doc """
  Read a key index from the given path.
  """
  @spec stream(path :: String.t()) :: Enumerable.t(key_index_item())
  def stream(path) do
    Stream.resource(
      fn -> File.open!(path, [:read, :raw, :read_ahead]) end,
      fn file ->
        with <<key_size::32>> <- IO.binread(file, 4),
             <<key::binary-size(key_size)>> <- IO.binread(file, key_size),
             <<tx_offset::64, op_offset::64, op_type::8, json_start_position::64, json_size::64>> <-
               IO.binread(file, 8 * 4 + 1) do
          item =
            key_index_item(
              key: key,
              op_type: op_type,
              offset: LogOffset.new(tx_offset, op_offset),
              json: {json_start_position, json_size}
            )

          {[item], file}
        else
          :eof -> {:halt, file}
        end
      end,
      &File.close/1
    )
  end

  @doc """
  Sort the key index file.

  Sorts alpha-numerically by key first and offset second, so within each
  key the operations are sorted by offset.

  Uses an external merge sort to support large files, but requires
  storage overhead while the sort is in-progress. Rewrites the original
  file after the sort is complete.
  """
  def sort(path) do
    Utils.external_merge_sort(path, &stream_for_sorting/1, &<=/2)
  end

  @spec stream_for_sorting(file :: :file.io_device()) ::
          Utils.sortable_binary({binary(), non_neg_integer(), non_neg_integer()}) | :halt
  defp stream_for_sorting(file) do
    with <<key_size::32>> <- IO.binread(file, 4),
         <<key::binary-size(key_size)>> <- IO.binread(file, key_size),
         <<tx_offset::64, op_offset::64, op_type::8, json_start_position::64, json_size::64>> <-
           IO.binread(file, 17 + 8 + 8) do
      full_line =
        <<key_size::32, key::binary, tx_offset::64, op_offset::64, op_type::8,
          json_start_position::64, json_size::64>>

      {{key, tx_offset, op_offset}, full_line}
    else
      :eof -> :halt
    end
  end

  @doc """
  Merge two sorted key index files into a third file adjusting the positions of the second file by the given offset.
  """
  @spec merge_with_offset(
          path1 :: String.t(),
          path2 :: String.t(),
          output_path :: String.t(),
          offset :: non_neg_integer()
        ) :: :ok
  def merge_with_offset(path1, path2, output_path, offset) do
    File.cp!(path1, output_path)

    stream(path2)
    |> Stream.map(fn key_index_item(json: {start_position, json_size}) = item ->
      key_index_item(item, json: {start_position + offset, json_size})
    end)
    |> Stream.map(&serialize_key_index_item/1)
    |> Enum.into(File.stream!(output_path, [:append]))
  end

  defp serialize_key_index_item(
         key_index_item(offset: offset, key: key, op_type: op_type, json: {pos, size})
       ) do
    <<byte_size(key)::32, key::binary, LogFile.offset(offset)::binary, op_type::8, pos::64,
      size::64>>
  end
end
