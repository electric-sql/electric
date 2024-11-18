defmodule CloudElectric.TenantManagerTest do
  use ExUnit.Case, async: true

  alias CloudElectric.TenantManager

  import Support.DbSetup
  import Support.ComponentSetup

  @moduletag :tmp_dir
  @moduletag :capture_log
  setup_all :with_persistent_kv
  setup :with_unique_dbs
  setup :with_tenant_supervisor

  describe "create_tenant/3" do
    setup :with_tenant_manager

    @tag db_count: 1
    test "creates and starts a new tenant", %{
      tenant_manager: tenant_manager,
      dbs: [%{db_config: config}]
    } do
      assert :ok =
               TenantManager.create_tenant("tenant-id-1", config, tenant_manager: tenant_manager)

      assert_receive {:startup_progress, "tenant-id-1", :shape_supervisor_ready}, 500
    end

    @tag db_count: 2
    test "doesn't create a tenant with same id", %{
      tenant_manager: tenant_manager,
      dbs: [%{db_config: config1}, %{db_config: config2}]
    } do
      assert :ok =
               TenantManager.create_tenant("duplicating-tenant-1", config1,
                 tenant_manager: tenant_manager
               )

      assert_receive {:startup_progress, "duplicating-tenant-1", :shape_supervisor_ready}, 500

      assert {:error, {:tenant_already_exists, _}} =
               TenantManager.create_tenant("duplicating-tenant-1", config2,
                 tenant_manager: tenant_manager
               )
    end

    @tag db_count: 1
    test "doesn't create a tenant with same connection info", %{
      tenant_manager: tenant_manager,
      dbs: [%{db_config: config}]
    } do
      assert :ok =
               TenantManager.create_tenant("non-duplicating-tenant-1", config,
                 tenant_manager: tenant_manager
               )

      assert_receive {:startup_progress, "non-duplicating-tenant-1", :shape_supervisor_ready}, 500

      assert {:error, {:db_already_in_use, _}} =
               TenantManager.create_tenant("non-duplicating-tenant-2", config,
                 tenant_manager: tenant_manager
               )
    end

    @tag db_count: 2
    test "correctly starts 2 tenants in parallel", %{
      tenant_manager: tenant_manager,
      dbs: [%{db_config: config1}, %{db_config: config2}]
    } do
      assert :ok =
               TenantManager.create_tenant("parallel-tenant-1", config1,
                 tenant_manager: tenant_manager
               )

      assert :ok =
               TenantManager.create_tenant("parallel-tenant-2", config2,
                 tenant_manager: tenant_manager
               )

      assert_receive {:startup_progress, "parallel-tenant-1", :shape_supervisor_ready}, 500
      assert_receive {:startup_progress, "parallel-tenant-2", :shape_supervisor_ready}, 500
    end
  end

  describe "get_tenant/2" do
    setup :with_tenant_manager
    @tag db_count: 0
    test "returns an error if tenant with this ID is not found", %{tenant_manager: tenant_manager} do
      assert {:error, :not_found} =
               TenantManager.get_tenant("nonexistent-tenant", tenant_manager: tenant_manager)
    end

    @tag db_count: 1
    test "returns tenant info", %{tenant_manager: tenant_manager, dbs: [%{db_config: config}]} do
      assert :ok =
               TenantManager.create_tenant("existent-tenant", config,
                 tenant_manager: tenant_manager
               )

      assert_receive {:startup_progress, "existent-tenant", :shape_supervisor_ready}, 500

      assert {:ok, _} =
               TenantManager.get_tenant("existent-tenant", tenant_manager: tenant_manager)
    end
  end

  describe "delete_tenant/1" do
    setup :with_tenant_manager

    @tag db_count: 0
    test "returns an error if tenant with this ID is not found", %{tenant_manager: tenant_manager} do
      assert {:error, :not_found} =
               TenantManager.get_tenant("nonexistent-tenant", tenant_manager: tenant_manager)
    end

    @tag db_count: 1
    test "stops the tenant supervision tree & cleans up the publication", %{
      tenant_manager: tenant_manager,
      dbs: [%{db_config: config, pool: pool}],
      tenant_supervisor: sup
    } do
      assert :ok =
               TenantManager.create_tenant("doomed-tenant", config,
                 tenant_manager: tenant_manager
               )

      assert_receive {:startup_progress, "doomed-tenant", :shape_supervisor_ready}, 500
      assert [{_, pid, _, _}] = DynamicSupervisor.which_children(sup)
      assert Process.alive?(pid)

      assert :ok = TenantManager.delete_tenant("doomed-tenant", tenant_manager: tenant_manager)
      refute Process.alive?(pid)

      assert {:error, :not_found} =
               TenantManager.get_tenant("doomed-tenant", tenant_manager: tenant_manager)

      assert %{rows: []} = Postgrex.query!(pool, "SELECT pubname FROM pg_publication")
    end
  end

  describe "start_link/1 with control plane" do
    test "should load initial tenants from the control plane and start them immediately"
  end
end
