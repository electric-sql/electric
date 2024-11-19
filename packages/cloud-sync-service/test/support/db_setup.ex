defmodule Support.DbSetup do
  import ExUnit.Callbacks

  @postgrex_start_opts [
    backoff_type: :stop,
    max_restarts: 0,
    pool_size: 1
  ]

  def with_unique_dbs(%{db_count: db_count} = ctx) do
    base_config =
      Electric.Utils.obfuscate_password(
        Application.fetch_env!(:cloud_electric, :test_db_connection)
      )

    {:ok, utility_pool} = start_db_pool(base_config)
    Process.unlink(utility_pool)

    all_connection_opts =
      for pos <- 1..db_count do
        db_name = "tenant#{pos}_#{ctx.test}" |> binary_slice(0..60)

        escaped_db_name =
          :binary.replace(db_name, ~s'"', ~s'""', [:global])

        Postgrex.query!(utility_pool, "DROP DATABASE IF EXISTS \"#{escaped_db_name}\"", [])
        Postgrex.query!(utility_pool, "CREATE DATABASE \"#{escaped_db_name}\"", [])

        Enum.each(database_settings(ctx), fn setting ->
          Postgrex.query!(utility_pool, "ALTER DATABASE \"#{db_name}\" SET #{setting}", [])
        end)

        updated_config = Keyword.put(base_config, :database, db_name)
        {:ok, pool} = start_db_pool(updated_config)

        %{
          db_config: updated_config,
          pool: pool,
          escaped_db_name: escaped_db_name,
          url: config_to_url(updated_config)
        }
      end

    Postgrex.query!(
      utility_pool,
      "SELECT datname  FROM pg_catalog.pg_database  WHERE datistemplate = false;"
    )

    on_exit(fn ->
      for %{escaped_db_name: escaped_db_name} <- all_connection_opts do
        # Make multiple 100ms-spaced attempts to drop the DB because sometimes the replication stream takes some time to stop
        Enum.reduce_while(1..3, :ok, fn _, _ ->
          case Postgrex.query(utility_pool, "DROP DATABASE \"#{escaped_db_name}\"", []) do
            {:ok, _} -> {:halt, :ok}
            {:error, %{postgres: %{code: :object_in_use}}} -> {:cont, Process.sleep(100)}
          end
        end)
      end

      GenServer.stop(utility_pool)
    end)

    {:ok, %{utility_pool: utility_pool, dbs: all_connection_opts}}
  end

  def with_unique_dbs(_), do: %{}

  defp database_settings(%{database_settings: settings}), do: settings
  defp database_settings(_), do: []

  defp start_db_pool(connection_opts) do
    start_opts = Electric.Utils.deobfuscate_password(connection_opts) ++ @postgrex_start_opts
    Postgrex.start_link(start_opts)
  end

  defp config_to_url(db) do
    "postgresql://#{db[:username]}:#{db[:password].()}@#{db[:hostname]}:#{db[:port]}/#{db[:database]}?sslmode=#{db[:sslmode]}"
  end
end
