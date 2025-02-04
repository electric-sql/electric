defmodule Electric.Phoenix.MixProject do
  use Mix.Project

  @github_repo "https://github.com/electric-sql/electric"

  def project do
    [
      app: :electric_phoenix,
      version: version(),
      elixir: "~> 1.17",
      start_permanent: Mix.env() == :prod,
      elixirc_paths: elixirc_paths(Mix.env()),
      consolidate_protocols: Mix.env() in [:dev, :prod],
      deps: deps(),
      name: "Electric Phoenix",
      docs: docs(),
      package: package(),
      description: description(),
      source_url: "#{@github_repo}/tree/main/packages/electric-phoenix",
      homepage_url: "https://electric-sql.com"
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Run "mix help compile.app" to learn about applications.
  def application do
    [
      extra_applications: [:logger],
      mod: {Electric.Phoenix.Application, []}
    ]
  end

  # Run "mix help deps" to learn about dependencies.
  defp deps do
    [
      {:electric_client, "0.2.6-beta.1"},
      {:nimble_options, "~> 1.1"},
      {:phoenix_live_view, "~> 1.0"},
      {:plug, "~> 1.0"},
      {:jason, "~> 1.0"},
      {:ecto_sql, "~> 3.10", optional: true},
      {:ex_doc, ">= 0.0.0", only: :dev, runtime: false},
      {:floki, "~> 0.36", only: [:test]}
    ]
  end

  defp docs do
    version = version("main")
    tag = URI.encode("@core/electric-phoenix@#{version}", &(&1 != ?@))

    [
      main: "Electric.Phoenix",
      source_url_pattern: fn path, line ->
        "#{@github_repo}/tree/#{tag}/packages/electric-phoenix/#{path}#L#{line}"
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
    "A work-in-progress adapter to integrate Electric SQL's streaming updates into Phoenix."
  end

  defp version(default \\ "0.0.0") do
    with :error <- version_from_env(),
         :error <- version_from_package_json() do
      default
    end
  end

  defp version_from_env do
    with {:ok, version} <- System.fetch_env("ELECTRIC_PHOENIX_VERSION"),
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
