defmodule Electric.Client.MixProject do
  use Mix.Project

  def project do
    [
      app: :electric_client,
      version: version(),
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      name: "Electric Client",
      description: description(),
      docs: docs(),
      package: package(),
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
      {:ex_doc, ">= 0.0.0", only: :dev, runtime: false},
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false}
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
      licenses: ["Apache-2.0"],
      files: ~w(lib .formatter.exs mix.exs README.md LICENSE package.json)
    ]
  end

  defp description do
    "Elixir client for ElectricSQL"
  end

  defp version do
    with :error <- version_from_env(),
         :error <- version_from_package_json() do
      "0.0.0"
    end
  end

  defp version_from_env do
    with {:ok, version} <- System.fetch_env("ELECTRIC_CLIENT_VERSION"),
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
