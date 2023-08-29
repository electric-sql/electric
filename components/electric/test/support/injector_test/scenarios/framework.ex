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

  def assert_non_electrified_migration(injector, query, tag \\ random_tag()) do
    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> client(parse_describe(query))
    |> server(parse_describe_complete())
    |> client(bind_execute())
    |> server(bind_execute_complete(tag))
    |> assign_migration_version("20230822143453")
    |> client(commit())
    |> server(complete_ready("COMMIT", :idle))
    |> idle!()
  end

  def assert_electrified_migration(injector, queries) do
    queries = List.wrap(queries)

    injector =
      injector
      |> client(query("BEGIN"))
      |> server(complete_ready("BEGIN"))

    queries
    |> Enum.reduce(injector, &execute_tx_sql(&1, &2, :extended))
    |> assert_capture_migration_version("20230822143453")
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

  def assert_valid_electric_command(injector, query) do
    {:ok, command} = DDLX.ddlx_to_commands(query)

    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> client(parse_describe(query), client: parse_describe_complete(), server: [])
    |> electric(bind_execute(), command, bind_execute_complete(DDLX.Command.tag(command)))
    |> assert_capture_migration_version("20230822143453")
    |> client(commit())
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
    |> client(parse_describe(query), client: parse_describe_complete())
    |> client(bind_execute(), server: electrify)
    |> server([error(error_details), ready(:failed)])
    |> client(rollback())
    |> server(complete_ready("ROLLBACK", :idle))
    |> idle!()
  end
end
