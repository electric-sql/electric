defmodule Electric.Client.Fetch.Request do
  use GenServer

  alias Electric.Client
  alias Electric.Client.Fetch
  alias Electric.Client.Offset
  alias Electric.Client.ShapeDefinition
  alias Electric.Client.Util

  require Logger

  defstruct [
    :stream_id,
    :endpoint,
    :shape_handle,
    :live,
    :shape,
    :next_cursor,
    replica: :default,
    method: :get,
    offset: Offset.before_all(),
    params: %{},
    headers: %{},
    authenticated: false
  ]

  @type params :: %{String.t() => String.t()}
  @type headers :: %{String.t() => [String.t()] | String.t()}

  fields = [
    stream_id: quote(do: term()),
    method: quote(do: :get | :head | :delete),
    endpoint: quote(do: URI.t()),
    offset: quote(do: Electric.Client.Offset.t()),
    shape_handle: quote(do: Electric.Client.shape_handle() | nil),
    replica: quote(do: Electric.Client.replica()),
    live: quote(do: boolean()),
    next_cursor: quote(do: Electric.Client.cursor()),
    shape: quote(do: ShapeDefinition.t()),
    params: quote(do: params()),
    headers: quote(do: headers())
  ]

  @type unauthenticated :: %__MODULE__{unquote_splicing(fields), authenticated: false}
  @type authenticated :: %__MODULE__{unquote_splicing(fields), authenticated: true}
  @type t :: unauthenticated() | authenticated()

  # the base url should come from the client
  attrs = Keyword.delete(fields, :endpoint)

  attr_types =
    attrs
    |> Enum.reduce(nil, fn
      {name, spec}, nil -> quote(do: unquote({name, spec}))
      {name, spec}, acc -> quote(do: unquote({name, spec}) | unquote(acc))
    end)

  @type attr :: unquote(attr_types)
  @type attrs :: [attr()] | %{unquote_splicing(attrs)}

  @doc false
  def name(request_id) do
    {:via, Registry, {Electric.Client.Registry, {__MODULE__, request_id}}}
  end

  @doc """
  Returns the URL for the Request.
  """
  @spec url(t()) :: binary()
  def url(%__MODULE__{} = request, opts \\ []) do
    request
    |> uri(opts)
    |> URI.to_string()
  end

  @doc """
  Returns the %URI{} for the Request.
  """
  @spec uri(t()) :: URI.t()
  def uri(%__MODULE__{} = request, opts \\ []) do
    %{endpoint: endpoint} = request

    if Keyword.get(opts, :query, true) do
      # Convert map to _ordered_ list of query parameters
      # to ensure consistent caching
      query =
        request
        |> params()
        |> Map.to_list()
        |> List.keysort(0)
        |> URI.encode_query(:rfc3986)

      %{endpoint | query: query}
    else
      endpoint
    end
  end

  @doc false
  @spec params(t()) :: params()
  def params(%__MODULE__{} = request) do
    %{
      shape: shape,
      replica: replica,
      live: live?,
      shape_handle: shape_handle,
      offset: %Offset{} = offset,
      next_cursor: cursor,
      params: params
    } = request

    (params || %{})
    |> Map.merge(ShapeDefinition.params(shape))
    |> Map.merge(%{"offset" => Offset.to_string(offset)})
    |> Util.map_put_if("replica", to_string(replica), replica != :default)
    |> Util.map_put_if("handle", shape_handle, is_binary(shape_handle))
    |> Util.map_put_if("live", "true", live?)
    |> Util.map_put_if("cursor", to_string(cursor), !is_nil(cursor))
  end

  @doc false
  def child_spec({request_id, _request, _client, _monitor_pid} = args) do
    %{
      id: {__MODULE__, request_id},
      start: {__MODULE__, :start_link, [args]},
      restart: :temporary,
      type: :worker
    }
  end

  @doc false
  def start_link({request_id, request, client, monitor_pid}) do
    GenServer.start_link(__MODULE__, {request_id, request, client, monitor_pid})
  end

  @impl true
  def init({request_id, request, client, monitor_pid}) do
    Logger.debug(fn ->
      "Starting request for #{inspect(request_id)}"
    end)

    state = %{
      request_id: request_id,
      request: request,
      client: client,
      monitor_pid: monitor_pid
    }

    {:ok, state, {:continue, :request}}
  end

  @impl true
  def handle_continue(:request, state) do
    %{client: client, request: request} = state
    %{fetch: {fetcher, fetcher_opts}} = client

    authenticated_request = Client.authenticate_request(client, request)

    try do
      case fetcher.fetch(authenticated_request, fetcher_opts) do
        {:ok, %Fetch.Response{status: status} = response} when status in 200..299 ->
          reply(response, state)

        {:ok, %Fetch.Response{} = response} ->
          # Turn HTTP errors into errors
          reply({:error, response}, state)

        error ->
          reply(error, state)
      end
    rescue
      error ->
        reply({:error, error}, state)
    end

    {:stop, :normal, state}
  end

  defp reply(response, %{monitor_pid: monitor_pid}) do
    Fetch.Monitor.reply(monitor_pid, response)
  end
end
