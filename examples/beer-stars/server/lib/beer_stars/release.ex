defmodule BeerStars.Release do
  @moduledoc """
  Add migration commands to mix release.

  https://hexdocs.pm/phoenix/releases.html#ecto-migrations-and-custom-commands
  """
  alias Ecto.Migrator

  alias BeerStars.Model
  alias BeerStars.ProxyRepo

  @app :beer_stars

  def migrate do
    load_app()

    {:ok, _, _} = Migrator.with_repo(ProxyRepo, &Migrator.run(&1, :up, all: true))
  end

  def allocate_beers do
    load_app()

    {:ok, _, _} =
      Ecto.Migrator.with_repo(ProxyRepo, fn _repo ->
        Model.allocate_beers()
      end)
  end

  def seed do
    load_app()

    seeds_file = Path.join(["#{:code.priv_dir(@app)}", "repo", "seeds.exs"])
    {:ok, _, _} = Migrator.with_repo(ProxyRepo, fn _ -> Code.eval_file(seeds_file) end)
  end

  def rollback(version) do
    load_app()

    {:ok, _, _} = Migrator.with_repo(ProxyRepo, &Migrator.run(&1, :down, to: version))
  end

  defp load_app do
    {:ok, _} = Application.ensure_all_started(:ssl)

    Application.load(@app)
  end
end
