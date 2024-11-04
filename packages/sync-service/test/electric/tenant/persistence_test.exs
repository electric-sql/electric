defmodule Electric.Tenant.PersistenceTest do
  use ExUnit.Case, async: false

  alias Electric.Utils

  import Support.ComponentSetup
  import Support.TestUtils

  setup :with_persistent_kv
  setup :with_electric_instance_id

  @tenant1 "test_tenant1"
  @tenant2 "test_tenant2"

  @conn_opts [
               database: "electric",
               hostname: "localhost",
               ipv6: false,
               password: "password",
               port: 54321,
               sslmode: :disable,
               username: "postgres"
             ]
             |> Enum.sort_by(fn {key, _value} -> key end)

  test "should load persisted tenant", opts do
    Electric.Tenant.Persistence.persist_tenant!(
      @tenant1,
      Electric.Utils.obfuscate_password(@conn_opts),
      app_config(opts)
    )

    tenants =
      Electric.Tenant.Persistence.load_tenants!(app_config(opts))
      |> Utils.map_values(&Utils.deobfuscate_password/1)

    assert tenants == %{
             @tenant1 => @conn_opts
           }
  end

  test "should load all added tenants", opts do
    Electric.Tenant.Persistence.persist_tenant!(
      @tenant1,
      Electric.Utils.obfuscate_password(@conn_opts),
      app_config(opts)
    )

    tenant2_db = "electric_test"

    tenant2_conn_opts =
      Keyword.merge(@conn_opts, database: tenant2_db)
      |> Enum.sort_by(fn {key, _value} -> key end)

    Electric.Tenant.Persistence.persist_tenant!(
      @tenant2,
      Electric.Utils.obfuscate_password(tenant2_conn_opts),
      app_config(opts)
    )

    tenants =
      Electric.Tenant.Persistence.load_tenants!(app_config(opts))
      |> Utils.map_values(&Utils.deobfuscate_password/1)

    assert tenants == %{
             @tenant1 => @conn_opts,
             @tenant2 => tenant2_conn_opts
           }
  end

  test "should delete tenant", opts do
    # Create two tenants
    Electric.Tenant.Persistence.persist_tenant!(
      @tenant1,
      Electric.Utils.obfuscate_password(@conn_opts),
      app_config(opts)
    )

    tenant2_db = "electric_test"

    tenant2_conn_opts =
      Keyword.merge(@conn_opts, database: tenant2_db)
      |> Enum.sort_by(fn {key, _value} -> key end)

    Electric.Tenant.Persistence.persist_tenant!(
      @tenant2,
      Electric.Utils.obfuscate_password(tenant2_conn_opts),
      app_config(opts)
    )

    # Check that boths tenants are persisted
    tenants =
      Electric.Tenant.Persistence.load_tenants!(app_config(opts))
      |> Utils.map_values(&Utils.deobfuscate_password/1)

    assert tenants == %{
             @tenant1 => @conn_opts,
             @tenant2 => tenant2_conn_opts
           }

    # Delete a tenant
    Electric.Tenant.Persistence.delete_tenant!(@tenant1, app_config(opts))

    # Check that the other tenant still exists
    tenants =
      Electric.Tenant.Persistence.load_tenants!(app_config(opts))
      |> Utils.map_values(&Utils.deobfuscate_password/1)

    assert tenants == %{
             @tenant2 => tenant2_conn_opts
           }
  end

  defp app_config(ctx) do
    [
      app_config: %{
        persistent_kv: ctx.persistent_kv
      },
      electric_instance_id: ctx.electric_instance_id
    ]
  end
end
