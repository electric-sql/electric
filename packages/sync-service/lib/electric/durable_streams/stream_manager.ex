defmodule Electric.DurableStreams.StreamManager do
  @moduledoc """
  Manages durable stream lifecycle — creating and deleting streams
  on the durable streams server.

  Each shape gets its own durable stream, created synchronously
  during shape initialization and deleted during shape cleanup.
  """

  require Logger

  @doc """
  Create a new durable stream for the given shape handle.

  Makes a synchronous HTTP PUT to the durable streams server.
  Returns `:ok` on success or `{:error, reason}` on failure.
  """
  @spec create_stream(Electric.shape_handle(), keyword()) :: :ok | {:error, term()}
  def create_stream(shape_handle, opts \\ []) do
    url = Keyword.fetch!(opts, :durable_streams_url)
    token = Keyword.fetch!(opts, :durable_streams_token)

    stream_url = "#{url}/#{shape_handle}"

    case Req.put(stream_url,
           headers: [
             {"authorization", "Bearer #{token}"},
             {"content-type", "application/json"}
           ],
           receive_timeout: 30_000
         ) do
      {:ok, %Req.Response{status: status}} when status in 200..299 ->
        Logger.info("Created durable stream for shape #{shape_handle}")
        :ok

      {:ok, %Req.Response{status: 409}} ->
        Logger.debug("Durable stream already exists for shape #{shape_handle}")
        :ok

      {:ok, %Req.Response{status: status, body: body}} ->
        Logger.error("Failed to create durable stream for #{shape_handle}: HTTP #{status} #{inspect(body)}")
        {:error, {:http_error, status}}

      {:error, reason} ->
        Logger.error("Failed to create durable stream for #{shape_handle}: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Delete a durable stream for the given shape handle.

  Called during shape cleanup. Non-fatal — logs errors but does not raise.
  """
  @spec delete_stream(Electric.shape_handle(), keyword()) :: :ok | {:error, term()}
  def delete_stream(shape_handle, opts \\ []) do
    url = Keyword.fetch!(opts, :durable_streams_url)
    token = Keyword.fetch!(opts, :durable_streams_token)

    stream_url = "#{url}/#{shape_handle}"

    case Req.delete(stream_url,
           headers: [{"authorization", "Bearer #{token}"}],
           receive_timeout: 30_000
         ) do
      {:ok, %Req.Response{status: status}} when status in 200..299 ->
        Logger.info("Deleted durable stream for shape #{shape_handle}")
        :ok

      {:ok, %Req.Response{status: 404}} ->
        Logger.debug("Durable stream for #{shape_handle} already deleted")
        :ok

      {:ok, %Req.Response{status: status, body: body}} ->
        Logger.warning("Failed to delete durable stream for #{shape_handle}: HTTP #{status} #{inspect(body)}")
        {:error, {:http_error, status}}

      {:error, reason} ->
        Logger.warning("Failed to delete durable stream for #{shape_handle}: #{inspect(reason)}")
        {:error, reason}
    end
  end
end
