defmodule Electric.MixProject do
  use Mix.Project

  def project do
    [
      app: :electric,
      version: version_from_git_or_env(),
      elixir: "~> 1.12",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      dialyzer: [ignore_warnings: "dialyzer.ignore-warnings"],
      test_coverage: [tool: ExCoveralls],
      preferred_cli_env: [
        coveralls: :test,
        "coveralls.lcov": :test,
        "coveralls.html": :test
      ],
      releases: [
        electric: [applications: [electric: :permanent], include_executables_for: [:unix]],
        ws_client: [
          applications: [electric: :load, gun: :permanent],
          include_executables_for: [:unix],
          # Cannot be set to `false` until 1.14, so we're using an empty file
          runtime_config_path: "config/ws_client_runtime.exs"
        ]
      ],
      default_release: :electric
    ]
  end

  # Run "mix help compile.app" to learn about applications.
  def application do
    [
      mod: {Electric.Application, []},
      extra_applications: [:logger]
    ]
  end

  # Run "mix help deps" to learn about dependencies.
  defp deps do
    [
      {:epgsql, "~> 4.2"},
      {:backoff, "~> 1.1"},
      {:mox, "~> 1.0.2"},
      {:mock, "~> 0.3.0", only: :test},
      {:postgresql_uri, "~> 0.1.0"},
      {:plug_cowboy, "~> 2.0"},
      {:ranch, "~> 2.1", override: true},
      {:jason, "~> 1.3.0"},
      {:recon_ex, "~> 0.9.1"},
      {:dialyxir, "~> 1.2.0", only: [:dev], runtime: false},
      {:excoveralls, "~> 0.14", only: :test, runtime: false},
      {:gproc, "~> 0.9.0"},
      {:protox, "~> 1.7"},
      {:gun, "~> 2.0"},
      {:cowboy, "~> 2.9"},
      {:gen_stage, "~> 1.1.2"},
      {:telemetry, "~> 1.1", override: true},
      {:telemetry_poller, "~> 1.0"},
      {:telemetry_metrics, "~> 0.6"},
      {:telemetry_metrics_prometheus, "~> 1.1.0"},
      {:joken, "~> 2.6"},
      {:ets, "~> 0.9.0"},
      {:stream_data, "~> 0.5", only: [:dev, :test]},
      {:exqlite, "~> 0.13.5", only: [:dev, :test]},
      {:tzdata, "~> 1.1", only: [:dev, :test]},
      {:pg_query_ex, github: "electric-sql/pg_query_ex"}
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
    case System.cmd("git", ~w[describe --abbrev=7 --tags --always --first-parent]) do
      {untrimmed_version, 0} ->
        {:ok, String.trim(untrimmed_version)}

      {_, _error_code} ->
        :error
    end
  end
end
