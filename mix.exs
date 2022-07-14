defmodule Electric.MixProject do
  use Mix.Project

  def project do
    [
      app: :electric,
      version: "0.1.0",
      elixir: "~> 1.12",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      deps: deps()
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
      {:vax, git: "https://github.com/vaxine-io/vaxine.git", sparse: "apps/vax"},
      {:antidote_pb_codec,
       git: "https://github.com/vaxine-io/vaxine.git",
       sparse: "apps/antidote_pb_codec",
       override: true},
      {:antidotec_pb,
       git: "https://github.com/vaxine-io/vaxine.git", sparse: "apps/antidotec_pb", override: true},
      {:vx_client, git: "https://github.com/vaxine-io/vaxine.git", sparse: "apps/vx_client"},
      {:broadway, "~> 0.6"},
      {:epgsql, "~> 4.2"},
      {:ranch, "~> 2.1"},
      {:mox, "~> 1.0.2"},
      # TODO: shouldn't be needed, here for convenience
      {:ecto_sql, "~> 3.0"},
      {:postgrex, "~> 0.16.3"}
    ]
  end

  # Specifies which paths to compile per environment.
  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]
end
