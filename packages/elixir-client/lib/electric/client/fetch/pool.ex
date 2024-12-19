defmodule Electric.Client.Fetch.Pool do
  @moduledoc """
  Coaleses requests so that multiple client instances making the same
  (potentially long-polling) request will all use the same request process.
  """

  alias Electric.Client
  alias Electric.Client.Fetch

  require Logger

  @callback request(Client.t(), Fetch.Request.t(), opts :: Keyword.t()) ::
              Fetch.Response.t() | {:error, Fetch.Response.t() | term()}

  @behaviour __MODULE__

  @impl Electric.Client.Fetch.Pool
  def request(%Client{} = client, %Fetch.Request{} = request, opts) do
    request_id = request_id(client, request)

    # The monitor process is unique to the request and launches the actual
    # request as a linked process.
    #
    # This coalesces requests, so no matter how many simultaneous
    # clients we have, we only ever make one request to the backend.
    {:ok, monitor_pid} = start_monitor(request_id, request, client)

    try do
      ref = Fetch.Monitor.register(monitor_pid, self())

      Fetch.Monitor.wait(ref)
    catch
      :exit, {reason, _} ->
        Logger.debug(fn ->
          "Request process ended with reason #{inspect(reason)} before we could register. Re-attempting."
        end)

        request(client, request, opts)
    end
  end

  defp start_monitor(request_id, request, client) do
    DynamicSupervisor.start_child(
      Electric.Client.RequestSupervisor,
      {Electric.Client.Fetch.Monitor, {request_id, request, client}}
    )
    |> return_existing()
  end

  defp return_existing({:ok, pid}), do: {:ok, pid}
  defp return_existing({:error, {:already_started, pid}}), do: {:ok, pid}
  defp return_existing(error), do: error

  defp request_id(%Client{fetch: {fetch_impl, _}}, %Fetch.Request{} = request) do
    {
      fetch_impl,
      URI.to_string(request.endpoint),
      request.headers,
      Fetch.Request.params(request)
    }
  end
end
