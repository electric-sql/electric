defmodule Electric.Postgres.Proxy.TestScenario.Framework do
  @moduledoc """
  Describes migrations being executed by a framework, with transactions,
  versions and the extended, parse-bind-execute, protocol is being used.
  """
  use Electric.Postgres.Proxy.TestScenario

  def tags do
    [scenario: :framework, protocol: :extended, framework: true, tx: true, version: true]
  end

  def description do
    "Framework migration: [extended, tx, version]"
  end

  def tx?, do: true

  def assert_non_electrified_migration(injector, framework, query) do
    tag = random_tag()

    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> client(parse_describe(query))
    |> server(parse_describe_complete())
    |> client(bind_execute())
    |> server(bind_execute_complete(tag))
    |> framework.assign_migration_version("20230822143453")
    |> client(commit())
    |> server(complete_ready("COMMIT", :idle))
    |> idle!()
  end

  def assert_injector_passthrough(injector, framework, query) do
    assert_non_electrified_migration(injector, framework, query)
  end

  def assert_electrified_migration(injector, framework, queries) do
    queries = List.wrap(queries)
    version = random_version()

    injector =
      injector
      |> client(query("BEGIN"))
      |> server(complete_ready("BEGIN"))

    queries
    |> Enum.reduce(injector, &execute_tx_sql(&1, &2, :extended))
    |> framework.capture_migration_version(version)
    |> client(commit())
    |> server(complete_ready("COMMIT", :idle))
    |> idle!()
  end

  def assert_injector_error(injector, query, error_details) do
    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> client(parse_describe(query), client: [error(error_details), ready(:failed)])
    |> client(rollback())
    |> server(complete_ready("ROLLBACK", :idle))
    |> idle!()
  end

  def assert_valid_electric_command(injector, framework, query) do
    {:ok, command} = DDLX.parse(query)
    version = random_version()

    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> client(parse_describe(query), client: parse_describe_complete(), server: [])
    |> electric([client: bind_execute()], command,
      client: bind_execute_complete(DDLX.Command.tag(command))
    )
    |> framework.capture_migration_version(version)
    |> client(commit())
    |> server(complete_ready("COMMIT", :idle))
    |> idle!()
  end

  def assert_electrify_server_error(injector, _framework, query, error_details) do
    # assert that the electrify command only generates a single query
    {:ok, command} = DDLX.parse(query)
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
