defmodule Support.DbSetup do
  import ExUnit.Callbacks

  @postgrex_start_opts [
    backoff_type: :stop,
    max_restarts: 0,
    pool_size: 1,
    types: PgInterop.Postgrex.Types
  ]

  def with_unique_db(ctx) do
    replication_config = Application.fetch_env!(:electric, :replication_connection_opts)
    query_config = Application.fetch_env!(:electric, :query_connection_opts)
    {:ok, utility_pool} = start_utility_pool(replication_config)
    Process.unlink(utility_pool)

    full_db_name = to_string(ctx.test)

    db_name_hash = small_hash(full_db_name)

    # Truncate the database name to 63 characters, use hash to guarantee uniqueness
    db_name = "#{db_name_hash} ~ #{String.slice(full_db_name, 0..50)}"

    escaped_db_name = :binary.replace(db_name, ~s'"', ~s'""', [:global])

    # Terminate any active connections to the database
    Postgrex.query!(
      utility_pool,
      "SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid();",
      [db_name]
    )

    Postgrex.query!(utility_pool, "DROP DATABASE IF EXISTS \"#{escaped_db_name}\"", [])
    Postgrex.query!(utility_pool, "CREATE DATABASE \"#{escaped_db_name}\"", [])

    Enum.each(database_settings(ctx), fn setting ->
      Postgrex.query!(utility_pool, "ALTER DATABASE \"#{escaped_db_name}\" SET #{setting}", [])
    end)

    # schedule cleanup of the database after all tests have run
    ExUnit.after_suite(fn _ ->
      {:ok, utility_pool} = start_utility_pool(replication_config)
      drop_database(utility_pool, escaped_db_name)
      GenServer.stop(utility_pool)
    end)

    on_exit(fn ->
      Process.link(utility_pool)
      GenServer.stop(utility_pool)
    end)

    updated_replication_config =
      replication_config
      |> Keyword.put(:database, db_name)
      |> Keyword.merge(List.wrap(ctx[:connection_opt_overrides]))

    updated_query_config =
      query_config
      |> Keyword.put(:database, db_name)
      |> Keyword.merge(List.wrap(ctx[:connection_opt_overrides]))

    pool = start_db_pool!(updated_replication_config)

    {:ok,
     %{
       utility_pool: utility_pool,
       db_config: updated_replication_config,
       pooled_db_config: updated_query_config,
       pool: pool,
       db_conn: pool,
       escaped_db_name: escaped_db_name
     }}
  end

  defp drop_database(pool, escaped_db_name) do
    DBConnection.run(
      pool,
      fn conn ->
        # Terminate any active connections to the database except the current one
        Postgrex.query!(conn, "
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = $1
          AND pid <> pg_backend_pid();
        ", [escaped_db_name])

        # Make multiple 100ms-spaced attempts to drop the DB because sometimes the replication stream takes some time to stop
        Enum.reduce_while(1..20, :ok, fn _, _ ->
          case Postgrex.query(conn, "DROP DATABASE IF EXISTS \"#{escaped_db_name}\"", []) do
            {:ok, _} ->
              {:halt, :ok}

            {:error, %{postgres: %{code: :object_in_use}}} ->
              {:cont, Process.sleep(100)}
          end
        end)
      end,
      timeout: 20000
    )
  end

  def with_publication_name(_ctx), do: %{publication_name: "pub_manual_publishing_test"}

  def with_publication(ctx) do
    publication_name =
      Map.get_lazy(ctx, :publication_name, fn ->
        "electric_test_publication_#{small_hash(ctx.test)}"
      end)

    query = "CREATE PUBLICATION \"#{publication_name}\""
    supported_features = Support.TestUtils.fetch_supported_features(ctx.pool)

    query =
      if supported_features.supports_generated_column_replication,
        do: "#{query} WITH (publish_generated_columns = stored)",
        else: query

    Postgrex.query!(ctx.pool, query, [])

    %{publication_name: publication_name}
  end

  @doc """
  Creates a database that is shared between all tests in the module
  """
  def with_shared_db(ctx) do
    replication_config = Application.fetch_env!(:electric, :replication_connection_opts)
    {:ok, utility_pool} = start_utility_pool(replication_config)
    Process.unlink(utility_pool)

    on_exit(fn ->
      Process.link(utility_pool)
      GenServer.stop(utility_pool)
    end)

    full_db_name = inspect(ctx.module)
    db_name_hash = small_hash(full_db_name)

    # Truncate the database name to 63 characters, use hash to guarantee uniqueness
    db_name = "#{db_name_hash} ~ #{String.slice(full_db_name, 0..50)}"
    escaped_db_name = :binary.replace(db_name, ~s'"', ~s'""', [:global])

    %Postgrex.Result{rows: [[exists]]} =
      Postgrex.query!(
        utility_pool,
        "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)",
        [db_name]
      )

    if not exists do
      Postgrex.query!(utility_pool, "CREATE DATABASE \"#{escaped_db_name}\"", [])

      Enum.each(database_settings(ctx), fn setting ->
        Postgrex.query!(utility_pool, "ALTER DATABASE \"#{db_name}\" SET #{setting}", [])
      end)

      ExUnit.after_suite(fn _ ->
        {:ok, utility_pool} = start_utility_pool(replication_config)
        drop_database(utility_pool, escaped_db_name)
        GenServer.stop(utility_pool)
      end)
    end

    config =
      replication_config
      |> Keyword.put(:database, db_name)
      |> Keyword.merge(List.wrap(ctx[:connection_opt_overrides]))

    pool = start_db_pool!(config)

    {:ok, %{pool: pool, db_config: config, db_conn: pool}}
  end

  def in_transaction(%{pool: pool}) do
    parent = self()

    {:ok, task} =
      Task.start(fn ->
        try do
          Postgrex.transaction(
            pool,
            fn conn ->
              send(parent, {:conn_handover, conn})

              exit_parent =
                receive do
                  {:done, exit_parent} -> exit_parent
                end

              Postgrex.rollback(conn, {:complete, exit_parent})
            end,
            timeout: :infinity
          )
          |> case do
            {:error, {:complete, target}} ->
              send(target, :transaction_complete)

            {:error, _} ->
              receive do
                {:done, target} -> send(target, :transaction_complete)
              end
          end
        rescue
          _ in Postgrex.Error ->
            receive do
              {:done, target} -> send(target, :transaction_complete)
            end
        end
      end)

    conn =
      receive do
        {:conn_handover, conn} -> conn
      end

    on_exit(fn ->
      send(task, {:done, self()})

      receive do
        :transaction_complete -> :ok
      after
        5000 -> :ok
      end
    end)

    {:ok, %{db_conn: conn}}
  end

  defp database_settings(%{database_settings: settings}), do: settings
  defp database_settings(_), do: []

  defp small_hash(value),
    do:
      to_string(value)
      |> :erlang.phash2(64 ** 5)
      |> :binary.encode_unsigned()
      |> Base.encode64()
      |> String.replace_trailing("==", "")

  defp start_db_pool!(connection_opts) do
    start_opts =
      Keyword.merge(@postgrex_start_opts, Electric.Utils.deobfuscate_password(connection_opts))

    start_link_supervised!({Postgrex, start_opts})
  end

  defp start_utility_pool(connection_opts) do
    start_opts =
      Keyword.merge(@postgrex_start_opts, Electric.Utils.deobfuscate_password(connection_opts))

    Postgrex.start_link(start_opts)
  end
end
