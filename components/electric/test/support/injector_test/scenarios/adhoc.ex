defmodule Electric.Postgres.Proxy.TestScenario.AdHoc do
  @moduledoc """
  Captures the scenario where migrations are being run in a transaction, using
  the extended protocol but with no versioning system.
  """

  use Electric.Postgres.Proxy.TestScenario

  def tags do
    [scenario: :adhoc, protocol: :extended, framework: false, tx: true, version: false]
  end

  def description do
    "adhoc migration: [extended, tx]"
  end

  def tx?, do: true

  def assert_non_electrified_migration(injector, _framework, query) do
    tag = random_tag()

    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> client(parse_describe(query))
    |> server(parse_describe_complete())
    |> client(bind_execute())
    |> server(bind_execute_complete(tag))
    |> client(commit())
    |> server(complete_ready("COMMIT", :idle))
    |> idle!()
  end

  def assert_injector_passthrough(injector, framework, query) do
    assert_non_electrified_migration(injector, framework, query)
  end

  def assert_electrified_migration(injector, _framework, queries) do
    queries = List.wrap(queries)

    injector =
      injector
      |> client(query("BEGIN"))
      |> server(complete_ready("BEGIN"))

    queries
    |> Enum.reduce(injector, &execute_tx_sql(&1, &2, :extended))
    |> client(commit(), server: capture_version_query())
    |> server(capture_version_complete(), server: commit())
    |> server(complete_ready("COMMIT", :idle))
    |> idle!()
  end

  def assert_injector_error(injector, _framework, query, error_details) do
    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> client(parse_describe(query), client: [error(error_details), ready(:failed)])
    |> client(rollback())
    |> server(complete_ready("ROLLBACK", :idle))
    |> idle!()
  end

  def assert_valid_electric_command(injector, _framework, query) do
    {:ok, command} = DDLX.ddlx_to_commands(query)

    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> client(parse_describe(query), client: parse_describe_complete(), server: [])
    |> electric([client: bind_execute()], command,
      client: bind_execute_complete(DDLX.Command.tag(command))
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
    |> client(parse_describe(query), client: parse_describe_complete())
    |> client(bind_execute(), server: electrify)
    |> server([error(error_details), ready(:failed)])
    |> client(rollback())
    |> server(complete_ready("ROLLBACK", :idle))
    |> idle!()
  end
end
