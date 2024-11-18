defmodule CloudElectric.MixProject do
  use Mix.Project

  def project do
    [
      app: :cloud_electric,
      version: "0.1.0",
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  # Run "mix help compile.app" to learn about applications.
  def application do
    [
      extra_applications: [:logger],
      mod: if(Mix.env() == :test, do: [], else: {CloudElectric.Application, []})
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Run "mix help deps" to learn about dependencies.
  defp deps do
    [
      {:electric, path: "../sync-service"},
      {:dotenvy, "~> 0.8"},
      {:bandit, "~> 1.5"},
      {:plug, "~> 1.16"},
      {:req, "~> 0.5"}
    ]
  end
end
