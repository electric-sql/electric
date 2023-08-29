defmodule Electric.Postgres.Proxy.TestScenario.ManualTx do
  @moduledoc """
  Describes migrations being done within psql, so simple query protocol and no
  framework-assigned version, but with an explicit transaction
  """

  use Electric.Postgres.Proxy.TestScenario

  def tags do
    [scenario: :manual, protocol: :simple, framework: false, tx: true, version: false]
  end

  def description do
    "manual migration in tx: [simple, tx, no-version]"
  end

  def tx?, do: true

  def assert_non_electrified_migration(injector, query, tag \\ random_tag()) do
    injector
    |> client(query(query), server: begin())
    |> server(complete_ready("BEGIN", :tx), server: query(query))
    |> server(complete_ready(tag, :tx), server: commit(), client: complete(tag))
    |> server(complete_ready("COMMIT", :idle), client: ready(:idle))
    |> idle!()
  end

  def assert_electrified_migration(injector, queries) do
    queries = List.wrap(queries)

    injector =
      injector
      |> client(query("BEGIN"))
      |> server(complete_ready("BEGIN"))

    queries
    |> Enum.reduce(injector, &execute_sql/2)
    |> client(commit(), server: capture_version_query())
    |> server(capture_version_complete(), server: commit())
    |> server(complete_ready("COMMIT", :idle))
    |> idle!()
  end

  defp execute_sql({:passthrough, query}, injector) do
    injector
    |> client(query(query))
    |> server(complete_ready())
  end

  defp execute_sql({:electric, query}, injector) do
    {:ok, command} = DDLX.ddlx_to_commands(query)

    injector
    |> electric(query(query), command, complete_ready(DDLX.Command.tag(command)))
  end

  defp execute_sql({:capture, query}, injector) do
    tag = random_tag()

    injector
    |> client(query(query))
    |> server(complete_ready(tag), server: capture_ddl_query(query))
    |> server(capture_ddl_complete(), client: complete_ready(tag))
  end

  defp execute_sql(sql, injector) when is_binary(sql) do
    execute_sql({:capture, sql}, injector)
  end

  def assert_injector_error(injector, query, error_details) do
    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> client(query(query), client: [error(error_details), ready(:failed)])
    |> client(rollback())
    |> server(complete_ready("ROLLBACK", :idle))
    |> idle!()
  end

  def assert_valid_electric_command(injector, query) do
    {:ok, command} = DDLX.ddlx_to_commands(query)

    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> electric(query(query), command, complete_ready(DDLX.Command.tag(command)))
    |> client(commit(), server: capture_version_query())
    |> server(capture_version_complete(), server: commit())
    |> server(complete_ready("COMMIT", :idle))
    |> idle!()
  end

  def assert_electrify_server_error(injector, query, error_details) do
    # assert that the electrify command only generates a single query
    {:ok, command} = DDLX.ddlx_to_commands(query)
    [electrify] = Electric.DDLX.Command.pg_sql(command) |> Enum.map(&query/1)

    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> client(query(query), server: electrify)
    |> server([error(error_details), ready(:failed)])
    |> client(rollback())
    |> server(complete_ready("ROLLBACK", :idle))
    |> idle!()
  end
end
