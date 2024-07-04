defmodule Electric.MixProject do
  use Mix.Project

  def project do
    [
      app: :electric,
      version: "0.1.0",
      elixir: "~> 1.17",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      aliases: aliases(),
      releases: [
        electric: [
          applications: [
            electric: :permanent
          ],
          include_executables_for: [:unix]
        ]
      ],
      default_release: :electric
    ]
  end

  # Run "mix help compile.app" to learn about applications.
  def application do
    [
      extra_applications: [:logger],
      mod: {Electric.Application, []}
    ]
  end

  defp deps do
    [
      {:bandit, "~> 1.5"},
      {:plug, "~> 1.16"},
      {:gen_stage, "~> 1.2"},
      {:epgsql, "~> 4.2"},
      {:backoff, "~> 1.1"},
      {:gproc, "~> 0.9"},
      {:postgrex, "~> 0.18"},
      {:postgresql_uri, "~> 0.1"},
      {:jason, "~> 1.4"},
      {:nimble_options, "~> 1.1"},
      {:dotenvy, "~> 0.8"},
      {:telemetry_poller, "~> 1.1"},
      {:telemetry_metrics_statsd, "~> 0.7"},
      {:ecto, "~> 3.11"}
    ]
  end

  defp aliases() do
    [
      start_dev: "cmd --cd dev docker compose up -d",
      stop_dev: "cmd --cd dev docker compose down -v"
    ]
  end
end
