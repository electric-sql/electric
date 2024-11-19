defmodule CloudElectricTest do
  use ExUnit.Case
  doctest CloudElectric

  test "greets the world" do
    assert CloudElectric.hello() == :world
  end
end
