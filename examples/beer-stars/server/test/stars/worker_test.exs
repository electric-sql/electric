defmodule BeerStars.WorkerTest do
  use BeerStars.DataCase, async: true

  alias BeerStars.Worker
  alias BeerStars.Worker.State

  test "perform fetch" do
    {:ok, %State{cursor: cursor} = state} = BeerStars.Worker.init([])
    %State{cursor: updated_cursor} = BeerStars.Worker.perform_fetch(state)

    assert cursor != updated_cursor
  end
end
