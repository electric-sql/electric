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
            electric: :permanent,
            opentelemetry: :temporary,
            opentelemetry_exporter: :permanent
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

  def application do
    [
      extra_applications: [:logger, :tls_certificate_check],
      mod: {Electric.Application, []}
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    List.flatten([
      [
        {:backoff, "~> 1.1"},
        {:bandit, "~> 1.5"},
        {:cubdb, "~> 2.0.2"},
        {:dotenvy, "~> 0.8"},
        {:ecto, "~> 3.11"},
        {:gen_stage, "~> 1.2"},
        {:jason, "~> 1.4"},
        {:nimble_options, "~> 1.1"},
        {:opentelemetry, "~> 1.4"},
        {:opentelemetry_exporter, "~> 1.6"},
        {:pg_query_ex, github: "electric-sql/pg_query_ex"},
        {:plug, "~> 1.16"},
        {:postgrex, "~> 0.19"},
        {:telemetry_metrics_prometheus_core, "~> 1.1"},
        {:telemetry_metrics_statsd, "~> 0.7"},
        {:telemetry_poller, "~> 1.1"},
        {:tls_certificate_check, "~> 1.23"},
        {:tz, "~> 0.27"}
      ],
      dev_and_test_deps()
    ])
  end

  defp dev_and_test_deps do
    [
      {:dialyxir, "~> 1.4", only: [:test], runtime: false},
      {:excoveralls, "~> 0.18", only: [:test], runtime: false},
      {:mox, "~> 1.1", only: [:test]}
    ]
  end

  defp aliases() do
    [
      start_dev: "cmd --cd dev docker compose up -d",
      stop_dev: "cmd --cd dev docker compose down -v"
    ]
  end

  defp version do
    with :error <- version_from_env(),
         :error <- version_from_package_json() do
      "0.0.0"
    end
  end

  defp version_from_env do
    with {:ok, version} <- System.fetch_env("ELECTRIC_VERSION"),
         trimmed = String.trim(version),
         {:ok, _} <- Version.parse(trimmed) do
      trimmed
    end
  end

  defp version_from_package_json do
    case File.read("./package.json") do
      {:ok, binary} -> binary |> :json.decode() |> Map.fetch!("version")
      {:error, _} -> :error
    end
  end
end
