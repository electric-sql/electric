defmodule Electric.ShapeCache.PureFileStorage do
  alias Electric.ShapeCache.FileStorage.LogFile
  alias Electric.ShapeCache.FileStorage.ChunkIndex
  alias __MODULE__, as: FS
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias Electric.Telemetry.OpenTelemetry

  alias __MODULE__.FileInfo
  require FileInfo
  import Electric.Replication.LogOffset
  require Electric.ShapeCache.FileStorage
  require Logger

  @behaviour Electric.ShapeCache.Storage

  @version 1
  defstruct [
    :base_path,
    :stack_id,
    :chunk_bytes_threshold,
    :shape_handle,
    :data_dir,
    :log_dir,
    :metadata_dir,
    version: @version
  ]

  def start_link(opts) do
    initialise_filesystem(opts)

    :ignore
  end

  @impl Electric.ShapeCache.Storage
  def shared_opts(opts) do
    %{
      base_path: Path.join(Keyword.fetch!(opts, :storage_dir), Keyword.fetch!(opts, :stack_id)),
      stack_id: Keyword.fetch!(opts, :stack_id),
      chunk_bytes_threshold: Keyword.fetch!(opts, :chunk_bytes_threshold)
    }
  end

  @impl Electric.ShapeCache.Storage
  def for_shape(shape_handle, %FS{shape_handle: shape_handle} = opts), do: opts

  def for_shape(shape_handle, opts) do
    data_dir = Path.join([opts.base_path, shape_handle])

    %FS{
      # Shared
      base_path: opts.base_path,
      stack_id: opts.stack_id,
      chunk_bytes_threshold: opts.chunk_bytes_threshold,
      # Shape-specific
      shape_handle: shape_handle,
      data_dir: data_dir,
      log_dir: Path.join([data_dir, "log"]),
      metadata_dir: metadata_dir_path(opts, shape_handle)
    }
  end

  @impl Electric.ShapeCache.Storage
  def initialise(%FS{} = opts) do
    if requires_full_cleanup?(opts), do: cleanup_internals!(opts)
    initialise_filesystem(opts)
    :ok
  end

  @impl Electric.ShapeCache.Storage
  def set_shape_definition(shape_definition, %FS{metadata_dir: metadata_dir}) do
    file_path = Path.join([metadata_dir, "shape_definition.json"])
    encoded_shape = Jason.encode!(shape_definition)

    case write(file_path, encoded_shape, [:exclusive]) do
      :ok ->
        :ok

      {:error, :eexist} ->
        # file already exists - by virtue of the shape handle being the hash of the
        # definition we do not need to compare them
        :ok

      {:error, reason} ->
        raise "Failed to write shape definition to file: #{reason}"
    end
  end

  @impl Electric.ShapeCache.Storage
  def get_all_stored_shapes(%{base_path: base_path} = opts) do
    case File.ls(base_path) do
      {:ok, shape_handles} ->
        shape_handles
        # |> Enum.reject(&exists?(deletion_marker_path(shapes_dir, &1)))
        |> Enum.reduce(%{}, fn shape_handle, acc ->
          shape_def_path = shape_definition_path(opts, shape_handle)

          with {:ok, shape_def_encoded} <- read(shape_def_path),
               {:ok, shape_def_json} <- Jason.decode(shape_def_encoded),
               {:ok, shape} <- Electric.Shapes.Shape.from_json_safe(shape_def_json) do
            Map.put(acc, shape_handle, shape)
          else
            # if the shape definition file cannot be read/decoded, just ignore it
            {:error, _reason} -> acc
          end
        end)
        |> then(&{:ok, &1})

      {:error, :enoent} ->
        {:ok, %{}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl Electric.ShapeCache.Storage
  def get_total_disk_usage(%{base_path: _} = opts) when not is_struct(opts, FS), do: 0

  @impl Electric.ShapeCache.Storage
  def get_current_position(%FS{} = opts) do
    {:ok, latest_offset(opts), pg_snapshot(opts)}
  end

  defp pg_snapshot(opts), do: read_metadata(opts, :pg_snapshot)
  # TODO: might be slightly wrong
  defp latest_offset(opts),
    do: read_metadata(opts, :latest_offset) || LogOffset.last_before_real_offsets()

  @impl Electric.ShapeCache.Storage
  def set_pg_snapshot(pg_snapshot, opts), do: write_metadata(opts, :pg_snapshot, pg_snapshot)

  @impl Electric.ShapeCache.Storage
  def snapshot_started?(%FS{} = opts), do: read_metadata(opts, :snapshot_started) || false

  @impl Electric.ShapeCache.Storage
  def mark_snapshot_as_started(%FS{} = opts), do: write_metadata(opts, :snapshot_started, true)

  @impl Electric.ShapeCache.Storage
  def make_new_snapshot!(data_stream, %FS{stack_id: stack_id} = opts) do
    OpenTelemetry.with_span(
      "storage.make_new_snapshot",
      [storage_impl: "pure_file", "shape.handle": opts.shape_handle],
      stack_id,
      fn ->
        last_chunk_num = write_stream_to_chunk_files(data_stream, opts)
        write_metadata(opts, :latest_offset, LogOffset.new(0, last_chunk_num))
        write_metadata(opts, :last_snapshot_offset, LogOffset.new(0, last_chunk_num))
      end
    )
  end

  # Write to a set of "chunk" files, with numbering starting from 0, and return the highest chunk number
  defp write_stream_to_chunk_files(data_stream, opts) do
    data_stream
    |> Stream.transform(
      fn -> {0, nil} end,
      fn line, {chunk_num, file} ->
        file = file || open_snapshot_chunk_to_write(opts, chunk_num)

        case line do
          :chunk_boundary ->
            # Use the 4 byte marker (ASCII "end of transmission") to indicate the end of the snapshot,
            # so that concurrent readers can detect that the snapshot has been completed. This is a way to
            # distinguish between "file quiet" and "file done".
            IO.binwrite(file, <<4::utf8>>)
            File.close(file)
            {[], {chunk_num + 1, nil}}

          line ->
            IO.binwrite(file, [line, ?\n])
            {[chunk_num], {chunk_num, file}}
        end
      end,
      fn {chunk_num, file} ->
        if is_nil(file) and chunk_num == 0 do
          # Special case if the source stream has ended before we started writing any chunks - we need to create the empty file for the first chunk.
          {[chunk_num], {chunk_num, open_snapshot_chunk_to_write(opts, chunk_num)}}
        else
          {[], {chunk_num, file}}
        end
      end,
      fn {_chunk_num, file} ->
        if file do
          IO.binwrite(file, <<4::utf8>>)
          File.close(file)
        end
      end
    )
    |> Enum.reduce(0, fn chunk_num, _ -> chunk_num end)
  end

  @impl Electric.ShapeCache.Storage
  def append_to_log!(log_items, %FS{} = opts) do
    latest_offset = latest_offset(opts)

    Stream.transform(
      Enum.to_list(log_items),
      fn ->
        {
          File.open!(log_path(opts), [:append, :raw]),
          file_size_if_exists(log_path(opts)),
          File.open!(chunk_index_path(opts), [:append, :raw]),
          file_size_if_exists(chunk_index_path(opts)) > 0,
          latest_offset
        }
      end,
      fn
        {:chunk_boundary, offset}, {log_file, position, chunk_file, true, latest_offset} ->
          IO.binwrite(
            chunk_file,
            <<LogOffset.to_int128(offset)::binary, position::64,
              LogOffset.to_int128(offset)::binary, position::64>>
          )

          {[], {log_file, position, chunk_file, true, latest_offset}}

        # Assumes monotonicity of the log offsets
        {offset, _, _, _}, acc when is_log_offset_lte(offset, latest_offset) ->
          {[], acc}

        {offset, key, op_type, json_log_item},
        {log_file, position, chunk_file, chunk_file_initialized?, _} ->
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

          IO.binwrite(log_file, iodata)

          # Assumes monotonicity of the log offsets and that the stream is ordered
          {[], {log_file, position + key_size + json_size + 30, chunk_file, true, offset}}
      end,
      fn {_, _, _, _, latest_offset} = acc ->
        write_metadata(opts, :latest_offset, latest_offset)
        {[], acc}
      end,
      &close_all_files/1
    )
    |> Stream.run()
  end

  @impl Electric.ShapeCache.Storage
  def get_log_stream(%LogOffset{op_offset: op_offset} = offset, max_offset, %FS{} = opts)
      when not is_real_offset(offset) do
    unless snapshot_started?(opts), do: raise(Storage.Error, message: "Snapshot not started")

    case {last_snapshot_offset(opts), offset} do
      {_, x} when is_min_offset(x) ->
        stream_snapshot_chunk!(opts, 0)

      {%LogOffset{} = latest, offset} when is_log_offset_lt(offset, latest) ->
        # Stream next chunk of snapshot
        stream_snapshot_chunk!(opts, op_offset + 1)

      {nil, _offset} ->
        # Try streaming the next chunk if the file already exists, otherwise wait for the file or end of snapshot to be announced
        # where either event should happen shortly, we just either hit a file switch or just before CubDB was updatred
        wait_for_chunk_file_or_snapshot_end(opts, op_offset + 1)

      {%LogOffset{}, offset} ->
        stream_log_chunk(offset, max_offset, opts)
    end
  end

  def get_log_stream(%LogOffset{} = offset, max_offset, %FS{} = opts) do
    stream_log_chunk(offset, max_offset, opts)
  end

  defp stream_log_chunk(offset, max_offset, _) when is_log_offset_lte(max_offset, offset),
    do: []

  defp stream_log_chunk(offset, max_offset, opts) do
    case ChunkIndex.fetch_chunk(chunk_index_path(opts), offset) do
      {:ok, chunk_end_offset, {start_pos, end_pos}} when not is_nil(end_pos) ->
        LogFile.stream_jsons(log_path(opts), start_pos, end_pos, offset)
        |> Stream.concat(stream_log_chunk(chunk_end_offset, max_offset, opts))

      {:ok, nil, {start_pos, nil}} ->
        LogFile.stream_jsons_until_offset(log_path(opts), start_pos, offset, max_offset)

      :error ->
        []
    end
  end

  @impl Electric.ShapeCache.Storage
  def get_chunk_end_log_offset(offset, %FS{} = opts) when is_min_offset(offset),
    do: LogOffset.new(0, 0)

  @max_virtual_offset LogOffset.last_before_real_offsets()
  # If the current offset is one of the "real" chunks, then next chunk is the boundary
  def get_chunk_end_log_offset(offset, %FS{} = opts)
      when is_virtual_offset(offset) and offset != @max_virtual_offset do
    case last_snapshot_offset(opts) do
      # We don't have the "last one", so optimistically give the next chunk pointer.
      # If it turns out we're actually done, then this pointer will give beginning of txn log when requested with.
      nil -> LogOffset.increment(offset)
      # This is easy - we want to read next chunk and we know we can
      last when is_log_offset_lt(offset, last) -> LogOffset.increment(offset)
      # Requested chunk is at the end or beyond the end of the snapshot, serve from txn log. If no chunk is yet present, get end of log
      _ -> get_chunk_end_log_offset(@max_virtual_offset, opts)
    end
  end

  def get_chunk_end_log_offset(offset, %FS{} = opts) do
    case ChunkIndex.fetch_chunk(chunk_index_path(opts), offset) do
      {:ok, max_offset, _} -> max_offset
      :error -> nil
    end
  end

  @impl Electric.ShapeCache.Storage
  def unsafe_cleanup!(%FS{} = opts) do
    cleanup_internals!(opts)
    :ok
  end

  @impl Electric.ShapeCache.Storage
  def cleanup!(%FS{} = opts) do
    cleanup_internals!(opts)
    :ok
  end

  defp wait_for_chunk_file_or_snapshot_end(
         opts,
         chunk_number,
         max_wait_time \\ 60_000,
         total_wait_time \\ 0
       )

  defp wait_for_chunk_file_or_snapshot_end(_, _, max, total) when total >= max,
    do: raise("Snapshot hasn't updated in #{max}ms")

  defp wait_for_chunk_file_or_snapshot_end(
         %FS{} = opts,
         chunk_number,
         max_wait_time,
         total_wait_time
       ) do
    path = snapshot_chunk_path(opts, chunk_number)

    cond do
      exists?(path) ->
        stream_snapshot_chunk!(opts, chunk_number)

      last_snapshot_offset(opts) != nil ->
        []

      true ->
        Process.sleep(50)

        wait_for_chunk_file_or_snapshot_end(
          opts,
          chunk_number,
          max_wait_time,
          total_wait_time + 50
        )
    end
  end

  defp last_snapshot_offset(opts), do: read_metadata(opts, :last_snapshot_offset)

  defp stream_snapshot_chunk!(%FS{} = opts, chunk_number) do
    Stream.resource(
      fn -> {open_snapshot_chunk(opts, chunk_number), nil, ""} end,
      fn {{path, file}, eof_seen, incomplete_line} ->
        case IO.binread(file, :line) do
          {:error, reason} ->
            raise Storage.Error, message: "failed to read #{inspect(path)}: #{inspect(reason)}"

          :eof ->
            cond do
              is_nil(eof_seen) ->
                # First time we see eof after any valid lines, we store a timestamp
                {[], {{path, file}, System.monotonic_time(:millisecond), incomplete_line}}

              # If it's been 90s without any new lines, and also we've not seen <<4>>,
              # then likely something is wrong
              System.monotonic_time(:millisecond) - eof_seen > 90_000 ->
                raise Storage.Error, message: "Snapshot hasn't updated in 90s"

              true ->
                # Sleep a little and check for new lines
                Process.sleep(20)
                {[], {{path, file}, eof_seen, incomplete_line}}
            end

          # The 4 byte marker (ASCII "end of transmission") indicates the end of the snapshot file.
          <<4::utf8>> ->
            {:halt, {{path, file}, nil, ""}}

          line ->
            if binary_slice(line, -1, 1) == "\n" do
              {[incomplete_line <> line], {{path, file}, nil, ""}}
            else
              {[], {{path, file}, nil, incomplete_line <> line}}
            end
        end
      end,
      &File.close(elem(elem(&1, 0), 1))
    )
  end

  defp open_snapshot_chunk(opts, chunk_num, attempts_left \\ 250)

  defp open_snapshot_chunk(_, chunk_num, 0),
    do: raise(Storage.Error, message: "failed to read snapshot chunk #{chunk_num}: :enoent")

  defp open_snapshot_chunk(opts, chunk_num, attempts_left) do
    unless snapshot_started?(opts),
      do: raise(Storage.Error, message: "Snapshot not started")

    path = snapshot_chunk_path(opts, chunk_num)

    case File.open(path, [:read, :raw, read_ahead: 1024]) do
      {:ok, file} ->
        {path, file}

      {:error, :enoent} ->
        Process.sleep(20)
        open_snapshot_chunk(opts, chunk_num, attempts_left - 1)

      {:error, reason} ->
        raise IO.StreamError, reason: reason
    end
  end

  defp get_op_type(:insert), do: ?i
  defp get_op_type(:update), do: ?u
  defp get_op_type(:delete), do: ?d

  defp requires_full_cleanup?(opts), do: true
  defp cleanup_internals!(opts), do: rm_rf(opts.data_dir)

  defp initialise_filesystem(%FS{
         data_dir: data_dir,
         log_dir: log_dir,
         metadata_dir: metadata_dir
       }) do
    mkdir_p(data_dir)
    mkdir_p(log_dir)
    mkdir_p(metadata_dir)
  end

  # Stable path helpers
  # defp shape_definition_path(%FS{metadata_dir: metadata_dir}),
  #   do: Path.join([metadata_dir, "shape_definition.json"])

  defp shape_definition_path(opts, shape_handle),
    do: Path.join([metadata_dir_path(opts, shape_handle), "shape_definition.json"])

  defp metadata_dir_path(%{base_path: base_path}, shape_handle),
    do: Path.join([base_path, shape_handle, "metadata"])

  defp snapshot_chunk_path(%FS{log_dir: log_dir}, chunk_number)
       when is_integer(chunk_number) and chunk_number >= 0 do
    Path.join([log_dir, "snapshot_chunk.#{chunk_number}.jsonl"])
  end

  defp log_path(%FS{log_dir: log_dir}), do: Path.join([log_dir, "log.bin"])
  defp chunk_index_path(%FS{log_dir: log_dir}), do: Path.join([log_dir, "chunk_index.bin"])

  # @special_keys [:shape_definition, :latest_offset]

  # Write/read helpers
  defp write_metadata(%FS{metadata_dir: dir}, key, value) do
    to_write =
      case read(Path.join([dir, "metadata.bin"])) do
        {:ok, data} ->
          data
          |> :erlang.binary_to_term()
          |> Map.put(key, value)
          |> :erlang.term_to_binary()

        {:error, :enoent} ->
          :erlang.term_to_binary(%{key => value})

        {:error, reason} ->
          raise Storage.Error, message: "Failed to write metadata: #{inspect(reason)}"
      end

    with :ok <- write(Path.join([dir, "metadata.bin.tmp"]), to_write, [:exclusive]),
         :ok <- rename!(Path.join([dir, "metadata.bin.tmp"]), Path.join([dir, "metadata.bin"])) do
      :ok
    end
  end

  defp read_metadata(%FS{metadata_dir: dir}, key) do
    case read(Path.join([dir, "metadata.bin"])) do
      {:ok, data} ->
        data
        |> :erlang.binary_to_term()
        |> Map.get(key)

      {:error, :enoent} ->
        nil

      {:error, reason} ->
        raise Storage.Error, message: "Failed to read metadata: #{inspect(reason)}"
    end
  end

  defp open_snapshot_chunk_to_write(opts, chunk_number) do
    Logger.debug("Opening snapshot chunk #{chunk_number} for writing",
      shape_handle: opts.shape_handle,
      stack_id: opts.stack_id
    )

    File.open!(snapshot_chunk_path(opts, chunk_number), [:write, :raw])
  end

  # File system helpers, to be optimised later
  defp rm_rf(path), do: File.rm_rf!(path)
  defp mkdir_p(path), do: File.mkdir_p!(path)
  defp exists?(path), do: File.exists?(path, [:raw])
  defp read(path), do: File.open(path, [:read, :raw], &IO.binread(&1, :eof))
  defp write(path, data, opts \\ []), do: File.write(path, data, opts ++ [:raw])
  defp rename!(path, new_path), do: File.rename!(path, new_path)

  defp file_size(path) do
    with {:ok, info} <- :prim_file.read_file_info(path) do
      {:ok, FileInfo.file_info(info, :size)}
    end
  end

  defp file_size_if_exists(path) do
    case file_size(path) do
      {:ok, result} -> result
      {:error, :enoent} -> 0
    end
  end

  defp close_all_files(tuple_with_files) do
    tuple_with_files
    |> Tuple.to_list()
    |> Enum.each(fn file ->
      if is_tuple(file) and elem(file, 0) == :file_descriptor do
        File.close(file)
      end
    end)
  end
end
