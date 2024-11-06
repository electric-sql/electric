defmodule Electric.TenantSupervisor do
  @moduledoc """
  Responsible for managing tenant processes
  """
  use DynamicSupervisor

  alias Electric.Tenant

  require Logger

  def start_link(opts) do
    DynamicSupervisor.start_link(__MODULE__, [], name: name(opts))
  end

  def start_tenant(opts) do
    Logger.debug(fn -> "Starting tenant for #{Access.fetch!(opts, :tenant_id)}" end)
    DynamicSupervisor.start_child(name(opts), {Tenant.Supervisor, opts})
  end

  @doc """
  Stops all tenant processes.
  """
  @spec stop_tenant(Keyword.t()) :: :ok
  def stop_tenant(opts) do
    sup = Tenant.Supervisor.name(opts)
    :ok = Supervisor.stop(sup)
  end

  @impl true
  def init(_opts) do
    Logger.debug(fn -> "Starting #{__MODULE__}" end)
    DynamicSupervisor.init(strategy: :one_for_one)
  end

  defp name(opts) do
    electric_instance_id = Access.fetch!(opts, :electric_instance_id)
    Electric.Application.process_name(electric_instance_id, __MODULE__)
  end
end
