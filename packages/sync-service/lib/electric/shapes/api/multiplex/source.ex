defmodule Electric.Shapes.Api.Multiplex.Source do
  @moduledoc false

  alias Electric.Shapes
  alias Electric.Shapes.Api

  @callback active?(Api.t(), term()) :: boolean()
  @callback lookup(Api.t(), Electric.shape_handle(), term()) ::
              {:ok, Electric.Replication.LogOffset.t()} | :not_found
  @callback subscribe(Api.t(), Electric.shape_handle(), reference(), term()) :: :ok
  @callback unsubscribe(Api.t(), Electric.shape_handle(), term()) :: :ok

  def active?(%Api{stack_id: stack_id}, _opts) do
    Electric.StatusMonitor.service_status(stack_id) == :active
  end

  def lookup(%Api{stack_id: stack_id}, handle, _opts) do
    with {:ok, latest_offset} <- Shapes.fetch_latest_offset(stack_id, handle) do
      {:ok, latest_offset}
    else
      _ -> :not_found
    end
  end

  def subscribe(%Api{stack_id: stack_id}, handle, ref, _opts) do
    ^ref = Electric.StackSupervisor.subscribe_to_shape_events(stack_id, handle, ref)
    :ok
  end

  def unsubscribe(%Api{stack_id: stack_id}, handle, _opts) do
    registry = Electric.StackSupervisor.registry_name(stack_id)

    if GenServer.whereis(registry) != nil do
      Registry.unregister(registry, handle)
    end

    :ok
  end
end
