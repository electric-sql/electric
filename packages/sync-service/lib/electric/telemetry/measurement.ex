defmodule Electric.Telemetry.Measurement do
  @moduledoc """
  Module for handling telemetry measurements using ETS for storage.
  Supports counters, sums, last values, unique counts, and summaries.
  Uses ETS tables for efficient concurrent updates and storage.

  Counters, sums, and last values are stored as simple ETS entries that
  can be atomically updated, and the result is read out directly.

  Unique counts are implemented using a bitmap stored in an ETS tuple,
  allowing efficient linear probabilistic counting of unique items.
  The accuracy of the estimate depends on the size of the bitmap used, so
  a balance between memory usage and accuracy is maintained with a fixed
  size that can accommodate at least ~100k unique items with low error.

  For updating unique counts, entries are hashed in the range of the size
  of the bitmap, and the corresponding bit is set. The unique count is
  estimated using the linear probabilistic counting formula based on the
  proportion of unset bits in the bitmap.

  Summaries only contain min, max, and mean, and they are calculated by
  keeping running tallies of min, max, count, and sum, which are updated
  atomically using :ets.select_replace. This allows efficient computation
  of summary statistics without storing all individual measurements.

  In order to implement a fixed-memory calculation of the median or other
  percentiles, approaches like a t-digest or P^2 quantile estimation could
  be used, but they would require a linearised, in-process handling of the
  stream of measurements, rather than concurrent updates on an ETS table.

  Similarly for the mode, a fixed-memory approach like a Count-Min Sketch or
  space saving algorithm can be used but not with the current ETS-based design.
  """

  @type t() :: %__MODULE__{
          table: :ets.table()
        }

  @required_keys [:table]
  defstruct @required_keys

  # Bitmap size for unique counting (m)
  # Setting this to ~64 kbits (~8kb) provides a ~0.3% error
  # rate for cardinalities up to ~100k unique items.
  #
  # standard_error = sqrt(m * (e^t - t - 1)) / n
  # n - the maximum expected cardinality of the dataset
  # t - n/m
  @unique_bitmap_size 2 ** 16

  def init(name) do
    table = :ets.new(name, [:named_table, :public, :set, {:write_concurrency, :auto}])

    %__MODULE__{table: table}
  end

  def handle_counter(%__MODULE__{table: table}, key) do
    :ets.update_counter(table, key, {3, 1}, {key, :counter, 0})
    :ok
  end

  def handle_sum(%__MODULE__{table: table}, key, value) do
    :ets.update_counter(table, key, {3, value}, {key, :sum, 0})
    :ok
  end

  def handle_last_value(%__MODULE__{table: table}, key, value) do
    :ets.insert(table, {key, :last_value, value})
    :ok
  end

  def handle_unique_count(%__MODULE__{table: table} = m, key, value) do
    # Use linear probabilistic counting with a bitmap stored as a tuple
    # Hash the value to get which position in the tuple (0..m-1)
    bit_position = :erlang.phash2(value, @unique_bitmap_size)

    # Position in ETS tuple:
    # position 1 is key
    # position 2 is type
    # positions 3..m+2 are bitmap bits
    ets_position = bit_position + 3

    case :ets.update_element(table, key, {ets_position, true}) do
      true ->
        :ok

      false ->
        # Key doesn't exist, initialize tuple: {key, nil, nil, ..., nil}
        # Set the current bit position to true
        initial_tuple =
          :erlang.make_tuple(@unique_bitmap_size + 2, nil, [
            {1, key},
            {2, :unique_count},
            {ets_position, true}
          ])

        case :ets.insert_new(table, initial_tuple) do
          true -> :ok
          # Another process initialized it, retry the update
          false -> handle_unique_count(m, key, value)
        end
    end
  end

  def handle_summary(%__MODULE__{table: table} = m, key, value) do
    # Use :ets.select_replace to atomically update running tallies:
    # {key, :summary, min, max, count, sum}
    match_spec = [
      {
        {key, :"$1", :"$2", :"$3", :"$4", :"$5"},
        [],
        [
          {
            {
              {:const, key},
              :"$1",
              {:min, :"$2", {:const, value}},
              {:max, :"$3", {:const, value}},
              {:+, :"$4", 1},
              {:+, :"$5", {:const, value}}
            }
          }
        ]
      }
    ]

    case :ets.select_replace(table, match_spec) do
      1 ->
        :ok

      0 ->
        # Key doesn't exist, try to initialize with first value
        case :ets.insert_new(table, {key, :summary, value, value, 1, value}) do
          true -> :ok
          # Another process initialized it, retry the update
          false -> handle_summary(m, key, value)
        end
    end
  end

  def calc_metric(%__MODULE__{table: table}, key, default \\ nil) do
    case :ets.lookup(table, key) do
      [] ->
        default

      [{^key, type, value}] when type in [:counter, :sum, :last_value] ->
        value

      [{^key, :summary, min, max, count, sum}] ->
        try do
          mean = sum / count

          %{
            min: min,
            max: max,
            mean: mean
          }
        rescue
          ArithmeticError -> default
        end

      [bitmap_tuple] when elem(bitmap_tuple, 1) == :unique_count ->
        # Bitmap tuple is {key, type, bit0, bit1, ..., bit_m-1}
        # Count set bits (truthy values, excluding nil and key+type)
        set_bits =
          bitmap_tuple
          |> Tuple.to_list()
          # Remove the key and type
          |> Enum.drop(2)
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
    ArgumentError -> default
  end

  def clear_metric(%__MODULE__{table: table}, key) do
    :ets.delete(table, key)
    :ok
  end
end
