defmodule Electric.Shapes.LRUTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.LRU

  setup do
    lru = LRU.init()
    %{lru: lru}
  end

  test "returns the item that was least recently used", %{lru: lru} do
    LRU.add(lru, :a)
    LRU.add(lru, :b)
    LRU.add(lru, :c)
    LRU.mark_used(lru, :b)
    LRU.mark_used(lru, :a)
    LRU.mark_used(lru, :c)
    assert LRU.evict(lru) == :b
    assert LRU.evict(lru) == :a
    assert LRU.evict(lru) == :c
    assert LRU.evict(lru) == nil
  end

  test "returns the item that was least recently added", %{lru: lru} do
    LRU.add(lru, :a)
    LRU.add(lru, :b)
    LRU.add(lru, :c)
    assert LRU.evict(lru) == :a
    assert LRU.evict(lru) == :b
    assert LRU.evict(lru) == :c
    assert LRU.evict(lru) == nil
  end

  test "returns the item that was least recently added or used", %{lru: lru} do
    LRU.add(lru, :a)
    LRU.add(lru, :b)
    LRU.add(lru, :c)
    LRU.mark_used(lru, :c)
    LRU.mark_used(lru, :b)
    assert LRU.evict(lru) == :a
    assert LRU.evict(lru) == :c
    assert LRU.evict(lru) == :b
    assert LRU.evict(lru) == nil
  end

  test "is performant with lots of shapes", %{lru: lru} do
    for item_count <- [100_000, 1_000_000] do
      add_times =
        for i <- 1..item_count do
          {μs, _} = :timer.tc(fn -> LRU.add(lru, i) end)
          μs
        end

      mark_used_times =
        for i <- 1..item_count do
          {μs, _} = :timer.tc(fn -> LRU.mark_used(lru, i) end)
          μs
        end

      evict_times =
        for _i <- 1..item_count do
          {μs, _} = :timer.tc(fn -> LRU.evict(lru) end)
          μs
        end

      IO.puts(
        "#{item_count} items: add avg #{Enum.sum(add_times) / item_count} µs, mark_used avg #{Enum.sum(mark_used_times) / item_count} µs, evict avg #{Enum.sum(evict_times) / item_count} µs"
      )
    end
  end

  test "size", %{lru: lru} do
    shape_count = 50_000

    for i <- 1..shape_count do
      LRU.add(lru, Electric.Shapes.Shape.generate_id(i))
    end

    size = fn ets_table ->
      :ets.info(ets_table, :memory) * :erlang.system_info(:wordsize) / 1024 / 1024
    end

    IO.puts("LRU table size: #{size.(lru.table)} bytes")
    IO.puts("LRU order table size: #{size.(lru.order)} bytes")
  end
end
