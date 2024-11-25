defmodule Electric.Client.Fetch.Mint do
  alias Electric.Client
  alias Electric.Client.Fetch
  alias Electric.Client.Fetch.Mint.Connection

  @behaviour Electric.Client.Fetch.Pool
  @behaviour Electric.Client.Fetch

  def client(attrs) do
    Client.new(
      Keyword.merge(attrs,
        pool: {__MODULE__, []},
        fetch: {__MODULE__, []}
      )
    )
  end

  @impl Electric.Client.Fetch.Pool
  def request(%Client{} = client, %Fetch.Request{} = request, _opts) do
    %{fetch: {fetcher, fetcher_opts}} = client
    authenticated_request = Client.authenticate_request(client, request)

    case fetcher.fetch(authenticated_request, fetcher_opts) do
      %Fetch.Response{status: status} = response when status in 200..299 ->
        response

      %Fetch.Response{} = response ->
        {:error, response}

      error ->
        error
    end
  end

  @impl Electric.Client.Fetch
  def fetch(%Fetch.Request{} = request, opts) do
    with {:ok, conn} <- start_connection(request) do
      Connection.fetch(conn, request, opts)
    end
  end

  defp start_connection(%Fetch.Request{stream_id: stream_id} = _request) do
    DynamicSupervisor.start_child(
      Electric.Client.RequestSupervisor,
      {Electric.Client.Fetch.Mint.Connection, stream_id}
    )
    |> return_existing()
  end

  defp return_existing({:ok, pid}), do: {:ok, pid}
  defp return_existing({:error, {:already_started, pid}}), do: {:ok, pid}
  defp return_existing(error), do: error
end
