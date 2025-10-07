defmodule Electric.Shapes.LRU do
  def init do
    :ets.new(:lru_table, [:named_table, :public, read_concurrency: true])
    :ets.new(:lru_order, [:named_table, :public, :ordered_set])
    %{table: :lru_table, order: :lru_order}
  end

  def add(lru, item) do
    time_id = System.unique_integer([:monotonic])
    :ets.insert(lru.table, {item, time_id})
    :ets.insert(lru.order, {time_id, item})
    :ok
  end

  def mark_used(lru, item) do
    case :ets.lookup(lru.table, item) do
      [{^item, old_time_id}] ->
        :ets.delete(lru.order, old_time_id)
        new_time_id = System.unique_integer([:monotonic])
        :ets.insert(lru.table, {item, new_time_id})
        :ets.insert(lru.order, {new_time_id, item})
        :ok

      [] ->
        raise ArgumentError, "Item not found in LRU cache"
    end
  end

  def evict(lru) do
    case :ets.first(lru.order) do
      :"$end_of_table" ->
        nil

      time_id ->
        [{^time_id, item}] = :ets.lookup(lru.order, time_id)
        :ets.delete(lru.order, time_id)
        :ets.delete(lru.table, item)
        item
    end
  end
end
