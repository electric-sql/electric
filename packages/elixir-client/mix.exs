defmodule Electric.Client.MixProject do
  use Mix.Project

  @github_repo "https://github.com/electric-sql/electric"

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
      source_url: "#{@github_repo}/tree/main/packages/elixir-client",
      homepage_url: "https://electric-sql.com",
      test_coverage: [
        tool: ExCoveralls,
        ignore_modules: [
          ~r/^Support.*/
        ]
      ]
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

  defp deps do
    [
      {:electric, "~> 1.1.11 or ~> 1.2.4 or ~> 1.3.3", optional: true},
      {:ecto_sql, "~> 3.12", optional: true},
      {:gen_stage, "~> 1.2", optional: true},
      {:jason, "~> 1.4"},
      {:nimble_options, "~> 1.1"},
      {:req, "~> 0.5"},
      {:bypass, "~> 2.1", only: [:test]},
      {:postgrex, "~> 0.19", only: [:dev, :test], override: true},
      {:postgresql_uri, "~> 0.1", only: [:test]},
      {:uuid, "~> 1.1", only: [:test]},
      {:ecto_ulid, "~> 0.3", only: [:test]},
      {:ex_doc, ">= 0.0.0", only: :dev, runtime: false},
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false},
      {:excoveralls, "~> 0.18", only: [:test], runtime: false},
      {:junit_formatter, "~> 3.4", only: [:test], runtime: false}
    ]
  end

  defp docs do
    version = version("main")
    tag = URI.encode("@core/elixir-client@#{version}", &(&1 != ?@))

    [
      main: "Electric.Client",
      source_url_pattern: fn path, line ->
        "#{@github_repo}/tree/#{tag}/packages/elixir-client/#{path}#L#{line}"
      end
    ]
  end

  defp package do
    [
      links: %{
        "Electric SQL" => "https://electric-sql.com",
        "Github" => @github_repo
      },
      licenses: ["Apache-2.0"],
      files: ~w(lib .formatter.exs mix.exs README.md LICENSE package.json)
    ]
  end

  defp description do
    "Elixir client for ElectricSQL"
  end

  defp version(default \\ "0.0.0") do
    with :error <- version_from_env(),
         :error <- version_from_package_json() do
      default
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
