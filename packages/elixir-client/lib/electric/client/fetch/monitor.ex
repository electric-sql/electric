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

  alias Electric.Client.Fetch

  require Logger

  def name(request_id) do
    {:via, Registry, {Electric.Client.Registry, {__MODULE__, request_id}}}
  end

  def child_spec({request_id, _request, _client} = args) do
    %{
      id: {__MODULE__, request_id},
      start: {__MODULE__, :start_link, [args]},
      # don't restart on error because it would lose the subscriber list
      # we instead want the requesting processes to know about the failure
      restart: :temporary,
      type: :worker
    }
  end

  def start_link({request_id, request, client}) do
    GenServer.start_link(__MODULE__, {request_id, request, client}, name: name(request_id))
  end

  def register(monitor_pid, listener_pid) do
    # Register the calling pid with the monitor and the monitor with the
    # calling pid.
    #
    # If the calling pid goes away, then the monitor can remove it from its
    # subscribers list.
    #
    # If the monitor pid goes away before it's returned a response, then we
    # raise because it shouldn't happen
    caller_monitor_ref = Process.monitor(monitor_pid)
    monitor_caller_ref = GenServer.call(monitor_pid, {:register, listener_pid})
    {caller_monitor_ref, monitor_caller_ref}
  end

  def wait({caller_monitor_ref, monitor_caller_ref}) do
    receive do
      {:response, ^monitor_caller_ref, response} ->
        Process.demonitor(caller_monitor_ref, [:flush])
        response

      {:DOWN, ^caller_monitor_ref, :process, _pid, reason} ->
        raise Electric.Client.Error,
          message: "#{Fetch.Monitor} process died with reason #{inspect(reason)}"
    end
  end

  def reply(pid, response) when is_pid(pid) do
    GenServer.call(pid, {:reply, response})
  end

  @impl true
  def init({request_id, request, client}) do
    Process.flag(:trap_exit, true)

    state = %{
      request_id: request_id,
      subscribers: [],
      response: nil
    }

    {:ok, state, {:continue, {:start_request, request_id, request, client}}}
  end

  @impl true
  def handle_continue({:start_request, request_id, request, client}, state) do
    {:ok, _pid} = Fetch.Request.start_link({request_id, request, client, self()})

    {:noreply, state}
  end

  def handle_continue(:handle_response, %{subscribers: _, response: nil} = state) do
    {:noreply, state}
  end

  def handle_continue(:handle_response, %{subscribers: [], response: _} = state) do
    Logger.debug("Got response with no subscribers - deferring until subscribers are present")
    {:noreply, state}
  end

  def handle_continue(:handle_response, %{subscribers: subscribers, response: response} = state) do
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

    for {pid, ref} <- subscribers do
      send(pid, {:response, ref, response})
    end

    {:stop, {:shutdown, :normal}, state}
  end

  @impl true
  def handle_call({:register, listener_pid}, _from, state) do
    ref = Process.monitor(listener_pid)

    Logger.debug(
      fn -> "Registering listener pid #{inspect(listener_pid)}" end,
      request_id: state.request_id
    )

    state = Map.update!(state, :subscribers, &[{listener_pid, ref} | &1])

    {:reply, ref, state, {:continue, :handle_response}}
  end

  def handle_call({:reply, response}, _from, state) do
    {:reply, :ok, %{state | response: response}, {:continue, :handle_response}}
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

  def handle_info({:EXIT, pid, reason}, %{response: nil} = state) do
    Logger.debug(fn ->
      "Request process #{inspect(pid)} exited with reason #{inspect(reason)} before issuing a reply. Using reason as an error and exiting."
    end)

    for {pid, ref} <- state.subscribers do
      send(pid, {:response, ref, {:error, reason}})
    end

    {:stop, {:shutdown, :normal}, state}
  end

  def handle_info({:EXIT, _pid, _reason}, state) do
    {:noreply, state}
  end
end
