defmodule CloudElectric.DynamicTenantSupervisor do
  @moduledoc """
  Responsible for managing tenant processes
  """
  use DynamicSupervisor

  alias Electric.Tenant

  require Logger

  def start_link(_opts) do
    DynamicSupervisor.start_link(__MODULE__, [], name: __MODULE__)
  end

  def start_tenant(opts) do
    tenant_id = opts[:tenant_id]
    Logger.debug(fn -> "Starting tenant for #{tenant_id}" end)
    name = CloudElectric.ProcessRegistry.name(Electric.StackSupervisor, tenant_id)

    DynamicSupervisor.start_child(
      __MODULE__,
      {Electric.StackSupervisor,
       opts
       |> Keyword.put_new(:name, name)
       |> Keyword.put_new(:stack_id, tenant_id)
       |> Keyword.delete(:tenant_id)}
    )
  end

  @doc """
  Stops all tenant processes.
  """
  @spec stop_tenant(Keyword.t()) :: :ok
  def stop_tenant(opts) do
    name = CloudElectric.ProcessRegistry.name(Electric.StackSupervisor, opts[:tenant_id])
    sup = Access.get(opts, :name, name)
    :ok = Supervisor.stop(sup)
  end

  @impl true
  def init(_opts) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end
end
