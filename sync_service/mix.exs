defmodule Electric.MixProject do
  use Mix.Project

  def project do
    [
      app: :electric,
      version: "0.1.0",
      elixir: "~> 1.17",
      start_permanent: Mix.env() == :prod,
      deps: deps()
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
      {:jason, "~> 1.4"}
    ]
  end
end
