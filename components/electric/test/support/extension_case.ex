defmodule Electric.Extension.Case.Helpers do
  alias Electric.Postgres.Extension
  alias Electric.Replication.Postgres.Client

  require ExUnit.Assertions

  @doc """
  `fun` is called with an active connection within a transaction
  that has been migrated to the latest extension code version.
  """
  defmacro test_tx(message, fun) do
    quote do
      test(unquote(message), cxt) do
        tx(
          fn conn ->
            if not cxt.proxy?, do: migrate(conn)

            cond do
              is_function(unquote(fun), 1) -> unquote(fun).(conn)
              is_function(unquote(fun), 2) -> unquote(fun).(conn, cxt)
              true -> raise ArgumentError, message: "tx function should be arity 1 or 2"
            end
          end,
          cxt
        )
      end
    end
  end

  defmodule RollbackError do
    # use a special error to abort the transaction so we can be sure that some other problem isn't
    # happening in the tx and being swallowed
    defexception [:message]
  end

  def tx(fun, cxt) do
    try do
      Client.with_transaction(cxt.conn, fn tx ->
        fun.(tx)
        raise RollbackError, message: "rollback"
      end)
    rescue
      RollbackError -> :ok
    end
  end

  def migrate(conn, opts \\ []) do
    expected_versions =
      Extension.migrations()
      |> Enum.map(&apply(&1, :version, []))

    ExUnit.Assertions.assert({:ok, ^expected_versions} = Extension.migrate(conn))

    {:ok, oid} = Electric.Replication.Postgres.Client.query_oids(conn)
    Electric.Postgres.OidDatabase.save_oids(oid)

    public_schema(conn, opts)
  end

  def public_schema(conn, opts) do
    search_path = Keyword.get(opts, :search_path, "public")
    # for some reason the conn comes in creating everything in the `electric`
    # schema -- must be because we've just done loads of stuff there...
    {:ok, _, _} = :epgsql.squery(conn, "SET SEARCH_PATH = #{search_path};")
    conn
  end

  def save_migration_version(conn, version) do
    # use the version as the txid because in our tests all migrations run in a
    # single tx, which means the "real" txid never changes (in real life the tx
    # id would increase between migrations).
    {:ok, 1} =
      :epgsql.equery(
        conn,
        "INSERT INTO #{Extension.version_table()} (txid, version) VALUES ($1, $2)",
        [
          String.to_integer(version),
          version
        ]
      )

    :ok
  end
end

defmodule Electric.Extension.Case do
  import ExUnit.Callbacks, only: [start_supervised: 1]
  alias Electric.Postgres.TestConnection

  defmacro __using__(opts) do
    case_opts = Keyword.take(opts, [:async])
    extension_opts = Keyword.take(opts, [:proxy])

    proxy_opts =
      case Keyword.get(extension_opts, :proxy) do
        opts when is_list(opts) -> Keyword.put_new(opts, :password, "password")
        other -> other
      end

    quote do
      use ExUnit.Case, unquote(case_opts)

      import Electric.Extension.Case, only: [setup_proxy_connection: 1, setup_test_connection: 1]
      import Electric.Extension.Case.Helpers
      import Electric.Postgres.TestConnection, only: [setup_replicated_db: 1]

      alias Electric.{Postgres, Postgres.Extension}

      # When proxy_opts are present, we create a new temporary database, apply internal migrations there and create a
      # proxy connection to it for tests.
      # When proxy_opts are missing, a regular connection to the already running test database is created and no
      # migrations are applied.
      if unquote(proxy_opts) do
        setup do: %{proxy_opts: unquote(proxy_opts)}
        setup [:setup_replicated_db, :setup_proxy_connection]
      else
        setup :setup_test_connection
      end
    end
  end

  def setup_proxy_connection(cxt) do
    connector_config = [origin: cxt.origin, connection: cxt.pg_config, proxy: cxt.proxy_opts]

    {:ok, _pid} =
      start_supervised(
        {Electric.Postgres.Proxy,
         Keyword.merge(cxt.proxy_opts, connector_config: connector_config)}
      )

    proxy_port = get_in(cxt.proxy_opts, [:listen, :port]) || 65432
    pg_config = Keyword.merge(cxt.pg_config, port: proxy_port)

    {:ok, conn} =
      start_supervised(TestConnection.childspec(pg_config, :extension_case_proxy_connection))

    %{conn: conn, proxy?: true}
  end

  def setup_test_connection(_) do
    pg_config = Electric.Postgres.TestConnection.config()
    {:ok, conn} = start_supervised(Electric.Postgres.TestConnection.childspec(pg_config))
    %{origin: "my-origin", conn: conn, proxy?: false}
  end
end
