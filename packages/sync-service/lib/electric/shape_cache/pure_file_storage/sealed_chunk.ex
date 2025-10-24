defmodule Electric.ShapeCache.PureFileStorage.SealedChunk do
  @moduledoc """
  Manages sealed chunks - immutable, pre-rendered JSON array files for efficient sendfile() serving.

  When a chunk is finalized (reaches size limit or snapshot completes), this module:
  1. Renders all entries in the chunk as a valid JSON array
  2. Writes to disk as chunks/{seq}.{start_offset}.{end_offset}.json
  3. Returns metadata (path, byte length, offsets) for fast serving

  These sealed chunks enable zero-copy sendfile() for aligned requests.
  """

  alias Electric.ShapeCache.PureFileStorage.LogFile
  alias Electric.Replication.LogOffset

  require Logger

  @type chunk_info :: %{
          path: Path.t(),
          byte_len: non_neg_integer(),
          start_offset: LogOffset.t(),
          end_offset: LogOffset.t(),
          chunk_seq: non_neg_integer()
        }

  @doc """
  Seals a chunk by rendering it as a JSON array file.

  Takes the log file handle, chunk boundaries, and writes a pre-rendered JSON array
  to disk. This file can later be served via sendfile() for efficient zero-copy transmission.

  ## Parameters
    - log_handle: Open log file handle
    - chunk_seq: Sequential chunk number (0, 1, 2, ...)
    - start_offset: First offset in the chunk
    - end_offset: Last offset in the chunk (inclusive)
    - start_pos: Byte position in log file where chunk starts
    - end_pos: Byte position in log file where chunk ends
    - shape_dir: Base directory for the shape

  ## Returns
    - {:ok, chunk_info} with file path, size, and offsets
    - {:error, reason} if sealing fails
  """
  @spec seal_chunk(
          log_handle :: File.io_device(),
          chunk_seq :: non_neg_integer(),
          start_offset :: LogOffset.t(),
          end_offset :: LogOffset.t(),
          start_pos :: non_neg_integer(),
          end_pos :: non_neg_integer(),
          shape_dir :: Path.t()
        ) :: {:ok, chunk_info()} | {:error, term()}
  def seal_chunk(log_handle, chunk_seq, start_offset, end_offset, start_pos, end_pos, shape_dir) do
    chunks_dir = Path.join(shape_dir, "chunks")
    File.mkdir_p!(chunks_dir)

    chunk_filename =
      "#{String.pad_leading(to_string(chunk_seq), 6, "0")}.#{LogOffset.to_tuple(start_offset) |> offset_to_string()}.#{LogOffset.to_tuple(end_offset) |> offset_to_string()}.json"

    chunk_path = Path.join(chunks_dir, chunk_filename)
    temp_path = chunk_path <> ".tmp"

    try do
      # Read the chunk from the log file
      :file.position(log_handle, start_pos)
      chunk_bytes = end_pos - start_pos
      {:ok, data} = :file.read(log_handle, chunk_bytes)

      # Parse entries and render as JSON array
      entries = parse_log_entries(data, [])

      # Write JSON array to temporary file
      File.open!(temp_path, [:write, :binary], fn file ->
        IO.write(file, "[")

        entries
        |> Enum.intersperse(",")
        |> Enum.each(fn
          "," -> IO.write(file, ",")
          entry -> IO.write(file, entry)
        end)

        IO.write(file, "]")
      end)

      # Get file size
      %{size: byte_len} = File.stat!(temp_path)

      # Atomically move temp file to final location
      File.rename!(temp_path, chunk_path)

      Logger.debug(
        "Sealed chunk #{chunk_seq}: #{byte_len} bytes, offsets #{inspect(start_offset)}..#{inspect(end_offset)}"
      )

      {:ok,
       %{
         path: chunk_path,
         byte_len: byte_len,
         start_offset: start_offset,
         end_offset: end_offset,
         chunk_seq: chunk_seq
       }}
    rescue
      e ->
        # Clean up temp file on error
        File.rm(temp_path)
        Logger.error("Failed to seal chunk #{chunk_seq}: #{inspect(e)}")
        {:error, e}
    end
  end

  @doc """
  Parses log entries from binary data and returns them as JSON strings.

  Each entry is already in JSON format in the log file, so we extract the JSON
  portions and return them as strings ready for array serialization.
  """
  defp parse_log_entries(<<>>, acc), do: Enum.reverse(acc)

  defp parse_log_entries(data, acc) do
    case LogFile.parse_entry(data) do
      {entry, rest} ->
        # Extract JSON from the entry
        json = entry.json
        parse_log_entries(rest, [json | acc])

      :error ->
        # Malformed entry or end of data
        Enum.reverse(acc)
    end
  end

  @doc """
  Checks if a sealed chunk file exists for the given parameters.
  """
  @spec chunk_exists?(
          shape_dir :: Path.t(),
          chunk_seq :: non_neg_integer(),
          start_offset :: LogOffset.t(),
          end_offset :: LogOffset.t()
        ) :: boolean()
  def chunk_exists?(shape_dir, chunk_seq, start_offset, end_offset) do
    chunk_path = get_chunk_path(shape_dir, chunk_seq, start_offset, end_offset)
    File.exists?(chunk_path)
  end

  @doc """
  Gets the file path for a sealed chunk.
  """
  @spec get_chunk_path(
          shape_dir :: Path.t(),
          chunk_seq :: non_neg_integer(),
          start_offset :: LogOffset.t(),
          end_offset :: LogOffset.t()
        ) :: Path.t()
  def get_chunk_path(shape_dir, chunk_seq, start_offset, end_offset) do
    chunks_dir = Path.join(shape_dir, "chunks")

    chunk_filename =
      "#{String.pad_leading(to_string(chunk_seq), 6, "0")}.#{LogOffset.to_tuple(start_offset) |> offset_to_string()}.#{LogOffset.to_tuple(end_offset) |> offset_to_string()}.json"

    Path.join(chunks_dir, chunk_filename)
  end

  @doc """
  Loads metadata for a sealed chunk.
  """
  @spec get_chunk_info(
          shape_dir :: Path.t(),
          chunk_seq :: non_neg_integer(),
          start_offset :: LogOffset.t(),
          end_offset :: LogOffset.t()
        ) :: {:ok, chunk_info()} | {:error, :not_found}
  def get_chunk_info(shape_dir, chunk_seq, start_offset, end_offset) do
    chunk_path = get_chunk_path(shape_dir, chunk_seq, start_offset, end_offset)

    case File.stat(chunk_path) do
      {:ok, %{size: byte_len}} ->
        {:ok,
         %{
           path: chunk_path,
           byte_len: byte_len,
           start_offset: start_offset,
           end_offset: end_offset,
           chunk_seq: chunk_seq
         }}

      {:error, _} ->
        {:error, :not_found}
    end
  end

  @doc """
  Cleans up sealed chunk files for a shape.
  """
  @spec cleanup_chunks(shape_dir :: Path.t()) :: :ok
  def cleanup_chunks(shape_dir) do
    chunks_dir = Path.join(shape_dir, "chunks")

    if File.exists?(chunks_dir) do
      File.rm_rf!(chunks_dir)
    end

    :ok
  end

  # Helper to convert offset tuple to string for filenames
  defp offset_to_string({tx, op}), do: "#{tx}_#{op}"
end
