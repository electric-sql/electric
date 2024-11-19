defmodule CloudElectric.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    {kv_module, kv_fun, kv_params} = Application.fetch_env!(:cloud_electric, :persistent_kv)
    persistent_kv = apply(kv_module, kv_fun, [kv_params])

    children = [
      CloudElectric.ProcessRegistry,
      CloudElectric.DynamicTenantSupervisor,
      {CloudElectric.TenantManager,
       long_poll_timeout: Application.fetch_env!(:cloud_electric, :long_poll_timeout),
       max_age: Application.fetch_env!(:cloud_electric, :cache_max_age),
       stale_age: Application.fetch_env!(:cloud_electric, :cache_stale_age),
       allow_shape_deletion: Application.fetch_env!(:cloud_electric, :allow_shape_deletion),
       persistent_kv: persistent_kv,
       storage: Application.fetch_env!(:cloud_electric, :storage),
       pool_opts: Application.fetch_env!(:cloud_electric, :pool_opts),
       control_plane: Application.fetch_env!(:cloud_electric, :control_plane)},
      {Bandit,
       port: Application.fetch_env!(:cloud_electric, :service_port),
       plug: CloudElectric.Plugs.Router,
       thousand_island_options: http_listener_options()}
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: CloudElectric.Supervisor]
    Supervisor.start_link(children, opts)
  end

  defp http_listener_options do
    if Application.get_env(:cloud_electric, :listen_on_ipv6?, false) do
      [transport_options: [:inet6]]
    else
      []
    end
  end
end
