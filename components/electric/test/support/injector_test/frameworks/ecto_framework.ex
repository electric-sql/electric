defmodule Electric.Proxy.InjectorTest.EctoFramework do
  use Electric.Postgres.Proxy.TestScenario

  def description, do: "ecto"
  def tags, do: [framework: :ecto, ecto: true]

  def capture_migration_version(injector, version) do
    injector
    |> bind_execute_version_query(version)
    |> server(bind_execute_complete("INSERT 0 1"), server: [capture_version_query(version)])
    |> server(capture_version_complete(), client: bind_execute_complete("INSERT 0 1"))
  end

  # as above but the version is not captured by electric
  def assign_migration_version(injector, version) do
    injector
    |> bind_execute_version_query(version)
    |> server(bind_execute_complete("INSERT 0 1"))
  end

  @query "INSERT INTO public.schema_migrations (version, inserted_at) VALUES ($1, $2)"

  defp bind_execute_version_query(injector, version) do
    name = "ecto_insert_schema_migrations_#{System.unique_integer([:monotonic, :positive])}"

    injector
    |> client(parse_describe(@query, name))
    |> server(parse_describe_complete(params: [20, 114]))
    |> client(
      bind_execute(name,
        bind: [
          parameter_format_codes: [1, 1],
          parameters: Enum.map([to_integer(version), DateTime.utc_now()], &version_pg/1)
        ]
      )
    )
  end

  defp to_integer(s) when is_binary(s), do: String.to_integer(s)
  defp to_integer(i) when is_integer(i), do: i
end
