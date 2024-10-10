defmodule Electric.Client.MixProject do
  use Mix.Project

  def project do
    [
      app: :electric_client,
      version: "0.1.0",
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      docs: docs(),
      package: package(),
      description: description(),
      source_url: "https://github.com/electric-sql/electric/tree/main/packages/elixir-client",
      homepage_url: "https://electric-sql.com"
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  def application do
    [
      extra_applications: [:logger],
      mod: {Electric.Client.Application, []}
    ]
  end

  defp deps do
    [
      {:ecto_sql, "~> 3.12", optional: true},
      {:gen_stage, "~> 1.2", optional: true},
      {:jason, "~> 1.4"},
      {:nimble_options, "~> 1.1"},
      {:req, "~> 0.5"}
    ] ++ deps_for(Mix.env())
  end

  defp deps_for(:test) do
    [
      {:bypass, "~> 2.1", only: [:test]},
      {:postgrex, "~> 0.19", only: [:test]},
      {:postgresql_uri, "~> 0.1", only: [:test]},
      {:uuid, "~> 1.1", only: [:test]}
    ]
  end

  defp deps_for(:dev) do
    [
      {:ex_doc, ">= 0.0.0", only: :dev, runtime: false}
    ]
  end

  defp deps_for(_), do: []

  defp docs do
    [
      main: "Electric.Client"
    ]
  end

  defp package do
    [
      links: %{
        "Electric SQL" => "https://electric-sql.com"
      },
      licenses: ["Apache-2.0"]
    ]
  end

  defp description do
    "Elixir client for ElectricSQL"
  end
end
