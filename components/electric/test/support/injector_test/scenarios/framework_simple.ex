defmodule Electric.Postgres.Proxy.TestScenario.FrameworkSimple do
  @moduledoc """
  Describes an edge-case migration scenario, where migrations are being run
  within a transaction and migration versions are being supplied but the simple
  protocol, query->response, is being used.
  """
  use Electric.Postgres.Proxy.TestScenario

  alias Electric.DDLX

  def tags do
    [scenario: :framework_simple, protocol: :simple, framework: true, tx: true, version: true]
  end

  def description do
    "simple protocol, client transaction, assigned migration version"
  end

  def tx?, do: true

  def assert_non_electrified_migration(injector, query, tag \\ random_tag()) do
    injector
    |> client(query("BEGIN"))
    |> server(complete_ready("BEGIN"))
    |> client(query(query))
    |> server(complete_ready(tag))
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
    |> Enum.reduce(injector, &execute_tx_sql(&1, &2, :simple))
    |> assert_capture_migration_version("20230822143453")
    |> client(commit())
    |> server(complete_ready("COMMIT", :idle))
    |> idle!()
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
    |> client(query(query), server: electrify)
    |> server([error(error_details), ready(:failed)])
    |> client(rollback())
    |> server(complete_ready("ROLLBACK", :idle))
    |> idle!()
  end

  # Don't think I need to special case errors caused by an invalid ddlx statements
  # def electrify_injector_error(injector, query) do
  #   injector_error(injector, query, [])
  #   # injector
  #   # |> client(query("BEGIN"))
  #   # |> server(complete_ready("BEGIN"))
  #   # |> client(query(query), server: electrify)
  #   # |> server([error(message: "table truths already electrified"), ready(:failed)])
  #   # |> client(rollback())
  #   # |> server(complete_ready("ROLLBACK", :idle))
  #   # |> idle!()
  # end
end
