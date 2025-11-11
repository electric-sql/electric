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

  # Bitmap size for unique counting (m)
  # Setting this to ~64 kbits provides a ~0.3% error rate for
  # cardinalities up to ~100k unique items.
  # standard_error = sqrt(m * (e^t - t - 1)) / n
  # n - the maximum expected cardinality of the dataset
  # t - n/m
  @unique_bitmap_size 2 ** 16

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

  def handle_unique_count(%__MODULE__{table: table}, key, value) do
    # Use linear probabilistic counting with a bitmap stored as a tuple
    # Hash the value to get which position in the tuple (0..m-1)
    bit_position = :erlang.phash2(value, @unique_bitmap_size)

    # Position in ETS tuple: position 1 is key, positions 2..m+1 are bitmap bits
    ets_position = bit_position + 2

    case :ets.update_element(table, key, {ets_position, true}) do
      true ->
        :ok

      false ->
        # Key doesn't exist, initialize tuple: {key, nil, nil, ..., nil}
        # Set the current bit position to true
        initial_tuple =
          :erlang.make_tuple(@unique_bitmap_size + 1, nil, [{1, key}, {ets_position, true}])

        :ets.insert_new(table, initial_tuple)
        :ok
    end
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

  def calc_metric(%__MODULE__{table: table}, key, :count_unique) do
    case :ets.lookup(table, key) do
      [] ->
        0

      [bitmap_tuple] ->
        # Bitmap tuple is {key, bit0, bit1, ..., bit_m-1}
        # Count set bits (truthy values, excluding nil and the key)
        set_bits =
          bitmap_tuple
          |> Tuple.to_list()
          # Remove the key
          |> tl()
          # Count truthy values (true bits, nil is falsy)
          |> Enum.count(& &1)

        # Use linear probabilistic counting formula: -m * ln(V/m)
        # where m is bitmap size (@unique_bitmap_size) and V is number of zero bits
        m = @unique_bitmap_size
        v = m - set_bits

        if v == 0 do
          # All bits set, estimate is very high
          round(m * :math.log(m))
        else
          # Linear probabilistic counting estimate
          round(-m * :math.log(v / m))
        end
    end
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
    :ok
  end

  def clear_metric(%__MODULE__{table: table}, key, :count_unique) do
    :ets.delete(table, key)
    :ok
  end

  def clear_metric(%__MODULE__{summary_table: table}, key, :summary) do
    :ets.delete(table, key)
    :ok
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
