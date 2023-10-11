defmodule Electric.Extension.Case.Helpers do
  alias Electric.Postgres.Extension

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
            migrate(conn)

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
    ExUnit.Assertions.assert_raise(RollbackError, fn ->
      :epgsql.with_transaction(
        cxt.conn,
        fn tx ->
          fun.(tx)
          raise RollbackError, message: "rollback"
        end,
        reraise: true
      )
    end)
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
  defmacro __using__(opts) do
    case_opts = Keyword.take(opts, [:async])
    extension_opts = Keyword.take(opts, [:proxy])
    proxy_opts = Keyword.get(extension_opts, :proxy, false)
    proxy? = proxy_opts not in [false, nil]

    proxy_opts =
      Keyword.put_new(if(is_list(proxy_opts), do: proxy_opts, else: []), :password, "password")

    quote do
      use ExUnit.Case, unquote(case_opts)

      alias Electric.{Postgres, Postgres.Extension}

      import Electric.Extension.Case.Helpers

      setup [:db_connect]

      def db_connect(cxt) do
        origin = "my-origin"

        if unquote(proxy?) do
          pg_config = Electric.Postgres.TestConnection.config()
          conn_config = [origin: origin, connection: pg_config, proxy: unquote(proxy_opts)]

          handler_config = Keyword.get(unquote(proxy_opts), :handler_config, [])

          {:ok, _pid} =
            start_supervised(
              {Electric.Postgres.Proxy,
               Keyword.merge(unquote(proxy_opts),
                 conn_config: conn_config
               )}
            )

          {:ok, _pid} = start_supervised({Extension.SchemaCache, conn_config})
        end

        {:ok, conn} = start_supervised(Electric.Postgres.TestConnection.childspec(pg_config()))

        {:ok, conn: conn, origin: origin}
      end

      if unquote(proxy?) do
        def pg_config do
          pg_config = Electric.Postgres.TestConnection.config()
          port = get_in(unquote(proxy_opts), [:listen, :port]) || 65432
          Keyword.merge(pg_config, port: port)
        end
      else
        def pg_config do
          Electric.Postgres.TestConnection.config()
        end
      end

      defoverridable pg_config: 0
    end
  end
end
