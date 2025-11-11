defmodule Electric.Telemetry.Measurement do
  @moduledoc false

  @type t() :: %__MODULE__{
          table: :ets.table()
        }

  @required_keys [:table]
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

    %__MODULE__{table: table}
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

  def handle_summary(%__MODULE__{table: table}, key, value) do
    # Use :ets.select_replace to atomically update running tallies: {key, min, max, count, sum}
    match_spec = [
      {
        {key, :"$1", :"$2", :"$3", :"$4"},
        [],
        [
          {
            {
              {:const, key},
              {:min, :"$1", {:const, value}},
              {:max, :"$2", {:const, value}},
              {:+, :"$3", 1},
              {:+, :"$4", {:const, value}}
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
        case :ets.insert_new(table, {key, value, value, 1, value}) do
          true ->
            :ok

          false ->
            # Another process initialized it, retry the update
            :ets.select_replace(table, match_spec)
            :ok
        end
    end
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

  def calc_metric(%__MODULE__{table: table}, key, :summary) do
    case :ets.lookup(table, key) do
      [] ->
        @empty_summary

      [{^key, min, max, count, sum}] ->
        mean = sum / count

        %{
          min: min,
          max: max,
          mean: mean,
          median: 0,
          mode: nil
        }
    end
  rescue
    [ArgumentError, ArithmeticError] ->
      # ArgumentError when key doesn't exist
      # ArithmeticError when dividing by zero or invalid values
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

  def clear_metric(%__MODULE__{table: table}, key, :summary) do
    :ets.delete(table, key)
    :ok
  end
end
