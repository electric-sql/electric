defmodule CloudElectric.MixProject do
  use Mix.Project

  def project do
    [
      app: :cloud_electric,
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
      mod: {CloudElectric.Application, []}
    ]
  end

  # Run "mix help deps" to learn about dependencies.
  defp deps do
    [
      {:electric, path: "../sync-service"},
      {:bandit, "~> 1.5"},
      {:plug, "~> 1.16"}
    ]
  end
end
