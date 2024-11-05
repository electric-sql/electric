defmodule Electric.TenantManagerTest do
  use ExUnit.Case, async: false

  alias Electric.TenantManager
  alias Electric.Tenant.Persistence

  import Support.ComponentSetup
  import Support.DbSetup

  @moduletag :tmp_dir

  describe "start_link/1" do
    @tenant_id "persisted_tenant"

    setup :with_unique_db
    setup :with_publication

    setup ctx do
      # Persist a tenant
      with_manager = fn ctx ->
        opts = [
          app_config: ctx.app_config,
          persistent_kv: ctx.persistent_kv,
          electric_instance_id: ctx.electric_instance_id
        ]

        # Persist a tenant
        Persistence.persist_tenant!(@tenant_id, ctx.db_config, opts)

        # Now create the tenant manager
        with_tenant_manager(ctx)
      end

      with_complete_stack_but_no_tenant(ctx, tenant_manager: with_manager)
    end

    test "loads tenants from storage", ctx do
      # Check that it recreated the tenant
      {:ok, tenant} =
        TenantManager.get_tenant(@tenant_id,
          tenant_manager: ctx.tenant_manager,
          tenant_tables_name: ctx.tenant_tables_name
        )

      assert tenant[:tenant_id] == @tenant_id
    end
  end

  describe "create_tenant/1" do
    setup :with_unique_db
    setup :with_publication

    setup :with_complete_stack_but_no_tenant
    setup :with_app_config

    setup ctx do
      Map.put(ctx, :connection_opts, Map.fetch!(ctx, :db_config))
    end

    test "creates a new tenant", %{
      tenant_manager: tenant_manager,
      tenant_id: tenant_id,
      connection_opts: connection_opts,
      inspector: inspector,
      app_config: app_config,
      tenant_tables_name: tenant_tables_name
    } do
      :ok =
        TenantManager.create_tenant(tenant_id, connection_opts,
          inspector: inspector,
          tenant_manager: tenant_manager,
          app_config: app_config,
          tenant_tables_name: tenant_tables_name
        )
    end

    test "complains if tenant already exists", %{
      tenant_manager: tenant_manager,
      tenant_id: tenant_id,
      connection_opts: connection_opts,
      inspector: inspector,
      app_config: app_config,
      tenant_tables_name: tenant_tables_name
    } do
      assert :ok =
               TenantManager.create_tenant(tenant_id, connection_opts,
                 inspector: inspector,
                 tenant_manager: tenant_manager,
                 app_config: app_config,
                 tenant_tables_name: tenant_tables_name
               )

      assert {:error, {:tenant_already_exists, ^tenant_id}} =
               TenantManager.create_tenant(
                 tenant_id,
                 Keyword.put(connection_opts, :port, "654"),
                 inspector: inspector,
                 tenant_manager: tenant_manager,
                 app_config: app_config,
                 tenant_tables_name: tenant_tables_name
               )
    end

    test "complains if database is already in use by a tenant", %{
      tenant_manager: tenant_manager,
      tenant_id: tenant_id,
      connection_opts: connection_opts,
      inspector: inspector,
      app_config: app_config,
      tenant_tables_name: tenant_tables_name
    } do
      assert :ok =
               TenantManager.create_tenant(tenant_id, connection_opts,
                 inspector: inspector,
                 tenant_manager: tenant_manager,
                 app_config: app_config,
                 tenant_tables_name: tenant_tables_name
               )

      pg_id =
        connection_opts[:hostname] <>
          ":" <> to_string(connection_opts[:port]) <> "/" <> connection_opts[:database]

      assert {:error, {:db_already_in_use, ^pg_id}} =
               TenantManager.create_tenant("another_tenant", connection_opts,
                 inspector: inspector,
                 tenant_manager: tenant_manager,
                 app_config: app_config,
                 tenant_tables_name: tenant_tables_name
               )
    end
  end

  describe "fetching tenants when there are none" do
    setup :with_unique_db

    setup do
      %{publication_name: "electric_test_publication"}
    end

    setup :with_complete_stack_but_no_tenant

    test "get_only_tenant/1 complains if there are no tenants", ctx do
      assert {:error, :not_found} =
               TenantManager.get_only_tenant(tenant_manager: ctx.tenant_manager)
    end

    test "get_tenant/2 complains if the tenant does not exist", ctx do
      assert {:error, :not_found} =
               TenantManager.get_tenant("non-existing tenant", tenant_manager: ctx.tenant_manager)
    end
  end

  describe "fetching the only tenant" do
    setup :with_unique_db

    setup do
      %{publication_name: "electric_test_publication", slot_name: "electric_test_slot"}
    end

    setup :with_complete_stack

    test "get_only_tenant/1 returns the only tenant", ctx do
      {:ok, tenant_config} =
        TenantManager.get_only_tenant(tenant_manager: ctx.tenant_manager)

      assert tenant_config[:tenant_id] == ctx.tenant_id
    end

    test "get_tenant/2 returns the requested tenant", ctx do
      {:ok, tenant_config} =
        TenantManager.get_tenant(ctx.tenant_id, tenant_manager: ctx.tenant_manager)

      assert tenant_config[:tenant_id] == ctx.tenant_id
    end
  end

  describe "fetching a tenant when there are two tenants" do
    setup :with_unique_db

    setup do
      %{publication_name: "electric_test_publication", slot_name: "electric_test_slot"}
    end

    setup :with_complete_stack

    setup ctx do
      with_tenant(
        ctx
        |> Map.put(:tenant_id, "another_tenant")
        |> Map.put(:pg_id, "678")
      )
    end

    test "get_only_tenant/1 complains if there are several tenants", ctx do
      assert {:error, :several_tenants} =
               TenantManager.get_only_tenant(tenant_manager: ctx.tenant_manager)
    end

    test "get_tenant/2 returns the requested tenant", ctx do
      {:ok, tenant_config} =
        TenantManager.get_tenant("another_tenant", tenant_manager: ctx.tenant_manager)

      assert tenant_config[:tenant_id] == "another_tenant"
    end
  end

  describe "delete_tenant/2" do
    setup :with_unique_db

    setup do
      %{
        publication_name: "electric_test_publication"
      }
    end

    setup ctx do
      ctx
      |> Map.put(:connection_opts, Map.fetch!(ctx, :db_config))
      |> with_complete_stack(tenant: &with_supervised_tenant/1)
    end

    test "deletes the tenant", %{
      electric_instance_id: electric_instance_id,
      tenant_id: tenant_id,
      tenant_manager: tenant_manager,
      tenant_tables_name: tenant_tables_name,
      tenant_supervisor_pid: tenant_supervisor_pid,
      app_config: app_config
    } do
      # Check that the tenant supervisor is running
      # and that the tenant's ETS tables are registered in the global ETS table
      assert Process.alive?(tenant_supervisor_pid)
      assert :ets.member(tenant_tables_name, {tenant_id, :pg_info_table})
      assert :ets.member(tenant_tables_name, {tenant_id, :pg_relation_table})

      # Delete the tenant
      assert :ok =
               TenantManager.delete_tenant(tenant_id,
                 electric_instance_id: electric_instance_id,
                 tenant_id: tenant_id,
                 tenant_manager: tenant_manager,
                 tenant_tables_name: tenant_tables_name,
                 app_config: app_config
               )

      # Check that the tenant is now unknown to the tenant manager
      # and that it is fully shut down and removed from the ETS table
      assert {:error, :not_found} =
               TenantManager.get_tenant(tenant_id, tenant_manager: tenant_manager)

      # Verify process was terminated
      refute Process.alive?(tenant_supervisor_pid)

      refute :ets.member(tenant_tables_name, {tenant_id, :pg_info_table})
      refute :ets.member(tenant_tables_name, {tenant_id, :pg_relation_table})
    end
  end
end
