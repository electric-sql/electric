defmodule Electric.TenantSupervisor do
  @moduledoc """
  Responsible for managing tenant processes
  """
  use DynamicSupervisor

  alias Electric.Tenant

  require Logger

  def start_link(opts) do
    DynamicSupervisor.start_link(__MODULE__, [], name: __MODULE__)
  end

  def start_tenant(opts) do
    stack_id = opts[:stack_id]
    Logger.debug(fn -> "Starting tenant for #{stack_id}" end)
    name = Electric.ProcessRegistry.name(stack_id, Electric.Supervisor)

    DynamicSupervisor.start_child(
      __MODULE__,
      {Electric.Supervisor, opts |> Keyword.put_new(:name, name)}
    )
  end

  @doc """
  Stops all tenant processes.
  """
  @spec stop_tenant(Keyword.t()) :: :ok
  def stop_tenant(opts) do
    name = Electric.ProcessRegistry.name(opts[:stack_id], Electric.Supervisor)
    sup = Access.get(opts, :name, name)
    :ok = Supervisor.stop(sup)
  end

  @impl true
  def init(_opts) do
    Logger.debug(fn -> "Starting #{__MODULE__}" end)
    DynamicSupervisor.init(strategy: :one_for_one)
  end

  defp name(opts) do
    stack_id = Access.fetch!(opts, :stack_id)
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end
end
