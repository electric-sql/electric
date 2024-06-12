defmodule Electric.Postgres.Proxy.TestScenario.Manual do
  @moduledoc """
  Describes migrations being done within psql, so simple query protocol, no
  client transaction and no migration version being assigned.
  """
  use Electric.Postgres.Proxy.TestScenario

  def tags do
    [scenario: :manual, protocol: :simple, framework: false, tx: false, version: false]
  end

  def description do
    "Manual migration: [simple, no-tx, no-version]"
  end

  def tx?, do: false

  def assert_non_electrified_migration(injector, _framework, query, tag \\ random_tag()) do
    injector
    |> client(query(query), server: begin())
    |> server(complete_ready("BEGIN", :tx), server: query(query))
    |> server(complete_ready(tag, :tx), server: commit())
    |> server(complete_ready("COMMIT", :idle), client: [complete_ready(tag, :idle)])
    |> idle!()
  end

  def assert_injector_passthrough(injector, _framework, query, tag \\ random_tag()) do
    injector
    |> client(query(query))
    |> server(complete_ready(tag, :idle))
    |> idle!()
  end

  def assert_electrified_migration(injector, _framework, query) do
    {query, opts} =
      case query do
        sql when is_binary(sql) ->
          {sql, []}

        [sql] when is_binary(sql) ->
          {sql, []}

        {sql, opts} when is_binary(sql) ->
          {sql, opts}

        [_ | _] ->
          raise ArgumentError, message: "Manual migration does not support multiple queries"
      end

    tag = random_tag()

    injector
    |> client(query(query), server: begin())
    |> server(complete_ready("BEGIN", :tx),
      server: query(query)
    )
    |> server(complete_ready(tag, :tx),
      server: capture_ddl_query(query),
      client: [
        capture_notice(query)
      ]
    )
    |> shadow_add_column(capture_ddl_complete(), opts, server: capture_version_query(0))
    |> server(capture_version_complete(), server: commit())
    |> server(complete_ready("COMMIT", :idle), client: [complete_ready(tag, :idle)])
    |> idle!()
  end

  def assert_injector_error(injector, query, error_details) do
    injector
    |> client(query(query), client: [error(error_details), ready(:failed)])
    |> idle!()
  end

  def assert_valid_electric_command(injector, _framework, query, opts \\ []) do
    {:ok, command} = DDLX.parse(query)

    # may not be used but needs to be valid sql
    ddl = Keyword.get(opts, :ddl, "CREATE TABLE _not_used_ (id uuid PRIMARY KEY)")

    injector
    |> client(query(query), server: begin())
    |> electric(
      [server: complete_ready("BEGIN", :tx)],
      command,
      ddl,
      server: capture_version_query()
    )
    |> server(capture_version_complete(),
      server: commit()
      # client: complete(DDLX.Command.tag(command))
    )
    |> server(complete_ready("COMMIT", :idle),
      client: complete_ready(DDLX.Command.tag(command), :idle)
    )
    |> idle!()
  end

  def assert_electrify_server_error(injector, _framework, query, ddl, error_details) do
    # assert that the electrify command only generates a single query
    {:ok, command} = DDLX.parse(query)
    tables = Electric.DDLX.Command.table_names(command)
    introspect_query = introspect_tables_query(tables)

    [electrify | _rest] =
      command
      |> proxy_sql(ddl)
      |> Enum.map(&query/1)

    injector
    |> client(query(query), server: begin())
    |> server(complete_ready("BEGIN", :tx), server: introspect_query)
    |> server(introspect_result(ddl), server: electrify)
    |> server([error(error_details), ready(:failed)], server: rollback())
    |> server(complete_ready("ROLLBACK", :idle), client: [error(error_details), ready(:failed)])
    |> idle!()
  end
end
