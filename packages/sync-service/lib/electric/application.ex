defmodule Electric.Application do
  use Application
  require Config

  @process_registry_name Electric.Registry.Processes

  @spec process_name(atom(), String.t(), atom()) :: {:via, atom(), atom()}
  def process_name(electric_instance_id, tenant_id, module) when is_atom(module) do
    {:via, Registry, {@process_registry_name, {module, electric_instance_id, tenant_id}}}
  end

  @spec process_name(atom(), String.t(), atom(), term()) :: {:via, atom(), {atom(), term()}}
  def process_name(electric_instance_id, tenant_id, module, id) when is_atom(module) do
    {:via, Registry, {@process_registry_name, {module, electric_instance_id, tenant_id, id}}}
  end

  @impl true
  def start(_type, _args) do
    :erlang.system_flag(:backtrace_depth, 50)

    {storage_module, storage_opts} = Application.fetch_env!(:electric, :storage)

    with {:ok, storage_opts} <- storage_module.shared_opts(storage_opts) do
      storage = {storage_module, storage_opts}

      core_processes = [
        {Registry,
         name: @process_registry_name, keys: :unique, partitions: System.schedulers_online()},
        Electric.TenantManager
      ]

      per_env_processes =
        if Application.fetch_env!(:electric, :environment) != :test do
          [
            Electric.Telemetry,
            {Bandit,
             plug:
               {Electric.Plug.Router, storage: storage, tenant_manager: Electric.TenantManager},
             port: Application.fetch_env!(:electric, :service_port),
             thousand_island_options: http_listener_options()}
          ]
          |> add_prometheus_router(Application.fetch_env!(:electric, :prometheus_port))
        else
          []
        end

      res =
        Supervisor.start_link(core_processes ++ per_env_processes,
          strategy: :one_for_one,
          name: Electric.Supervisor
        )

      if Application.get_env(:electric, :test_mode, false) do
        test_tenant = Application.fetch_env!(:electric, :test_tenant)
        config = Application.fetch_env!(:electric, :connection_opts)
        Electric.TenantManager.create_tenant(test_tenant, config)
      end

      res
    end
  end

  defp add_prometheus_router(children, nil), do: children

  defp add_prometheus_router(children, port) do
    children ++
      [
        {
          Bandit,
          plug: {Electric.Plug.UtilityRouter, []},
          port: port,
          thousand_island_options: http_listener_options()
        }
      ]
  end

  defp http_listener_options do
    if Application.get_env(:electric, :listen_on_ipv6?, false) do
      [transport_options: [:inet6]]
    else
      []
    end
  end
end
