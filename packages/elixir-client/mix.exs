defmodule Electric.Client.MixProject do
  use Mix.Project

  @github_repo "https://github.com/electric-sql/electric"

  # Project version is obtained by evaluating version.exs in development. Before publishing to
  # hex.pm, the line below is replaced with a static version string via the
  # `mix:write-static-version` script in package.json.
  {version, _bindings} = Code.eval_file("version.exs")
  @version version || "0.0.0"
  @docs_source_ref_version version || "main"

  def project do
    [
      app: :electric_client,
      version: @version,
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      name: "Electric Client",
      description: description(),
      docs: docs(),
      package: package(),
      source_url: "#{@github_repo}/tree/main/packages/elixir-client",
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
    tag = URI.encode("@core/elixir-client@#{@docs_source_ref_version}", &(&1 != ?@))

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
end
