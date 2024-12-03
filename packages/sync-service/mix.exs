defmodule Electric.MixProject do
  use Mix.Project

  @github_repo "https://github.com/electric-sql/electric"

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
            # This order of application is important to ensure proper startup sequence of
            # application dependencies, namely, inets.
            opentelemetry_exporter: :permanent,
            opentelemetry: :temporary
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
      ],
      description: description(),
      package: package(),
      docs: docs(),
      source_url: "#{@github_repo}/tree/main/packages/sync-service",
      homepage_url: "https://electric-sql.com"
    ]
  end

  def application do
    [
      extra_applications: [:logger, :tls_certificate_check, :os_mon, :runtime_tools],
      # Using a compile-time flag to select the application module or lack thereof allows
      # using this app as a dependency with this additional flag
      mod:
        application_mod(Mix.env(), Application.get_env(:electric, :start_in_library_mode, false))
    ]
  end

  # Empty application module for the test environment because there we skip setting up the root
  # supervision tree and instead start processes as needed for specific tests.
  defp application_mod(:test, _), do: []
  defp application_mod(_, true), do: []
  defp application_mod(_, _), do: {Electric.Application, []}

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
        {:opentelemetry, "~> 1.5"},
        {:opentelemetry_exporter, "~> 1.8"},
        {:opentelemetry_telemetry, "~> 1.1"},
        {:opentelemetry_semantic_conventions, "~> 1.27"},
        {:pg_query_ex, "0.5.3"},
        {:plug, "~> 1.16"},
        {:postgrex, "~> 0.19"},
        {:retry, "~> 0.18"},
        {:remote_ip, "~> 1.2"},
        {:req, "~> 0.5"},
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
      {:mox, "~> 1.1", only: [:test]},
      {:ex_doc, ">= 0.0.0", only: :dev, runtime: false}
    ]
  end

  defp aliases() do
    [
      start_dev: "cmd --cd dev docker compose up -d",
      stop_dev: "cmd --cd dev docker compose down -v"
    ]
  end

  defp version(default \\ "0.0.0") do
    with :error <- version_from_env(),
         :error <- version_from_package_json() do
      default
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

  defp description do
    "Postgres sync engine. Sync little subsets of your Postgres data into local apps and services. "
  end

  defp package do
    [
      licenses: ["Apache-2.0"],
      links: %{
        "Electric SQL" => "https://electric-sql.com",
        "Github" => @github_repo
      }
    ]
  end

  defp docs do
    version = version("main")
    tag = URI.encode("@core/sync-service@#{version}", &(&1 != ?@))

    [
      main: "readme",
      extras: ["README.md"],
      source_url_pattern: fn path, line ->
        "#{@github_repo}/tree/#{tag}/packages/sync-service/#{path}#L#{line}"
      end
    ]
  end
end
