defmodule Support.DbSetup do
  import ExUnit.Callbacks

  def with_unique_db(ctx) do
    base_config = Application.fetch_env!(:electric, :database_config)

    {:ok, utility_pool} =
      Postgrex.start_link(base_config ++ [backoff_type: :stop, max_restarts: 0])

    Process.unlink(utility_pool)

    db_name = to_string(ctx.test)
    escaped_db_name = :binary.replace(db_name, ~s'"', ~s'""', [:global])

    Postgrex.query!(utility_pool, "DROP DATABASE IF EXISTS \"#{escaped_db_name}\"", [])
    Postgrex.query!(utility_pool, "CREATE DATABASE \"#{escaped_db_name}\"", [])

    on_exit(fn ->
      Process.link(utility_pool)

      # Make multiple 100ms-spaced attempts to drop the DB because sometimes the replication stream takes some time to stop
      Enum.reduce_while(1..3, :ok, fn _, _ ->
        case Postgrex.query(utility_pool, "DROP DATABASE \"#{escaped_db_name}\"", []) do
          {:ok, _} -> {:halt, :ok}
          {:error, %{postgres: %{code: :object_in_use}}} -> {:cont, Process.sleep(100)}
        end
      end)

      GenServer.stop(utility_pool)
    end)

    updated_config = Keyword.put(base_config, :database, db_name)
    {:ok, pool} = Postgrex.start_link(updated_config ++ [backoff_type: :stop, max_restarts: 0])

    {:ok, %{utility_pool: utility_pool, db_config: updated_config, pool: pool, db_conn: pool}}
  end

  def with_shared_db(_ctx) do
    config = Application.fetch_env!(:electric, :database_config)

    {:ok, pool} =
      Postgrex.start_link(config ++ [backoff_type: :stop, max_restarts: 0])

    {:ok, %{pool: pool, db_config: config, db_conn: pool}}
  end

  def in_transaction(%{pool: pool}) do
    parent = self()

    {:ok, task} =
      Task.start(fn ->
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
end
