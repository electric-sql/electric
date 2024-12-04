defmodule Electric.Client.Fetch.Monitor do
  @moduledoc false

  # Companion process that registers processes listening for the result of a
  # given client request.
  #
  # Separates the list of subscribers from the actual request process so that
  # if the request process crashes the list of subscribers is retained and also
  # so that registering subscribers can happen while the request process is
  # blocked performing it's actual HTTP request.

  use GenServer

  require Logger

  def name(request_id) do
    {:via, Registry, {Electric.Client.Registry, {__MODULE__, request_id}}}
  end

  def child_spec(request_id) do
    %{
      id: {__MODULE__, request_id},
      start: {__MODULE__, :start_link, [request_id]},
      restart: :transient,
      type: :worker
    }
  end

  def start_link(request_id) do
    GenServer.start_link(__MODULE__, request_id, name: name(request_id))
  end

  def register(monitor_pid, listener_pid) do
    GenServer.call(monitor_pid, {:register, listener_pid})
  end

  def wait(ref) do
    receive do
      {:response, ^ref, response} -> response
    end
  end

  def reply(pid, response) when is_pid(pid) do
    GenServer.call(pid, {:reply, response})
  end

  @impl true
  def init(request_id) do
    Process.flag(:trap_exit, true)

    state = %{
      request_id: request_id,
      subscribers: []
    }

    {:ok, state}
  end

  @impl true
  def handle_call({:register, listener_pid}, _from, state) do
    ref = Process.monitor(listener_pid)

    Logger.debug(
      fn -> "Registering listener pid #{inspect(listener_pid)}" end,
      request_id: state.request_id
    )

    state = Map.update!(state, :subscribers, &[{listener_pid, ref} | &1])

    {:reply, ref, state}
  end

  def handle_call({:reply, response}, _from, state) do
    case response do
      %{status: status} ->
        Logger.debug(
          fn ->
            "Returning response #{status}"
          end,
          request_id: state.request_id
        )

      {:error, %{status: _} = response} ->
        Logger.warning(
          fn ->
            "Request failed: #{inspect(response)}"
          end,
          request_id: state.request_id
        )

      {:error, reason} ->
        Logger.error(
          fn ->
            "Request failed: #{inspect(reason)}"
          end,
          request_id: state.request_id
        )
    end

    for {pid, ref} <- state.subscribers do
      send(pid, {:response, ref, response})
    end

    {:stop, :normal, :ok, state}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, pid, reason}, state) do
    Logger.debug(fn ->
      [
        message:
          "Listener #{inspect(pid)} exited with reason #{inspect(reason)}. Removing from subscribers",
        request_id: state.request_id
      ]
    end)

    state =
      Map.update!(state, :subscribers, fn subscribers ->
        Enum.reject(subscribers, &(&1 == {pid, ref}))
      end)

    {:noreply, state}
  end

  def handle_info({:EXIT, pid, reason}, state) do
    Logger.debug(fn ->
      "Request process #{inspect(pid)} exited with reason #{inspect(reason)} before issuing a reply. Using reason as an error and exiting."
    end)

    for {pid, ref} <- state.subscribers do
      send(pid, {:response, ref, {:error, reason}})
    end

    {:stop, :normal, state}
  end
end
