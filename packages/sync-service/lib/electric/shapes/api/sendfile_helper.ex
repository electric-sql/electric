defmodule Electric.Shapes.API.SendfileHelper do
  @moduledoc """
  Helpers for serving sealed chunks via sendfile() for zero-copy transmission.

  When a request is aligned to a chunk boundary and the chunk is sealed,
  we can serve it directly from the pre-rendered JSON array file using
  Plug.Conn.send_file/5, which delegates to the OS sendfile(2) syscall
  for efficient zero-copy transmission.
  """

  alias Electric.ShapeCache.PureFileStorage.SealedChunk
  alias Electric.Replication.LogOffset
  alias Electric.Telemetry
  alias Plug.Conn

  require Logger

  @min_sendfile_bytes 64 * 1024

  @doc """
  Attempts to serve a request using sendfile if the request is aligned to a sealed chunk.

  Returns:
  - {:ok, conn} if the request was served via sendfile
  - {:error, :not_aligned} if the request doesn't start at a chunk boundary
  - {:error, :not_sealed} if the chunk is not sealed yet
  - {:error, :too_small} if the chunk is too small to benefit from sendfile
  - {:error, :not_found} if the sealed chunk file doesn't exist
  """
  @spec try_serve_with_sendfile(
          conn :: Conn.t(),
          shape_dir :: Path.t(),
          chunk_seq :: non_neg_integer(),
          start_offset :: LogOffset.t(),
          end_offset :: LogOffset.t(),
          shape_handle :: binary()
        ) :: {:ok, Conn.t()} | {:error, term()}
  def try_serve_with_sendfile(conn, shape_dir, chunk_seq, start_offset, end_offset, shape_handle) do
    case SealedChunk.get_chunk_info(shape_dir, chunk_seq, start_offset, end_offset) do
      {:ok, chunk_info} ->
        if chunk_info.byte_len >= @min_sendfile_bytes do
          serve_sealed_chunk(conn, chunk_info, shape_handle)
        else
          {:error, :too_small}
        end

      {:error, :not_found} ->
        {:error, :not_found}
    end
  end

  defp serve_sealed_chunk(conn, chunk_info, shape_handle) do
    # Emit telemetry for sendfile usage
    start_time = System.monotonic_time()

    conn =
      conn
      |> Conn.put_resp_header("content-type", "application/json")
      |> Conn.put_resp_header(
        "electric-offset",
        LogOffset.to_tuple(chunk_info.end_offset) |> offset_to_string()
      )
      |> Conn.put_resp_header("content-length", to_string(chunk_info.byte_len))
      |> Conn.send_file(200, chunk_info.path, 0, chunk_info.byte_len)

    duration = System.monotonic_time() - start_time

    Telemetry.execute(
      [:electric, :sendfile, :serve],
      %{
        duration: duration,
        bytes: chunk_info.byte_len,
        chunk_seq: chunk_info.chunk_seq
      },
      %{
        shape_handle: shape_handle
      }
    )

    Logger.debug(
      "Served chunk #{chunk_info.chunk_seq} via sendfile: #{chunk_info.byte_len} bytes"
    )

    {:ok, conn}
  end

  defp offset_to_string({tx, op}), do: "#{tx}_#{op}"

  @doc """
  Checks if a request can potentially use sendfile based on offset alignment.

  This is a quick check before attempting to load chunk info.
  """
  @spec can_use_sendfile?(
          request_offset :: LogOffset.t(),
          chunk_boundaries :: [{LogOffset.t(), LogOffset.t()}]
        ) :: boolean()
  def can_use_sendfile?(request_offset, chunk_boundaries) do
    Enum.any?(chunk_boundaries, fn {start_offset, _end_offset} ->
      LogOffset.compare(request_offset, start_offset) == :eq
    end)
  end
end
