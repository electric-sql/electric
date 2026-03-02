defmodule Electric.Application do
  use Application
  require Logger

  @impl true
  def start(_type, _args) do
    supervisor_opts = [strategy: :one_for_one, name: Electric.Supervisor]

    if Application.get_env(:electric, :start_in_library_mode, true) do
      Supervisor.start_link(children_library(), supervisor_opts)
    else
      app_vsn = Application.spec(:electric, :vsn)
      Logger.notice("Starting ElectricSQL #{app_vsn}")

      Supervisor.start_link(
        children_application(),
        [auto_shutdown: :any_significant] ++ supervisor_opts
      )
    end
  end

  def children_library do
    [
      {Registry, name: Electric.stack_events_registry(), keys: :duplicate},
      Electric.AdmissionControl
    ]
  end

  # This is only called if :start_in_library_mode is false, which is basically
  # only for our own Docker image, using the files in `./config`.
  #
  # This should be the only place that actually reads from
  # `Application.get_env/2`, because it's the only context where the
  # `config/runtime.exs` is executed
  #
  # The root application supervisor starts the core service processes, such as the HTTP
  # server for the HTTP API and telemetry exporters, and a single StackSupervisor, basically
  # making the application run in a single-tenant mode where all API requests are forwarded
  # to that sole tenant.
  def children_application do
    :erlang.system_flag(:backtrace_depth, 50)

    Logger.add_handlers(:electric)

    if Code.ensure_loaded?(Electric.Telemetry.Sentry) do
      Electric.Telemetry.Sentry.add_logger_handler()
    end

    config = configuration()

    Enum.concat([
      children_library(),
      application_telemetry(config),
      [{Electric.StackSupervisor, Keyword.put(config, :name, Electric.StackSupervisor)}],
      api_server_children(config),
      prometheus_endpoint(Electric.Config.get_env(:prometheus_port))
    ])
  end

  @doc """
  Returns a configured Electric.Shapes.Api instance
  """
  def api(opts \\ []) do
    opts
    |> api_configuration()
    |> Electric.Shapes.Api.configure!()
  end

  @doc false
  # REQUIRED (but undocumented) public API for Phoenix.Sync
  def api_plug_opts(opts \\ []) do
    opts
    |> api_configuration()
    |> Electric.Shapes.Api.plug_opts()
  end

  # Gets a complete configuration for the `StackSupervisor` based on the passed opts
  # plus the application configuration and the defaults.
  # REQUIRED (but undocumented) public API for Phoenix.Sync
  @doc false
  def configuration(opts \\ []) do
    instance_id = Electric.Config.ensure_instance_id()

    core_config = core_configuration(opts)

    persistent_kv = Keyword.fetch!(core_config, :persistent_kv)
    installation_id = Electric.Config.persist_installation_id(persistent_kv, instance_id)

    replication_stream_id = get_env(opts, :replication_stream_id)

    publication_name =
      Keyword.get(opts, :publication_name, "electric_publication_#{replication_stream_id}")

    slot_temporary? = get_env(opts, :replication_slot_temporary?)
    slot_temporary_random_name? = get_env(opts, :replication_slot_temporary_random_name?)

    slot_name =
      if slot_temporary? and slot_temporary_random_name? do
        name = "electric_slot_#{Base.encode16(:crypto.strong_rand_bytes(16), case: :lower)}"

        Logger.warning(
          "Using a temporary replication slot with name: #{name}. This slot will be deleted on shutdown, so persistent storage should not outlive the Electric instance."
        )

        name
      else
        Keyword.get(opts, :slot_name, "electric_slot_#{replication_stream_id}")
      end

    replication_connection_opts = get_env!(opts, :replication_connection_opts)
    replication_idle_timeout = get_env(opts, :replication_idle_timeout)

    if replication_idle_timeout > 0 and
         replication_idle_timeout < Electric.Config.min_replication_idle_timeout() do
      raise "Invalid value for ELECTRIC_REPLICATION_IDLE_TIMEOUT: #{replication_idle_timeout}. " <>
              "The minimum supported timeout is #{Electric.Config.min_replication_idle_timeout_in_seconds()}sec."
    end

    Keyword.merge(
      core_config,
      connection_opts:
        get_env_lazy(opts, :query_connection_opts, fn -> replication_connection_opts end),
      replication_opts: [
        connection_opts: replication_connection_opts,
        publication_name: publication_name,
        slot_name: slot_name,
        slot_temporary?: get_env(opts, :replication_slot_temporary?),
        max_txn_size: get_env(opts, :max_txn_size),
        max_batch_size: get_env(opts, :max_batch_size),
        replication_idle_timeout: replication_idle_timeout
      ],
      pool_opts:
        get_env_lazy(opts, :pool_opts, fn -> [pool_size: get_env(opts, :db_pool_size)] end),
      chunk_bytes_threshold: get_env(opts, :chunk_bytes_threshold),
      telemetry_opts:
        telemetry_opts([instance_id: instance_id, installation_id: installation_id] ++ opts),
      max_shapes: get_env(opts, :max_shapes),
      tweaks: [
        publication_alter_debounce_ms: get_env(opts, :publication_alter_debounce_ms),
        registry_partitions: get_env(opts, :process_registry_partitions),
        publication_refresh_period: get_env(opts, :publication_refresh_period),
        schema_reconciler_period: get_env(opts, :schema_reconciler_period),
        cleanup_interval_ms: get_env(opts, :cleanup_interval_ms),
        shape_hibernate_after: get_env(opts, :shape_hibernate_after),
        shape_enable_suspend?: get_env(opts, :shape_enable_suspend?),
        conn_max_requests: get_env(opts, :conn_max_requests),
        process_spawn_opts: get_env(opts, :process_spawn_opts)
      ],
      manual_table_publishing?: get_env(opts, :manual_table_publishing?),
      shape_db_opts: [
        exclusive_mode: get_env(opts, :shape_db_exclusive_mode),
        storage_dir:
          get_env_lazy(opts, :shape_db_storage_dir, fn ->
            get_env(opts, :storage_dir)
          end),
        synchronous: get_env(opts, :shape_db_synchronous),
        cache_size: get_env(opts, :shape_db_cache_size),
        enable_memory_stats?: get_env(opts, :shape_db_enable_memory_stats)
      ]
    )
  end

  # Gets the API-side configuration based on the same opts + application config
  # used for `configuration/1`
  defp api_configuration(opts) do
    opts
    |> core_configuration()
    |> Electric.StackSupervisor.build_shared_opts()
    |> Keyword.merge(
      long_poll_timeout: get_env(opts, :long_poll_timeout),
      max_age: get_env(opts, :cache_max_age),
      stale_age: get_env(opts, :cache_stale_age),
      allow_shape_deletion: get_env(opts, :allow_shape_deletion?),
      stack_ready_timeout: get_env(opts, :stack_ready_timeout),
      send_cache_headers?: get_env(opts, :send_cache_headers?),
      max_concurrent_requests: get_env(opts, :max_concurrent_requests),
      secret: Application.get_env(:electric, :secret)
    )
    |> Keyword.merge(Keyword.take(opts, [:encoder, :inspector]))
  end

  defp core_configuration(opts) do
    # We have "instance id" identifier as the node ID, however that's generated every runtime,
    # so isn't stable across restarts. Our storages however scope themselves based on this stack ID
    # so we're just hardcoding it here.
    stack_id = get_env(opts, :stack_id, :provided_database_id)

    # Use this lazy-eval technique rather than just rely on the Electric.Config.Defaults
    # system so that a `storage_dir` passed in opts can configure the root path
    # for both the file storage and persistent kv. This means we can allow the
    # user to easily set the root path for the electric data without having to
    # get into the nitty-gritty of full storage and persistent kv
    # configuration.

    persistent_kv =
      case get_env_lazy(opts, :persistent_kv, fn ->
             Electric.Config.Defaults.persistent_kv(Keyword.take(opts, [:storage_dir]))
           end) do
        {kv_module, kv_fun, kv_params} ->
          apply(kv_module, kv_fun, [kv_params])

        %_{} = persistent_kv ->
          persistent_kv
      end

    storage =
      get_env_lazy(opts, :storage, fn ->
        Electric.Config.Defaults.storage(Keyword.take(opts, [:storage_dir]))
      end)
      |> case do
        {Electric.ShapeCache.FileStorage, _opts} ->
          raise RuntimeError,
            message:
              "#{inspect(Electric.ShapeCache.FileStorage)} storage is deprecated. Please change to #{inspect(Electric.ShapeCache.PureFileStorage)}"

        storage ->
          storage
      end

    [
      stack_id: stack_id,
      stack_events_registry: Electric.stack_events_registry(),
      persistent_kv: persistent_kv,
      storage_dir: get_env(opts, :storage_dir),
      storage: storage,
      feature_flags: get_env(opts, :feature_flags),
      max_concurrent_requests: get_env(opts, :max_concurrent_requests)
    ]
  end

  defp get_env(opts, key) do
    get_env(opts, key, key)
  end

  defp get_env(opts, overrides_key, config_key) do
    Keyword.get_lazy(opts, overrides_key, fn -> Electric.Config.get_env(config_key) end)
  end

  defp get_env!(opts, key) do
    Keyword.get_lazy(opts, key, fn ->
      Electric.Config.fetch_env!(key)
    end)
  end

  defp get_env_lazy(opts, key, fun) do
    Keyword.get_lazy(opts, key, fn ->
      Electric.Config.get_env_lazy(key, fun)
    end)
  end

  defp application_telemetry(config) do
    if Code.ensure_loaded?(ElectricTelemetry.ApplicationTelemetry) do
      [{ElectricTelemetry.ApplicationTelemetry, Keyword.fetch!(config, :telemetry_opts)}]
    else
      []
    end
  end

  defp prometheus_endpoint(nil), do: []

  defp prometheus_endpoint(port) do
    [
      {
        Bandit,
        plug: {Electric.Plug.UtilityRouter, []},
        port: port,
        thousand_island_options: thousand_island_options(num_acceptors: 1)
      }
    ]
  end

  @doc false
  # REQUIRED (but undocumented) public API for Phoenix.Sync
  def api_server do
    api_server(Bandit, [])
  end

  @doc false
  def api_server(opts) when is_list(opts) do
    api_server(Bandit, opts)
  end

  @doc false
  def api_server(server, opts \\ [])

  def api_server(Bandit, opts) do
    router_opts = api_plug_opts(opts)
    tweaks = Keyword.get(opts, :tweaks, [])

    ti_opts =
      if num_acceptors = get_env(opts, :http_api_num_acceptors) do
        [num_acceptors: num_acceptors]
      else
        []
      end

    shared_http_opts =
      if max_requests = Keyword.get(tweaks, :conn_max_requests) do
        [max_requests: max_requests]
      else
        []
      end

    [
      {Bandit,
       [
         plug: {Electric.Plug.Router, router_opts},
         port: get_env(opts, :service_port),
         http_1_options: shared_http_opts,
         http_2_options: shared_http_opts,
         thousand_island_options: thousand_island_options(opts ++ ti_opts)
       ]}
    ]
  end

  def api_server(Plug.Cowboy, opts) do
    router_opts = api_plug_opts(opts)

    [
      {Plug.Cowboy,
       scheme: :http, plug: {Electric.Plug.Router, router_opts}, options: cowboy_options(opts)}
    ]
  end

  defp api_server_children(opts) do
    if get_env(opts, :enable_http_api) do
      api_server(opts)
    else
      []
    end
  end

  defp thousand_island_options(opts) do
    acceptor_opts = Keyword.take(opts, [:num_acceptors])

    send_opts =
      case get_env(opts, :tcp_send_timeout) do
        nil -> []
        send_timeout -> [send_timeout: send_timeout]
      end

    ipv6_opts =
      if get_env(opts, :listen_on_ipv6?) do
        [:inet6]
      else
        []
      end

    transport_opts = [transport_options: ipv6_opts ++ send_opts]

    acceptor_opts ++ transport_opts
  end

  defp cowboy_options(opts) do
    Enum.concat([
      if(get_env(opts, :listen_on_ipv6?), do: [:inet6], else: []),
      [port: get_env(opts, :service_port)]
    ])
  end

  defp telemetry_opts(opts) do
    [
      instance_id: Keyword.fetch!(opts, :instance_id),
      installation_id: Keyword.fetch!(opts, :installation_id),
      version: Electric.version(),
      intervals_and_thresholds:
        get_opts(opts,
          system_metrics_poll_interval: :system_metrics_poll_interval,
          long_gc_threshold: :telemetry_long_gc_threshold,
          long_schedule_threshold: :telemetry_long_schedule_threshold,
          long_message_queue_enable_threshold: :telemetry_long_message_queue_enable_threshold,
          long_message_queue_disable_threshold: :telemetry_long_message_queue_disable_threshold,
          top_process_count: :telemetry_top_process_count
        ),
      reporters: [
        statsd_host: get_env(opts, :telemetry_statsd_host),
        prometheus?: not is_nil(get_env(opts, :prometheus_port)),
        call_home_url:
          if(get_env(opts, :call_home_telemetry?), do: get_env(opts, :telemetry_url)),
        otel_metrics?: not is_nil(Application.get_env(:otel_metric_exporter, :otlp_endpoint))
      ],
      otel_opts: get_opts(opts, export_period: :otel_export_period)
    ]
  end

  defp get_opts(opts, mapping) do
    mapping
    |> Enum.map(fn {from, to} -> {from, get_opt(opts, to)} end)
    |> Enum.reject(fn {_k, v} -> is_nil(v) end)
  end

  defp get_opt(opts, key) do
    Keyword.get_lazy(opts, key, fn -> Application.get_env(:electric, key) end)
  end
end
