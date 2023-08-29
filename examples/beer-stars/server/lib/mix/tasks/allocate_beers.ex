defmodule Mix.Tasks.AllocateBeers do
  use Mix.Task
  alias BeerStars.Model

  @impl Mix.Task
  def run(_args) do
    Mix.Task.run("app.start")

    Model.allocate_beers()
  end
end
