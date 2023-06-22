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
            unquote(fun).(conn)
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

    public_schema(conn, opts)
  end

  def public_schema(conn, opts) do
    search_path = Keyword.get(opts, :search_path, "public")
    # for some reason the conn comes in creating everything in the `electric`
    # schema -- must be because we've just done loads of stuff there...
    {:ok, _, _} = :epgsql.squery(conn, "SET SEARCH_PATH = #{search_path};")
    conn
  end
end

defmodule Electric.Extension.Case do
  defmacro __using__(opts) do
    quote do
      use ExUnit.Case, unquote(opts)

      alias Electric.{Postgres, Postgres.Extension}

      import Electric.Extension.Case.Helpers

      setup do
        pg_config = Electric.Postgres.TestConnection.config()

        {:ok, conn} = start_supervised(Electric.Postgres.TestConnection.childspec(pg_config))

        {:ok, conn: conn}
      end
    end
  end
end
