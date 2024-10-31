defmodule Electric.Tenant.Persistence do
  @moduledoc """
  Helper module to persist information about tenants.
  """

  @doc """
  Persists a tenant configuration.
  """
  @spec persist_tenant!(String.t(), Keyword.t(), Keyword.t()) :: :ok
  def persist_tenant!(tenant_id, conn_opts, opts) do
    %{persistent_kv: kv} =
      Keyword.get_lazy(opts, :app_config, fn -> Electric.Application.Configuration.get() end)

    serialised_tenants =
      load_tenants!(opts)
      |> Map.put(tenant_id, conn_opts)
      |> serialise_tenants()

    Electric.PersistentKV.set(kv, key(opts), serialised_tenants)
  end

  @doc """
  Loads all tenants.
  Returns a map of tenant ID to connection options.
  """
  @spec load_tenants!(Keyword.t()) :: map()
  def load_tenants!(opts) do
    %{persistent_kv: kv} =
      Keyword.get_lazy(opts, :app_config, fn -> Electric.Application.Configuration.get() end)

    case Electric.PersistentKV.get(kv, key(opts)) do
      {:ok, tenants} ->
        deserialise_tenants(tenants)

      {:error, :not_found} ->
        %{}

      error ->
        raise error
    end
  end

  defp serialise_tenants(tenants) do
    tenants
    |> map_values(&tenant_config_keyword_to_map/1)
    |> Jason.encode!()
  end

  defp deserialise_tenants(tenants) do
    tenants
    |> Jason.decode!()
    |> map_values(&tenant_config_map_to_keyword/1)
  end

  defp tenant_config_keyword_to_map(conn_opts) do
    conn_opts
    |> Electric.Utils.deobfuscate_password()
    |> Enum.into(%{})
  end

  defp tenant_config_map_to_keyword(config_map) do
    config_map
    |> Enum.map(fn {k, v} ->
      val =
        if k == "sslmode" do
          String.to_existing_atom(v)
        else
          v
        end

      {String.to_existing_atom(k), val}
    end)
    |> Electric.Utils.obfuscate_password()
  end

  defp key(opts) do
    electric_instance_id = Access.fetch!(opts, :electric_instance_id)
    "tenants_#{electric_instance_id}"
  end

  defp map_values(map, fun), do: Map.new(map, fn {k, v} -> {k, fun.(v)} end)
end
