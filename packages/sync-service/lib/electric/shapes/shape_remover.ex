defmodule Electric.Shapes.ShapeRemover do
  @moduledoc """
  This module is responsible for removing shapes from the system.

  Any processes specific to a shape should register themselves with this module
  by calling `register_shape_process/2` so that in the event of an error in that process
  the shape can be removed from the system.
  """
  use GenServer,
    # If this process is restarted it will no longer be monitoring the registered shape processes,
    # so set it to `:temporary` so it doesn't restart.
    restart: :temporary,
    # Set this as significant so that when ShapeRemover stops the whole Consumer.Supervisor will stop.
    significant: true

  require Logger

  alias Electric.ProcessRegistry
  alias Electric.ShapeCache.Storage

  @non_error_exit_reasons [:normal, :shutdown, :killed]

  def name(%{stack_id: stack_id, shape_handle: shape_handle}) do
    name(stack_id, shape_handle)
  end

  def name(stack_id, shape_handle) when is_binary(shape_handle) do
    ProcessRegistry.name(stack_id, __MODULE__, shape_handle)
  end

  def start_link(config) when is_map(config) do
    GenServer.start_link(__MODULE__, config, name: name(config))
  end

  def init(config) do
    Process.flag(:trap_exit, true)

    {:ok,
     %{
       storage: config.storage,
       shape_status: config.shape_status,
       shape_handle: config.shape_handle,
       remove_shape: false
     }}
  end

  def register_shape_process(server, pid) do
    GenServer.call(server, {:register_shape_process, pid})
  end

  def request_shape_removal(server) do
    GenServer.call(server, :request_shape_removal)
  end

  def handle_call(:request_shape_removal, _from, state) do
    {:reply, :ok, %{state | remove_shape: true}}
  end

  def handle_call({:register_shape_process, pid}, _from, state) do
    Process.monitor(pid)
    {:reply, :ok, state}
  end

  def handle_info({:DOWN, _ref, :process, _pid, reason}, state)
      when reason in @non_error_exit_reasons do
    {:noreply, state}
  end

  def handle_info({:DOWN, _ref, :process, _pid, _reason}, state) do
    {:noreply, %{state | remove_shape: true}}
  end

  def terminate(_reason, %{remove_shape: true} = state) do
    remove_shape(state)
    {:ok, state}
  end

  def terminate(_reason, %{remove_shape: false} = state) do
    # TODO: Should we also remove the shape if the reason is an error?
    {:ok, state}
  end

  defp remove_shape(%{shape_status: {shape_status, shape_status_state}} = state) do
    shape_status.remove_shape(shape_status_state, state.shape_handle)

    try do
      Storage.cleanup!(state.storage)
    rescue
      error ->
        Logger.error("Error removing shape from file system: #{inspect(error)}")
    catch
      :exit, reason ->
        Logger.error("Error removing shape from file system: :exit, #{inspect(reason)}")
    end
  end
end
