defmodule PgInterop.ArrayTest do
  use ExUnit.Case

  doctest PgInterop.Array, import: true, only: [parse: 2]
end
