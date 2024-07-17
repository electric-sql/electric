defmodule PgInterop.IntervalTest do
  use ExUnit.Case, async: true
  alias PgInterop.Interval
  doctest PgInterop.Interval, import: true

  test "Interval implements Inspect protocol" do
    assert inspect(Interval.parse!("P1YT10H")) == ~S|Interval.parse!("P1YT10H")|
  end
end
