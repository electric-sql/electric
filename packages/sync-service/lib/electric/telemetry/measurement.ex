defmodule Electric.Telemetry.Measurement do
  @moduledoc false

  @type t() :: %__MODULE__{
          table: :ets.table(),
          summary_table: :ets.table()
        }

  @required_keys [:table, :summary_table]
  defstruct @required_keys

  @empty_summary %{
    min: 0,
    max: 0,
    mean: 0,
    median: 0,
    mode: nil
  }

  def init(name) do
    table = :ets.new(name, [:named_table, :public, :set, {:write_concurrency, :auto}])

    summary_table =
      :ets.new(:"#{name}_summary", [
        :named_table,
        :public,
        :duplicate_bag,
        {:write_concurrency, :auto}
      ])

    %__MODULE__{table: table, summary_table: summary_table}
  end

  def handle_counter(%__MODULE__{table: table}, key) do
    :ets.update_counter(table, key, 1, {key, 0})
  end

  def handle_sum(%__MODULE__{table: table}, key, value) do
    :ets.update_counter(table, key, value, {key, 0})
  end

  def handle_last_value(%__MODULE__{table: table}, key, value) do
    :ets.insert(table, {key, value})
  end

  def handle_unique_count(%__MODULE__{summary_table: summary_table}, key, value) do
    :ets.insert(summary_table, {key, value})
  end

  def handle_summary(%__MODULE__{summary_table: summary_table}, key, value) do
    :ets.insert(summary_table, {key, value})
  end

  def calc_metric(opts, key, key_type \\ nil)

  def calc_metric(%__MODULE__{table: table}, key, nil) do
    case :ets.lookup(table, key) do
      [] -> 0
      [{^key, value}] -> value
    end
  rescue
    ArgumentError -> 0
  end

  def calc_metric(%__MODULE__{summary_table: table}, key, :count_unique) do
    :ets.lookup_element(table, key, 2)
    |> Enum.uniq()
    |> Enum.count()
  rescue
    ArgumentError -> 0
  end

  def calc_metric(%__MODULE__{summary_table: table}, key, :summary) do
    items = :ets.lookup_element(table, key, 2)

    length = length(items)

    {min, max} = Enum.min_max(items)

    %{
      min: min,
      max: max,
      mean: mean(items, length),
      median: median(items, length),
      mode: mode(items)
    }
  rescue
    [ArgumentError, Enum.EmptyError, ArithmeticError] ->
      # Enum.EmptyError may be raised when there are no elements in the ETS table under the key `path`
      # ArithmeticError may be raised when an element in the ETS table is `nil`
      @empty_summary
  end

  def clear_metric(opts, key, key_type \\ nil)

  def clear_metric(%__MODULE__{table: table}, key, nil) do
    :ets.delete(table, key)
  end

  def clear_metric(%__MODULE__{summary_table: table}, key, _key_type) do
    :ets.delete(table, key)
  end

  defp mean(elements, length), do: Enum.sum(elements) / length

  defp median(elements, length) when rem(length, 2) == 1 do
    Enum.at(elements, div(length, 2))
  end

  defp median(elements, length) when rem(length, 2) == 0 do
    Enum.slice(elements, div(length, 2) - 1, 2) |> mean(length)
  end

  defp mode(elements), do: Enum.frequencies(elements) |> Enum.max_by(&elem(&1, 1)) |> elem(0)
end
