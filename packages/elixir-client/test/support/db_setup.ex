defmodule Support.DbSetup do
  import ExUnit.Callbacks

  alias Electric.Client.Util

  def with_unique_table(_ctx) do
    columns = [
      "id uuid primary key",
      "title text"
    ]

    with_table(tablename(), columns)
  end

  def tablename do
    "client_items_#{Util.generate_id(6)}"
  end

  def with_table(tablename \\ tablename(), table_columns) do
    base_config = Application.fetch_env!(:electric_client, :database_config)
    extra_opts = [backoff_type: :stop, max_restarts: 0]

    {:ok, utility_pool} = Postgrex.start_link(base_config ++ extra_opts)

    Process.unlink(utility_pool)

    Postgrex.query!(
      utility_pool,
      """
        CREATE TABLE IF NOT EXISTS \"#{tablename}\" (
          #{Enum.join(table_columns, ",\n  ")}
        );
      """,
      []
    )

    on_exit(fn ->
      Process.link(utility_pool)
      Postgrex.query!(utility_pool, "DROP TABLE \"#{tablename}\"", [])
      GenServer.stop(utility_pool)
    end)

    {:ok, pool} = Postgrex.start_link(base_config ++ extra_opts)
    {:ok, %{utility_pool: utility_pool, pool: pool, db_conn: pool, tablename: tablename}}
  end

  def insert_item(%{db_conn: db, tablename: tablename}) do
    insert_item(db, tablename)
  end

  def insert_item(db_conn, tablename) do
    id = UUID.uuid4()

    %Postgrex.Result{num_rows: 1} =
      Postgrex.query!(
        db_conn,
        """
          INSERT INTO \"#{tablename}\" (
              id,
              title
            )
            VALUES (
              $1,
              'Some title'
            );
        """,
        [UUID.string_to_binary!(id)]
      )

    {:ok, id}
  end
end