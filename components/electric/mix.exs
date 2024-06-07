defmodule Electric.MixProject do
  use Mix.Project

  def project do
    [
      app: :electric,
      version: version_from_git_or_env(),
      elixir: "~> 1.12",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      compilers: [:yecc] ++ Mix.compilers(),
      deps: deps(),
      test_coverage: [tool: ExCoveralls],
      preferred_cli_env: [
        coveralls: :test,
        "coveralls.lcov": :test,
        "coveralls.html": :test
      ],
      releases: [
        electric: [applications: [electric: :permanent], include_executables_for: [:unix]],
        ws_client: [
          applications: [electric: :load],
          include_executables_for: [:unix],
          runtime_config_path: false
        ]
      ],
      default_release: :electric
    ]
  end

  # Run "mix help compile.app" to learn about applications.
  def application do
    [
      mod: {Electric.Application, []},
      extra_applications: [:logger, :os_mon, :runtime_tools]
    ]
  end

  # Run "mix help deps" to learn about dependencies.
  defp deps do
    List.flatten([
      [
        {:backoff, "~> 1.1"},
        {:bandit, "~> 1.1"},
        {:dotenvy, "~> 0.8"},
        {:gen_stage, "~> 1.2"},
        {:gproc, "~> 1.0"},
        {:jason, "~> 1.4"},
        {:joken, "~> 2.6"},
        {:libgraph, "~> 0.16.0"},
        {:mint, "~> 1.5"},
        {:mint_web_socket, "~> 1.0"},
        {:nimble_parsec, "~> 1.4"},
        {:nimble_pool, "~> 1.0"},
        {:pathex, "~> 2.5.2"},
        {:pg_protocol, github: "electric-sql/pg_protocol"},
        {:pg_query_ex, github: "electric-sql/pg_query_ex"},
        {:protox, "~> 1.7"},
        {:req, "~> 0.4"},
        {:thousand_island, "~> 1.3"},
        {:timex, "~> 3.7"},
        {:tzdata, "~> 1.1"}
      ],
      database_deps(),
      dev_and_test_deps(),
      telemetry_deps()
    ])
  end

  defp database_deps do
    [
      {:ecto, "~> 3.11"},
      {:ecto_sql, "~> 3.11"},
      {:epgsql, "~> 4.2"},
      {:postgrex, "~> 0.17"}
    ]
  end

  defp dev_and_test_deps do
    [
      {:dialyxir, "~> 1.4", only: [:dev], runtime: false},
      {:excoveralls, "~> 0.18", only: :test, runtime: false},
      {:exqlite, "~> 0.19", only: [:dev, :test]},
      {:mock, "~> 0.3.0", only: :test},
      {:mox, "~> 1.1", only: :test},
      {:stream_data, "~> 1.0", only: [:dev, :test]}
    ]
  end

  defp telemetry_deps do
    [
      {:telemetry, "~> 1.2"},
      {:telemetry_metrics, "~> 1.0", override: true},
      {:telemetry_metrics_statsd, "~> 0.7"},
      {:telemetry_poller, "~> 1.1"}
    ]
  end

  # Specifies which paths to compile per environment.
  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp version_from_git_or_env() do
    with :error <- version_from_env(),
         :error <- version_from_git() do
      "0.0.0-local"
    else
      {:ok, version} -> version
    end
  end

  defp version_from_env() do
    with {:ok, version} <- System.fetch_env("ELECTRIC_VERSION"),
         trimmed = String.trim(version),
         {:ok, _} <- Version.parse(trimmed) do
      {:ok, trimmed}
    end
  end

  defp version_from_git() do
    case System.cmd(
           "git",
           ~w[describe --abbrev=7 --tags --always --first-parent --match @core/electric@*]
         ) do
      {"@core/electric@" <> untrimmed_version, 0} ->
        {:ok, String.trim(untrimmed_version)}

      {_, _error_code} ->
        :error
    end
  end
end
