defmodule Electric.ShapeCache.PureFileStorage.FileOwner do
  use GenServer
  alias Electric.Replication.LogOffset
  import Electric.Replication.LogOffset

  import Electric.ShapeCache.PureFileStorage,
    only: [
      log_path: 1,
      chunk_index_path: 1,
      file_size_if_exists: 1,
      write_metadata: 3,
      latest_offset: 1
    ]

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: opts.write_server)
  end

  def open_files(%{write_server: server}) do
    GenServer.call(server, :open_files)
  end

  def append_to_log(%{write_server: server}, data) do
    GenServer.call(server, {:append_to_log, data})
  end

  def init(opts) do
    Process.flag(:trap_exit, true)

    {:ok,
     %{
       opts: opts,
       log_file: nil,
       chunk_file: nil,
       write_position: 0,
       chunk_file_initialized?: false,
       latest_offset: LogOffset.last_before_real_offsets()
     }}
  end

  def terminate(_, state) do
    if state.log_file, do: File.close(state.log_file)
    if state.chunk_file, do: File.close(state.chunk_file)
  end

  def handle_call(:open_files, _from, state) do
    log_file = File.open!(log_path(state.opts), [:append, :raw])
    log_file_position = file_size_if_exists(log_path(state.opts))
    chunk_file = File.open!(chunk_index_path(state.opts), [:append, :raw])
    chunk_file_initialized? = file_size_if_exists(chunk_index_path(state.opts)) > 0

    {:reply, :ok,
     %{
       state
       | log_file: log_file,
         chunk_file: chunk_file,
         write_position: log_file_position,
         chunk_file_initialized?: chunk_file_initialized?,
         latest_offset: latest_offset(state.opts)
     }}
  end

  def handle_call(
        {:append_to_log, data},
        _from,
        %{
          log_file: log_file,
          chunk_file: chunk_file,
          chunk_file_initialized?: chunk_file_initialized?,
          write_position: write_position,
          latest_offset: latest_offset
        } = state
      ) do
    {new_write_position, new_chunk_file_initialized?, {_, buffer}, new_latest_offset} =
      Enum.reduce(data, {write_position, chunk_file_initialized?, {0, []}, latest_offset}, fn
        {:chunk_boundary, offset}, {position, true, {_, buffer}, latest_offset} ->
          IO.binwrite(
            chunk_file,
            <<LogOffset.to_int128(offset)::binary, position::64,
              LogOffset.to_int128(offset)::binary, position::64>>
          )

          IO.binwrite(log_file, buffer)

          {position, true, {0, []}, latest_offset}

        {offset, _, _, _}, acc when is_log_offset_lte(offset, latest_offset) ->
          acc

        {offset, key, op_type, json_log_item},
        {position, chunk_file_initialized?, {buffer_size, buffer}, _} ->
          if not chunk_file_initialized? do
            IO.binwrite(chunk_file, <<LogOffset.to_int128(offset)::binary, position::64>>)
          end

          key_size = byte_size(key)
          json_size = byte_size(json_log_item)

          iodata = [
            LogOffset.to_int128(offset),
            <<key_size::32>>,
            key,
            <<get_op_type(op_type)::8, 0::8, json_size::64>>,
            json_log_item
          ]

          iodata_size = 30 + key_size + json_size

          if buffer_size + iodata_size > 64 * 1024 do
            IO.binwrite(log_file, [buffer | iodata])
            {position + iodata_size, true, {0, []}, offset}
          else
            {position + iodata_size, true, {buffer_size + iodata_size, [buffer | iodata]}, offset}
          end
      end)

    IO.binwrite(log_file, buffer)

    write_metadata(state.opts, :latest_offset, new_latest_offset)

    {:reply, :ok,
     %{
       state
       | write_position: new_write_position,
         chunk_file_initialized?: new_chunk_file_initialized?
     }}
  end

  defp get_op_type(:insert), do: ?i
  defp get_op_type(:update), do: ?u
  defp get_op_type(:delete), do: ?d
end
