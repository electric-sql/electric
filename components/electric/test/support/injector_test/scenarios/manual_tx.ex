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

  def assert_non_electrified_migration(injector, _framework, query) do
    tag = random_tag()

    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> client(query(query))
    |> server(complete_ready(tag, :tx))
    |> client(commit())
    |> server(complete_ready("COMMIT", :idle))
    |> idle!()
  end

  def assert_electrified_migration(injector, _framework, queries) do
    queries = List.wrap(queries)

    injector =
      injector
      |> client(query("BEGIN"))
      |> server(complete_ready("BEGIN"))

    queries
    |> Enum.reduce(injector, &execute_tx_sql(&1, &2, :simple))
    |> client(commit(), server: capture_version_query())
    |> server(capture_version_complete(), server: commit())
    |> server(complete_ready("COMMIT", :idle))
    |> idle!()
  end

  def assert_injector_error(injector, _framework, query, error_details) do
    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> client(query(query), client: [error(error_details), ready(:failed)])
    |> client(rollback())
    |> server(complete_ready("ROLLBACK", :idle))
    |> idle!()
  end

  def assert_valid_electric_command(injector, _framework, query) do
    {:ok, command} = DDLX.ddlx_to_commands(query)

    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> electric([client: query(query)], command,
      client: complete_ready(DDLX.Command.tag(command))
    )
    |> client(commit(), server: capture_version_query())
    |> server(capture_version_complete(), server: commit())
    |> server(complete_ready("COMMIT", :idle))
    |> idle!()
  end

  def assert_electrify_server_error(injector, _framework, query, error_details) do
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
