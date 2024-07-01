defmodule ElectricTest do
  use ExUnit.Case
  doctest Electric

  test "greets the world" do
    assert Electric.hello() == :world
  end
end
