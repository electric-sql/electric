defmodule Electric.Client.Fetch.Request do
  use GenServer

  alias Electric.Client.Fetch
  alias Electric.Client.Offset
  alias Electric.Client.ShapeDefinition

  require Logger

  defstruct [
    :base_url,
    :shape_id,
    :live,
    :shape,
    update_mode: :modified,
    method: :get,
    offset: Offset.before_all()
  ]

  @type t :: %__MODULE__{
          method: :get | :head,
          base_url: String.t(),
          offset: Electric.Client.Offset.t(),
          shape_id: Electric.Client.shape_id() | nil,
          update_mode: Electric.Client.update_mode(),
          live: boolean(),
          shape: ShapeDefinition.t()
        }

  @doc false
  def name(request, fetcher) do
    request
    |> request_id(fetcher)
    |> name()
  end

  @doc false
  def name(request_id) do
    {:via, Registry, {Electric.Client.Registry, {__MODULE__, request_id}}}
  end

  defp request_id(%{base_url: base_url, shape_id: nil, shape: shape_definition}, {fetch_impl, _}) do
    {fetch_impl, base_url, shape_definition}
  end

  defp request_id(request, {fetch_impl, _}) do
    %{base_url: base_url, offset: offset, live: live, shape_id: shape_id} = request
    {fetch_impl, base_url, shape_id, Offset.to_tuple(offset), live}
  end

  @doc false
  def request(%__MODULE__{} = request, {_, _} = fetcher) do
    request_id = request_id(request, fetcher)

    # register this pid before making the request to avoid race conditions for
    # very fast responses
    {:ok, monitor_pid} = start_monitor(request_id)

    try do
      ref = Fetch.Monitor.register(monitor_pid, self())

      {:ok, _request_pid} = start_request(request_id, request, fetcher, monitor_pid)

      Fetch.Monitor.wait(ref)
    catch
      :exit, {reason, _} ->
        Logger.debug(fn ->
          "Request process ended with reason #{inspect(reason)} before we could register. Re-attempting."
        end)

        request(request, fetcher)
    end
  end

  defp start_request(request_id, request, fetcher, monitor_pid) do
    DynamicSupervisor.start_child(
      Electric.Client.RequestSupervisor,
      {__MODULE__, {request_id, request, fetcher, monitor_pid}}
    )
    |> return_existing()
  end

  defp start_monitor(request_id) do
    DynamicSupervisor.start_child(
      Electric.Client.RequestSupervisor,
      {Electric.Client.Fetch.Monitor, request_id}
    )
    |> return_existing()
  end

  defp return_existing({:ok, pid}), do: {:ok, pid}
  defp return_existing({:error, {:already_started, pid}}), do: {:ok, pid}
  defp return_existing(error), do: error

  @doc false
  def child_spec({request_id, _request, _fetcher, _monitor_pid} = args) do
    %{
      id: {__MODULE__, request_id},
      start: {__MODULE__, :start_link, [args]},
      restart: :transient,
      type: :worker
    }
  end

  @doc false
  def start_link({request_id, request, fetcher, monitor_pid}) do
    GenServer.start_link(__MODULE__, {request_id, request, fetcher, monitor_pid},
      name: name(request_id)
    )
  end

  @impl true
  def init({request_id, request, fetcher, monitor_pid}) do
    Logger.debug(fn ->
      "Starting request for #{inspect(request_id)}"
    end)

    state = %{
      request_id: request_id,
      request: request,
      fetcher: fetcher,
      monitor_pid: monitor_pid
    }

    {:ok, state, {:continue, :request}}
  end

  @impl true
  def handle_continue(:request, state) do
    %{fetcher: {module, opts}, request: request} = state

    case module.fetch(request, opts) do
      {:ok, %Fetch.Response{status: status} = response} when status in 200..299 ->
        reply(response, state)

      {:ok, %Fetch.Response{} = response} ->
        # Turn HTTP errors into errors
        reply({:error, response}, state)

      error ->
        reply(error, state)
    end

    {:stop, :normal, state}
  end

  defp reply(response, %{monitor_pid: monitor_pid}) do
    Fetch.Monitor.reply(monitor_pid, response)
  end
end
