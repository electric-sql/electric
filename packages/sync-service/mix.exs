defmodule Electric.MixProject do
  use Mix.Project

  @github_repo "https://github.com/electric-sql/electric"

  # Application and Stack telemetry are enabled when Mix target is set to this value,
  # e.g. via `MIX_TARGET=application` environment variable.
  @telemetry_target :application

  # make the metrics-enabled target available to the rest of the app
  def telemetry_target, do: @telemetry_target

  # Necessary boilerplate because opentelemetry doesn't mention opentelemetry_exporter in
  # its list of dependency but actually expects it to be started before itself at runtime.
  if Mix.target() == @telemetry_target do
    @extra_telemetry_applications [:opentelemetry_exporter]

    @telemetry_applications_in_release [
      opentelemetry_exporter: :permanent,
      opentelemetry: :temporary
    ]
  else
    @extra_telemetry_applications []
    @telemetry_applications_in_release []
  end

  def project do
    [
      app: :electric,
      version: version(),
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      aliases: aliases(),
      releases: [
        electric: [
          applications: @telemetry_applications_in_release,
          include_executables_for: [:unix]
        ]
      ],
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
      dialyzer: [
        plt_add_apps: [:mix, :ex_unit],
        check_plt: true
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
      extra_applications: [:logger, :runtime_tools] ++ @extra_telemetry_applications,
      mod: {Electric.Application, []}
    ]
  end

  def cli do
    [
      preferred_envs: [
        dialyzer: :test,
        coveralls: :test,
        "coveralls.detail": :test,
        "coveralls.post": :test,
        "coveralls.html": :test,
        "coveralls.cobertura": :test,
        "coveralls.lcov": :test
      ]
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    List.flatten([
      [
        {:backoff, "~> 1.1"},
        {:bandit, "~> 1.6"},
        {:dotenvy, "~> 1.1"},
        {:ecto, "~> 3.12"},
        {:exqlite, "~> 0.33"},
        {:ex_sqlean, "~> 0.8.7"},
        {:jason, "~> 1.4"},
        {:nimble_options, "~> 1.1"},
        {:nimble_pool, "~> 1.1"},
        {:opentelemetry_telemetry, "~> 1.1"},
        {:opentelemetry_semantic_conventions, "~> 1.27"},
        {:pg_query_ex, "0.9.0"},
        {:plug, "~> 1.17"},
        {:postgrex, "~> 0.20"},
        {:retry, "~> 0.19"},
        {:remote_ip, "~> 1.2"},
        {:req, "~> 0.5"},
        {:stream_split, "~> 0.1"},
        {:tz, "~> 0.28"}
      ],
      dev_and_test_deps(),
      telemetry_deps(Mix.target())
    ])
  end

  defp dev_and_test_deps do
    [
      {:dialyxir, "~> 1.4", only: [:test], runtime: false},
      {:excoveralls, "~> 0.18", only: [:test], runtime: false},
      {:junit_formatter, "~> 3.4", only: [:test], runtime: false},
      {:ex_doc, ">= 0.0.0", only: :dev, runtime: false},
      {:stream_data, "~> 1.2", only: [:dev, :test]},
      {:repatch, "~> 1.0", only: [:test]},
      {:electric_client, path: "../elixir-client", only: [:test], runtime: false}
    ]
  end

  # Only include telemetry deps when building for the telemetry target.
  # This avoids issues with hex.pm when the deps include path dependencies or overrides
  # that would otherwise prevent package building.
  defp telemetry_deps(@telemetry_target) do
    [
      {:electric_telemetry, path: "../electric-telemetry"},
      {:opentelemetry, "~> 1.6"},
      {:opentelemetry_exporter, "~> 1.10.0"},
      # Pin protobuf to v0.13.x because starting with v0.14.0 it includes modules that conflict
      # with those of Protox (which itself is brought in by pg_query_ex).
      {:protobuf, "~> 0.13.0", override: true},
      {:sentry, "~> 11.0"}
    ]
  end

  defp telemetry_deps(_), do: []

  defp aliases do
    [
      start_dev: "cmd --cd dev docker compose up -d",
      stop_dev: "cmd --cd dev docker compose down -v",
      clean_persistent: "cmd rm -rf persistent",
      reset: "do clean_persistent + stop_dev + start_dev"
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
      },
      files: ~w(lib .formatter.exs mix.exs README.md CHANGELOG.md LICENSE package.json)
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
