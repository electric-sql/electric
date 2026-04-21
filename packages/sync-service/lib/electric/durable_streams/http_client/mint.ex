defmodule Electric.DurableStreams.HttpClient.Mint do
  @moduledoc """
  Production HTTP/2 client backed by Mint.HTTP2.

  Vendored from durable-replication. Handles flow control windows
  for large bodies via streaming mode.
  """

  @behaviour Electric.DurableStreams.HttpClient

  @impl true
  def connect(uri, opts \\ []) do
    scheme = if uri.scheme == "https", do: :https, else: :http
    port = uri.port || if(scheme == :https, do: 443, else: 80)

    connect_opts =
      case Keyword.get(opts, :transport_opts) do
        nil -> []
        t when is_list(t) -> [transport_opts: t]
      end

    case Mint.HTTP2.connect(scheme, uri.host, port, connect_opts) do
      {:ok, conn} -> {:ok, conn}
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def request(conn, method, path, headers, body) do
    body_size = byte_size(body)
    conn_window = Mint.HTTP2.get_window_size(conn, :connection)
    stream_window = Mint.HTTP2.get_server_setting(conn, :initial_window_size) || 65_535

    cond do
      conn_window <= 0 ->
        {:error, conn, :window_exhausted}

      body_size <= min(conn_window, stream_window) ->
        case Mint.HTTP2.request(conn, method, path, headers, body) do
          {:ok, conn, ref} -> {:ok, conn, ref}
          {:error, conn, reason} -> {:error, conn, reason}
        end

      true ->
        case Mint.HTTP2.request(conn, method, path, headers, :stream) do
          {:ok, conn, ref} ->
            case send_body_chunks(conn, ref, body) do
              {:ok, conn} -> {:ok, conn, ref}
              {:partial, conn, remaining} -> {:partial, conn, ref, remaining}
              {:error, conn, reason} -> {:error, conn, reason}
            end

          {:error, conn, reason} ->
            {:error, conn, reason}
        end
    end
  end

  def resume_body(conn, ref, body) do
    case send_body_chunks(conn, ref, body) do
      {:ok, conn} -> {:ok, conn}
      {:partial, conn, remaining} -> {:partial, conn, ref, remaining}
      {:error, conn, reason} -> {:error, conn, reason}
    end
  end

  defp send_body_chunks(conn, ref, <<>>) do
    case Mint.HTTP2.stream_request_body(conn, ref, :eof) do
      {:ok, conn} -> {:ok, conn}
      {:error, conn, reason} -> {:error, conn, reason}
    end
  end

  defp send_body_chunks(conn, ref, body) do
    conn_window = Mint.HTTP2.get_window_size(conn, :connection)
    stream_window = Mint.HTTP2.get_window_size(conn, {:request, ref})
    max_chunk = min(conn_window, stream_window)

    if max_chunk <= 0 do
      {:partial, conn, body}
    else
      chunk_size = min(max_chunk, byte_size(body))
      <<chunk::binary-size(chunk_size), rest::binary>> = body

      case Mint.HTTP2.stream_request_body(conn, ref, chunk) do
        {:ok, conn} -> send_body_chunks(conn, ref, rest)
        {:error, conn, reason} -> {:error, conn, reason}
      end
    end
  end

  @impl true
  def stream(conn, message) do
    case Mint.HTTP2.stream(conn, message) do
      {:ok, conn, responses} -> {:ok, conn, responses}
      {:error, conn, reason, responses} -> {:error, conn, reason, responses}
      :unknown -> :unknown
    end
  end

  @impl true
  def close(conn) do
    Mint.HTTP2.close(conn)
    {:ok, conn}
  end
end
