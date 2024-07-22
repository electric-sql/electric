defmodule Electric.MixProject do
  use Mix.Project

  def project do
    [
      app: :electric,
      version: version(),
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      aliases: aliases(),
      preferred_cli_env: [
        dialyzer: :test,
        coveralls: :test,
        "coveralls.detail": :test,
        "coveralls.post": :test,
        "coveralls.html": :test,
        "coveralls.cobertura": :test,
        "coveralls.lcov": :test
      ],
      releases: [
        electric: [
          applications: [
            electric: :permanent
          ],
          include_executables_for: [:unix]
        ]
      ],
      default_release: :electric,
      test_coverage: [
        tool: ExCoveralls,
        ignore_modules: [
          Electric,
          Electric.Telemetry,
          Electric.Postgres.ReplicationClient.State,
          ~r/Electric.Postgres.LogicalReplication.Messages.*/,
          ~r/^Support.*/
        ]
      ]
    ]
  end

  # Run "mix help compile.app" to learn about applications.
  def application do
    [
      extra_applications: [:logger],
      mod: {Electric.Application, []}
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    List.flatten([
      [
        {:bandit, "~> 1.5"},
        {:plug, "~> 1.16"},
        {:gen_stage, "~> 1.2"},
        {:epgsql, "~> 4.2"},
        {:backoff, "~> 1.1"},
        {:gproc, "~> 0.9"},
        {:postgrex, "~> 0.18"},
        {:postgresql_uri, "~> 0.1"},
        {:pg_query_ex, github: "electric-sql/pg_query_ex"},
        {:jason, "~> 1.4"},
        {:nimble_options, "~> 1.1"},
        {:dotenvy, "~> 0.8"},
        {:telemetry_poller, "~> 1.1"},
        {:telemetry_metrics_statsd, "~> 0.7"},
        {:ecto, "~> 3.11"},
        {:tz, "~> 0.26.5"},
        {:cubdb, "~> 2.0.2"}
      ],
      dev_and_test_deps()
    ])
  end

  defp dev_and_test_deps do
    [
      {:mox, "~> 1.1", only: [:test]},
      {:dialyxir, "~> 1.4", only: [:test], runtime: false},
      {:excoveralls, "~> 0.18", only: [:test], runtime: false}
    ]
  end

  defp aliases() do
    [
      start_dev: "cmd --cd dev docker compose up -d",
      stop_dev: "cmd --cd dev docker compose down -v"
    ]
  end

  defp version() do
    case File.read("./package.json") do
      {:ok, binary} -> binary |> :json.decode() |> Map.fetch!("version")
      {:error, _} -> "0.0.0"
    end
  end
end
