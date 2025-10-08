defmodule Electric.ShapeCache.PureFileStorage.Snapshot do
  alias Electric.ShapeCache.PureFileStorage, as: ST
  alias Electric.ShapeCache.Storage
  @moduledoc false

  @write_buffer_size 64 * 1024

  @doc """
  Write the stream of pre-formatted JSON lines of the initial query into the snapshot files.

  Snapshot storage is slightly different from main file storage, because
  our system requires one additional property: reads concurrent with writes.
  Because snapshots are a common operation, the fastest way to serve them to a client
  is to stream them out as they are being written.

  To fascilitate this property without overcomplicating the system, the snapshot chunks
  are stored as separate files as they are being written, with a `0x04` byte (end-of-transmission)
  appended to the end. Apart from that, the file is json-chunk formatted (jsonl with trailing commas)
  to allow for socket copies later on.

  The clients of the storage expect the snapshot chunks to be read in their entirety, which gives us freedom
  to do batched writes for performance, because reads are always going to be faster than we're writing.
  """
  def write_snapshot_stream!(stream, %ST{} = opts, write_buffer \\ @write_buffer_size) do
    stream
    |> Stream.transform(
      fn -> {0, nil, {[], 0}} end,
      fn line, {chunk_num, file, {buffer, buffer_size}} ->
        file = file || open_snapshot_chunk_to_write(opts, chunk_num)

        case line do
          :chunk_boundary ->
            IO.binwrite(file, [buffer, <<4::utf8>>])
            File.close(file)
            {[], {chunk_num + 1, nil, {[], 0}}}

          line ->
            line_size = IO.iodata_length(line)

            if buffer_size + line_size > write_buffer do
              IO.binwrite(file, [buffer, line, ",\n"])
              {[chunk_num], {chunk_num, file, {[], 0}}}
            else
              {[chunk_num],
               {chunk_num, file, {[buffer, line, ",\n"], buffer_size + line_size + 2}}}
            end
        end
      end,
      fn {chunk_num, file, {buffer, _}} ->
        cond do
          not is_nil(file) ->
            IO.binwrite(file, [buffer, <<4::utf8>>])
            {[chunk_num], {chunk_num, file, {[], 0}}}

          is_nil(file) and chunk_num == 0 ->
            # Special case if the source stream has ended before we started writing any chunks - we need to create the empty file for the first chunk.
            file = open_snapshot_chunk_to_write(opts, chunk_num)
            IO.binwrite(file, [buffer, <<4::utf8>>])
            {[chunk_num], {chunk_num, file, {[], 0}}}

          true ->
            {[chunk_num - 1], {chunk_num, file, {[], 0}}}
        end
      end,
      fn {_chunk_num, file, _} ->
        if file, do: File.close(file)
      end
    )
    |> Enum.reduce(0, fn chunk_num, _ -> chunk_num end)
  end

  def chunk_file_path(%ST{} = opts, chunk_num),
    do: ST.shape_log_path(opts, "#{chunk_num}.jsonsnapshot")

  defp open_snapshot_chunk_to_write(opts, chunk_num) do
    File.open!(chunk_file_path(opts, chunk_num), [:write, :exclusive, :raw])
  end

  @doc """
  Stream JSON lines of a given chunk.

  Streams out the lines without trailing commas or line breaks. If chunk is in the process
  of being written, then follows it as it's being written emitting lines as they appear.

  If chunk file still doesn't exist, will wait for up to 5 seconds for the file to appear.
  """
  def stream_chunk_lines(%ST{} = opts, chunk_num) do
    path = chunk_file_path(opts, chunk_num)

    Stream.resource(
      fn -> {wait_and_open!(path, [:raw, :read, :read_ahead]), nil, ""} end,
      fn {file, eof_seen, incomplete_line} ->
        case IO.binread(file, :line) do
          {:error, reason} ->
            raise Storage.Error, message: "failed to read #{inspect(path)}: #{inspect(reason)}"

          :eof ->
            cond do
              is_nil(eof_seen) ->
                # First time we see eof after any valid lines, we store a timestamp
                {[], {file, System.monotonic_time(:millisecond), incomplete_line}}

              # If it's been 90s without any new lines, and also we've not seen <<4>>,
              # then likely something is wrong
              System.monotonic_time(:millisecond) - eof_seen > 90_000 ->
                raise Storage.Error, message: "Snapshot hasn't updated in 90s"

              true ->
                # Sleep a little and check for new lines
                Process.sleep(20)
                {[], {file, eof_seen, incomplete_line}}
            end

          # The 4 byte marker (ASCII "end of transmission") indicates the end of the snapshot file.
          <<4::utf8>> ->
            {:halt, {file, nil, ""}}

          line ->
            cond do
              :binary.last(line) != ?\n ->
                # Not a full line
                {[], {file, nil, incomplete_line <> line}}

              line == "\n" ->
                {[binary_slice(incomplete_line, 0..-2//1)], {file, nil, ""}}

              true ->
                {[incomplete_line <> binary_slice(line, 0..-3//1)], {file, nil, ""}}
            end
        end
      end,
      &File.close(elem(&1, 0))
    )
  end

  defp wait_and_open!(path, modes, time_left \\ :timer.seconds(5))

  defp wait_and_open!(path, _, time_left) when time_left <= 0,
    do: raise(Storage.Error, message: "failed to open #{path}: :enoent")

  defp wait_and_open!(path, modes, time_left) do
    start = System.monotonic_time(:millisecond)

    case File.open(path, modes) do
      {:ok, file} ->
        file

      {:error, :enoent} ->
        Process.sleep(20)
        wait_and_open!(path, modes, time_left - (System.monotonic_time(:millisecond) - start))

      {:error, reason} ->
        raise(Storage.Error, message: "failed to open #{path}: #{inspect(reason)}")
    end
  end
end
