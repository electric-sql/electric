defmodule Support.ComponentSetup do
  alias Electric.ShapeCache.FileStorage
  alias CloudElectric.TenantManager
  import ExUnit.Callbacks

  def with_tenant_supervisor(_ctx) do
    {:ok, pid} = CloudElectric.DynamicTenantSupervisor.start_link([])
    Process.unlink(pid)

    on_exit(fn ->
      DynamicSupervisor.stop(pid, :shutdown)
    end)

    %{tenant_supervisor: pid}
  end

  def with_tenant_manager(ctx) do
    {:ok, _} =
      TenantManager.start_link(
        name: :"TenantManager:#{ctx.test}",
        long_poll_timeout: 400,
        max_age: 1,
        stale_age: 1,
        allow_shape_deletion: true,
        persistent_kv: ctx.persistent_kv,
        storage: {FileStorage, storage_dir: ctx.tmp_dir},
        pool_opts: [pool_size: 2],
        stack_overrides: [tweaks: [notify_pid: self()]]
      )

    %{tenant_manager: :"TenantManager:#{ctx.test}"}
  end

  def with_persistent_kv(_ctx) do
    kv = %Electric.PersistentKV.Memory{
      parent: self(),
      pid: start_supervised!(Electric.PersistentKV.Memory, restart: :temporary)
    }

    %{persistent_kv: kv}
  end

  # def with_tenant_tables(ctx) do
  #   Electric.Tenant.Tables.init(ctx.electric_instance_id)
  #   %{tenant_tables_name: Electric.Tenant.Tables.name(ctx.electric_instance_id)}
  # end

  # def with_tenant_manager(ctx) do
  #   {:ok, _} =
  #     Electric.TenantSupervisor.start_link(electric_instance_id: ctx.electric_instance_id)

  #   opts = [
  #     app_config: ctx.app_config,
  #     electric_instance_id: ctx.electric_instance_id,
  #     tenant_tables_name: Electric.Tenant.Tables.name(ctx.electric_instance_id)
  #   ]

  #   {:ok, _} = Electric.TenantManager.start_link(opts)

  #   %{tenant_manager: Electric.TenantManager.name(opts)}
  # end

  # def with_tenant_id(_ctx) do
  #   %{tenant_id: "test_tenant"}
  # end

  # # This is a reduced version of the app config that the tenant manager can use to restore persisted tenants
  # def with_minimal_app_config(ctx) do
  #   %{
  #     app_config: %Electric.Application.Configuration{
  #       persistent_kv: ctx.persistent_kv
  #     }
  #   }
  # end

  # defp tenant_config(ctx) do
  #   [
  #     electric_instance_id: ctx.electric_instance_id,
  #     tenant_id: ctx.tenant_id,
  #     pg_id: Map.get(ctx, :pg_id, "12345"),
  #     shape_cache: ctx.shape_cache,
  #     storage: ctx.storage,
  #     inspector: ctx.inspector,
  #     registry: ctx.registry,
  #     long_poll_timeout: Access.get(ctx, :long_poll_timeout, 20_000),
  #     max_age: Access.get(ctx, :max_age, 60),
  #     stale_age: Access.get(ctx, :stale_age, 300),
  #     get_service_status: fn -> :active end
  #   ]
  # end

  # def store_tenant(tenant, ctx) do
  #   :ok =
  #     Electric.TenantManager.store_tenant(tenant,
  #       electric_instance_id: ctx.electric_instance_id,
  #       tenant_manager: ctx.tenant_manager,
  #       app_config: ctx.app_config,
  #       # not important for this test
  #       connection_opts:
  #         Access.get(ctx, :connection_opts, Electric.Utils.obfuscate_password(password: "foo"))
  #     )
  # end

  # def with_tenant(ctx) do
  #   tenant = Map.get_lazy(ctx, :tenant_config, fn -> tenant_config(ctx) end)

  #   tenant_opts = [
  #     electric_instance_id: ctx.electric_instance_id,
  #     persistent_kv: ctx.persistent_kv,
  #     connection_opts: ctx.db_config,
  #     tenant_manager: ctx.tenant_manager,
  #     app_config: ctx.app_config
  #   ]

  #   :ok = Electric.TenantManager.store_tenant(tenant, tenant_opts)

  #   %{tenant: tenant}
  # end

  # def with_supervised_tenant(ctx) do
  #   tenant =
  #     [
  #       electric_instance_id: ctx.electric_instance_id,
  #       tenant_id: ctx.tenant_id,
  #       pg_id: Map.get(ctx, :pg_id, "12345"),
  #       registry: ctx.registry,
  #       long_poll_timeout: Access.get(ctx, :long_poll_timeout, 20_000),
  #       max_age: Access.get(ctx, :max_age, 60),
  #       stale_age: Access.get(ctx, :stale_age, 300),
  #       get_service_status: fn -> :active end
  #     ]

  #   :ok =
  #     Electric.TenantManager.create_tenant(ctx.tenant_id, ctx.db_config,
  #       pg_id: tenant[:pg_id],
  #       registry: tenant[:registry],
  #       long_poll_timeout: tenant[:long_poll_timeout],
  #       max_age: tenant[:max_age],
  #       stale_age: tenant[:stale_age],
  #       get_service_status: tenant[:get_service_status],
  #       tenant_manager: ctx.tenant_manager,
  #       app_config: ctx.app_config,
  #       tenant_tables_name: ctx.tenant_tables_name
  #     )

  #   {:via, _, {registry_name, registry_key}} =
  #     Electric.Tenant.Supervisor.name(
  #       electric_instance_id: ctx.electric_instance_id,
  #       tenant_id: ctx.tenant_id
  #     )

  #   [{tenant_supervisor_pid, _}] = Registry.lookup(registry_name, registry_key)

  #   %{tenant: tenant, tenant_supervisor_pid: tenant_supervisor_pid}
  # end
end
