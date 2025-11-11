defmodule Electric.Telemetry.MeasurementTest do
  use ExUnit.Case, async: true

  alias Electric.Telemetry.Measurement

  describe "init/1" do
    test "initializes tables with correct options" do
      name = :test_measurement_init
      measurement = Measurement.init(name)

      assert %Measurement{table: table} = measurement

      # Table is atom when named_table is used
      assert is_atom(table)

      # Verify table exists and has correct type
      assert :ets.info(table)[:type] == :set
    end

    test "creates named tables" do
      name = :test_measurement_named
      Measurement.init(name)

      assert :ets.whereis(name) != :undefined
    end
  end

  describe "handle_counter/2" do
    setup do
      measurement = Measurement.init(:test_counter)
      %{measurement: measurement}
    end

    test "increments counter from 0 to 1", %{measurement: measurement} do
      result = Measurement.handle_counter(measurement, :my_counter)
      assert result == 1
    end

    test "increments counter multiple times", %{measurement: measurement} do
      Measurement.handle_counter(measurement, :my_counter)
      Measurement.handle_counter(measurement, :my_counter)
      result = Measurement.handle_counter(measurement, :my_counter)
      assert result == 3
    end

    test "maintains separate counters for different keys", %{measurement: measurement} do
      Measurement.handle_counter(measurement, :counter_a)
      Measurement.handle_counter(measurement, :counter_a)
      Measurement.handle_counter(measurement, :counter_b)

      assert Measurement.calc_metric(measurement, :counter_a) == 2
      assert Measurement.calc_metric(measurement, :counter_b) == 1
    end

    test "calc_metric returns 0 for nonexistent counter", %{measurement: measurement} do
      assert Measurement.calc_metric(measurement, :nonexistent, 0) == 0
    end

    test "calc_metric retrieves stored counter value", %{measurement: measurement} do
      Measurement.handle_counter(measurement, :my_key)
      Measurement.handle_counter(measurement, :my_key)
      assert Measurement.calc_metric(measurement, :my_key) == 2
    end

    test "calc_metric returns 0 if table doesn't exist" do
      fake_measurement = %Measurement{table: :nonexistent_table}
      assert Measurement.calc_metric(fake_measurement, :any_key, 0) == 0
    end

    test "counter increments are atomic" do
      measurement = Measurement.init(:test_counter_atomic)
      # Simulate concurrent increments
      tasks =
        for _ <- 1..100 do
          Task.async(fn -> Measurement.handle_counter(measurement, :concurrent) end)
        end

      Task.await_many(tasks)

      assert Measurement.calc_metric(measurement, :concurrent) == 100
    end
  end

  describe "handle_sum/3" do
    setup do
      measurement = Measurement.init(:test_sum)
      %{measurement: measurement}
    end

    test "adds positive values", %{measurement: measurement} do
      Measurement.handle_sum(measurement, :my_sum, 10)
      Measurement.handle_sum(measurement, :my_sum, 20)
      result = Measurement.handle_sum(measurement, :my_sum, 30)
      assert result == 60
    end

    test "handles negative values", %{measurement: measurement} do
      Measurement.handle_sum(measurement, :my_sum, 100)
      Measurement.handle_sum(measurement, :my_sum, -30)
      result = Measurement.handle_sum(measurement, :my_sum, -20)
      assert result == 50
    end

    test "handles zero values", %{measurement: measurement} do
      Measurement.handle_sum(measurement, :my_sum, 0)
      result = Measurement.handle_sum(measurement, :my_sum, 0)
      assert result == 0
    end

    test "maintains separate sums for different keys", %{measurement: measurement} do
      Measurement.handle_sum(measurement, :sum_a, 10)
      Measurement.handle_sum(measurement, :sum_b, 20)
      Measurement.handle_sum(measurement, :sum_a, 5)

      assert Measurement.calc_metric(measurement, :sum_a) == 15
      assert Measurement.calc_metric(measurement, :sum_b) == 20
    end

    test "calc_metric retrieves sum value", %{measurement: measurement} do
      Measurement.handle_sum(measurement, :my_sum, 10)
      Measurement.handle_sum(measurement, :my_sum, 20)
      assert Measurement.calc_metric(measurement, :my_sum) == 30
    end

    test "handles very large numbers" do
      measurement = Measurement.init(:test_large_sum)
      large_num = 1_000_000_000_000
      Measurement.handle_sum(measurement, :large_sum, large_num)
      Measurement.handle_sum(measurement, :large_sum, large_num)

      assert Measurement.calc_metric(measurement, :large_sum) == 2_000_000_000_000
    end

    test "sum additions are atomic" do
      measurement = Measurement.init(:test_sum_atomic)
      # Simulate concurrent sums
      tasks =
        for i <- 1..50 do
          Task.async(fn -> Measurement.handle_sum(measurement, :concurrent_sum, i) end)
        end

      Task.await_many(tasks)

      # Sum of 1..50 is 1275
      assert Measurement.calc_metric(measurement, :concurrent_sum) == 1275
    end

    test "raises error when summing nil values" do
      measurement = Measurement.init(:test_nil_sum)

      assert_raise ArgumentError, fn ->
        Measurement.handle_sum(measurement, :nil_sum, nil)
      end
    end

    test "raises error when summing non-numeric values" do
      measurement = Measurement.init(:test_invalid_sum)

      assert_raise ArgumentError, fn ->
        Measurement.handle_sum(measurement, :invalid_sum, "not a number")
      end
    end
  end

  describe "handle_last_value/3" do
    setup do
      measurement = Measurement.init(:test_last_value)
      %{measurement: measurement}
    end

    test "stores the last value", %{measurement: measurement} do
      Measurement.handle_last_value(measurement, :my_value, 10)
      Measurement.handle_last_value(measurement, :my_value, 20)
      Measurement.handle_last_value(measurement, :my_value, 30)

      assert Measurement.calc_metric(measurement, :my_value) == 30
    end

    test "handles different data types", %{measurement: measurement} do
      Measurement.handle_last_value(measurement, :string_value, "hello")
      Measurement.handle_last_value(measurement, :list_value, [1, 2, 3])
      Measurement.handle_last_value(measurement, :map_value, %{key: "value"})

      assert Measurement.calc_metric(measurement, :string_value) == "hello"
      assert Measurement.calc_metric(measurement, :list_value) == [1, 2, 3]
      assert Measurement.calc_metric(measurement, :map_value) == %{key: "value"}
    end

    test "maintains separate values for different keys", %{measurement: measurement} do
      Measurement.handle_last_value(measurement, :value_a, 100)
      Measurement.handle_last_value(measurement, :value_b, 200)

      assert Measurement.calc_metric(measurement, :value_a) == 100
      assert Measurement.calc_metric(measurement, :value_b) == 200
    end

    test "calc_metric retrieves last stored value", %{measurement: measurement} do
      Measurement.handle_last_value(measurement, :my_key, 42)
      assert Measurement.calc_metric(measurement, :my_key) == 42
    end
  end

  describe "handle_unique_count/3" do
    setup do
      measurement = Measurement.init(:test_unique_count)
      %{measurement: measurement}
    end

    test "stores values for unique counting", %{measurement: measurement} do
      Measurement.handle_unique_count(measurement, :unique_key, "value1")
      Measurement.handle_unique_count(measurement, :unique_key, "value2")
      Measurement.handle_unique_count(measurement, :unique_key, "value1")

      # Probabilistic counting - estimate should be close to 2
      count = Measurement.calc_metric(measurement, :unique_key)
      assert count >= 1 and count <= 3
    end

    test "counts unique values correctly", %{measurement: measurement} do
      Measurement.handle_unique_count(measurement, :unique_key, 1)
      Measurement.handle_unique_count(measurement, :unique_key, 2)
      Measurement.handle_unique_count(measurement, :unique_key, 3)
      Measurement.handle_unique_count(measurement, :unique_key, 1)
      Measurement.handle_unique_count(measurement, :unique_key, 2)

      # Probabilistic counting - estimate should be close to 3
      count = Measurement.calc_metric(measurement, :unique_key)
      assert count >= 2 and count <= 4
    end

    test "calc_metric counts unique string values", %{measurement: measurement} do
      Measurement.handle_unique_count(measurement, :users, "alice")
      Measurement.handle_unique_count(measurement, :users, "bob")
      Measurement.handle_unique_count(measurement, :users, "alice")
      Measurement.handle_unique_count(measurement, :users, "charlie")
      Measurement.handle_unique_count(measurement, :users, "bob")

      # Probabilistic counting - estimate should be close to 3
      count = Measurement.calc_metric(measurement, :users)
      assert count >= 2 and count <= 4
    end

    test "calc_metric counts unique integer values", %{measurement: measurement} do
      Measurement.handle_unique_count(measurement, :numbers, 1)
      Measurement.handle_unique_count(measurement, :numbers, 2)
      Measurement.handle_unique_count(measurement, :numbers, 1)

      # Probabilistic counting - estimate should be close to 2
      count = Measurement.calc_metric(measurement, :numbers)
      assert count >= 1 and count <= 3
    end

    test "calc_metric returns 0 for nonexistent key", %{measurement: measurement} do
      assert Measurement.calc_metric(measurement, :nonexistent, 0) == 0
    end

    test "calc_metric counts single unique value", %{measurement: measurement} do
      Measurement.handle_unique_count(measurement, :single, "value")
      Measurement.handle_unique_count(measurement, :single, "value")

      # Probabilistic counting - estimate should be close to 1
      count = Measurement.calc_metric(measurement, :single)
      assert count >= 1 and count <= 2
    end

    test "calc_metric estimates large number of unique values", %{measurement: measurement} do
      # Add 100 unique values
      for i <- 1..100 do
        Measurement.handle_unique_count(measurement, :large_set, i)
      end

      count = Measurement.calc_metric(measurement, :large_set)
      # With 1024-bit bitmap, estimate should be reasonably accurate for 100 unique values
      # Allow 20% error margin
      assert count >= 80 and count <= 120
    end

    test "unique count updates are atomic" do
      measurement = Measurement.init(:test_unique_atomic)

      # Simulate concurrent unique count updates
      tasks =
        for i <- 1..10_000 do
          Task.async(fn ->
            Measurement.handle_unique_count(measurement, :concurrent_unique, i)
          end)
        end

      Task.await_many(tasks)

      count = Measurement.calc_metric(measurement, :concurrent_unique)
      # Should estimate around 10k unique values (allow margin for probabilistic counting)
      assert count >= 9_900 and count <= 10_100
    end

    test "concurrent updates to same unique values don't cause errors" do
      measurement = Measurement.init(:test_unique_concurrent_same)

      # Multiple processes adding the same values concurrently
      tasks =
        for _ <- 1..50 do
          Task.async(fn ->
            Measurement.handle_unique_count(measurement, :same_values, "value1")
            Measurement.handle_unique_count(measurement, :same_values, "value2")
            Measurement.handle_unique_count(measurement, :same_values, "value3")
          end)
        end

      Task.await_many(tasks)

      count = Measurement.calc_metric(measurement, :same_values)
      # Should estimate around 3 unique values despite many concurrent inserts
      assert count >= 2 and count <= 5
    end
  end

  describe "handle_summary/3" do
    setup do
      measurement = Measurement.init(:test_summary)
      %{measurement: measurement}
    end

    test "stores values for summary calculation", %{measurement: measurement} do
      Measurement.handle_summary(measurement, :summary_key, 10)
      Measurement.handle_summary(measurement, :summary_key, 20)
      Measurement.handle_summary(measurement, :summary_key, 30)

      summary = Measurement.calc_metric(measurement, :summary_key)
      assert summary.min == 10
      assert summary.max == 30
    end

    test "calc_metric calculates complete summary statistics", %{measurement: measurement} do
      values = [10, 20, 30, 40, 50]
      Enum.each(values, fn v -> Measurement.handle_summary(measurement, :stats, v) end)

      summary = Measurement.calc_metric(measurement, :stats)

      assert summary.min == 10
      assert summary.max == 50
      assert summary.mean == 30.0
      # median and mode cannot be calculated from running tallies
      assert summary.median == 0
      assert summary.mode == nil
    end

    test "calc_metric calculates min/max/mean for odd number of elements", %{
      measurement: measurement
    } do
      values = [1, 2, 3, 4, 5]
      Enum.each(values, fn v -> Measurement.handle_summary(measurement, :odd, v) end)

      summary = Measurement.calc_metric(measurement, :odd)
      assert summary.min == 1
      assert summary.max == 5
      assert summary.mean == 3.0
    end

    test "calc_metric calculates min/max/mean for even number of elements", %{
      measurement: measurement
    } do
      values = [1, 2, 3, 4]
      Enum.each(values, fn v -> Measurement.handle_summary(measurement, :even, v) end)

      summary = Measurement.calc_metric(measurement, :even)
      assert summary.min == 1
      assert summary.max == 4
      assert summary.mean == 2.5
    end

    test "calc_metric handles single value", %{measurement: measurement} do
      Measurement.handle_summary(measurement, :single, 42)

      summary = Measurement.calc_metric(measurement, :single)
      assert summary.min == 42
      assert summary.max == 42
      assert summary.mean == 42.0
      assert summary.median == 0
      assert summary.mode == nil
    end

    test "calc_metric handles two values", %{measurement: measurement} do
      Measurement.handle_summary(measurement, :two, 10)
      Measurement.handle_summary(measurement, :two, 20)

      summary = Measurement.calc_metric(measurement, :two)
      assert summary.min == 10
      assert summary.max == 20
      assert summary.mean == 15.0
      assert summary.median == 0
      assert summary.mode == nil
    end

    test "calc_metric returns nil for nonexistent key", %{measurement: measurement} do
      result = Measurement.calc_metric(measurement, :nonexistent)

      assert result == nil
    end

    test "calc_metric handles negative numbers", %{measurement: measurement} do
      values = [-50, -20, 0, 20, 50]
      Enum.each(values, fn v -> Measurement.handle_summary(measurement, :negative, v) end)

      summary = Measurement.calc_metric(measurement, :negative)
      assert summary.min == -50
      assert summary.max == 50
      assert summary.mean == 0.0
    end

    test "calc_metric handles floating point numbers", %{measurement: measurement} do
      values = [1.5, 2.5, 3.5]
      Enum.each(values, fn v -> Measurement.handle_summary(measurement, :float, v) end)

      summary = Measurement.calc_metric(measurement, :float)
      assert summary.min == 1.5
      assert summary.max == 3.5
      assert_in_delta summary.mean, 2.5, 0.001
    end

    test "calc_metric calculates mean correctly for large dataset", %{measurement: measurement} do
      values = 1..100 |> Enum.to_list()
      Enum.each(values, fn v -> Measurement.handle_summary(measurement, :large, v) end)

      summary = Measurement.calc_metric(measurement, :large)
      assert summary.min == 1
      assert summary.max == 100
      assert summary.mean == 50.5
    end

    test "calc_metric handles zero-only summary", %{measurement: measurement} do
      Enum.each([0, 0, 0], fn v -> Measurement.handle_summary(measurement, :zeros, v) end)

      summary = Measurement.calc_metric(measurement, :zeros)
      assert summary.min == 0
      assert summary.max == 0
      assert summary.mean == 0.0
      assert summary.median == 0
      assert summary.mode == nil
    end

    test "calc_metric handles duplicate values", %{measurement: measurement} do
      values = [5, 5, 5, 5, 5]
      Enum.each(values, fn v -> Measurement.handle_summary(measurement, :duplicates, v) end)

      summary = Measurement.calc_metric(measurement, :duplicates)
      assert summary.min == 5
      assert summary.max == 5
      assert summary.mean == 5.0
      assert summary.median == 0
      assert summary.mode == nil
    end

    test "calc_metric min/max/mean with unsorted values", %{measurement: measurement} do
      values = [50, 10, 30, 20, 40]
      Enum.each(values, fn v -> Measurement.handle_summary(measurement, :unsorted, v) end)

      summary = Measurement.calc_metric(measurement, :unsorted)
      assert summary.min == 10
      assert summary.max == 50
      assert summary.mean == 30.0
    end

    test "calc_metric returns default when values include nil" do
      measurement = Measurement.init(:test_nil_summary)
      Measurement.handle_summary(measurement, :with_nil, 10)
      Measurement.handle_summary(measurement, :with_nil, nil)
      Measurement.handle_summary(measurement, :with_nil, 20)

      # ArithmeticError is caught and empty summary is returned
      summary = Measurement.calc_metric(measurement, :with_nil, nil)
      assert summary == nil
    end

    test "calc_metric handles mixed valid and nil values gracefully" do
      measurement = Measurement.init(:test_mixed_nil)
      Measurement.handle_summary(measurement, :mixed, 5)
      Measurement.handle_summary(measurement, :mixed, nil)
      Measurement.handle_summary(measurement, :mixed, nil)
      Measurement.handle_summary(measurement, :mixed, 10)

      # Should return empty summary due to ArithmeticError
      summary = Measurement.calc_metric(measurement, :mixed, nil)
      assert summary == nil
    end

    test "summary updates are atomic under concurrent access" do
      measurement = Measurement.init(:test_summary_atomic)

      # Simulate concurrent summary updates
      tasks =
        for i <- 1..100 do
          Task.async(fn -> Measurement.handle_summary(measurement, :concurrent_summary, i) end)
        end

      # Wait for all tasks to complete
      Enum.each(tasks, &Task.await/1)

      summary = Measurement.calc_metric(measurement, :concurrent_summary)
      assert summary.min == 1
      assert summary.max == 100
      assert summary.mean == 50.5
    end
  end

  describe "clear_metric/3" do
    setup do
      measurement = Measurement.init(:test_clear)
      %{measurement: measurement}
    end

    test "clears counter metric", %{measurement: measurement} do
      Measurement.handle_counter(measurement, :counter)
      Measurement.handle_counter(measurement, :counter)
      assert Measurement.calc_metric(measurement, :counter) == 2

      Measurement.clear_metric(measurement, :counter)
      assert Measurement.calc_metric(measurement, :counter, 0) == 0
    end

    test "clears last_value metric", %{measurement: measurement} do
      Measurement.handle_last_value(measurement, :value, 42)
      assert Measurement.calc_metric(measurement, :value) == 42

      Measurement.clear_metric(measurement, :value)
      assert Measurement.calc_metric(measurement, :value, 0) == 0
    end

    test "clears sum metric", %{measurement: measurement} do
      Measurement.handle_sum(measurement, :sum, 10)
      Measurement.handle_sum(measurement, :sum, 20)
      assert Measurement.calc_metric(measurement, :sum) == 30

      Measurement.clear_metric(measurement, :sum)
      assert Measurement.calc_metric(measurement, :sum, 0) == 0
    end

    test "clears unique_count metric", %{measurement: measurement} do
      Measurement.handle_unique_count(measurement, :unique, "a")
      Measurement.handle_unique_count(measurement, :unique, "b")
      assert Measurement.calc_metric(measurement, :unique) == 2

      Measurement.clear_metric(measurement, :unique)
      assert Measurement.calc_metric(measurement, :unique, 0) == 0
    end

    test "clears summary metric", %{measurement: measurement} do
      Measurement.handle_summary(measurement, :summary, 10)
      Measurement.handle_summary(measurement, :summary, 20)
      summary = Measurement.calc_metric(measurement, :summary)
      assert summary.min == 10

      Measurement.clear_metric(measurement, :summary)
      result = Measurement.calc_metric(measurement, :summary, 0)
      # After clearing, nonexistent key returns the default value
      assert result == 0
    end

    test "clearing nonexistent key doesn't cause errors", %{measurement: measurement} do
      assert Measurement.clear_metric(measurement, :nonexistent) == :ok
    end
  end

  describe "multiple keys interaction" do
    setup do
      measurement = Measurement.init(:test_multiple_keys)
      %{measurement: measurement}
    end

    test "different metric types don't interfere", %{measurement: measurement} do
      # Use same key name but different tables
      Measurement.handle_counter(measurement, :metric)
      Measurement.handle_counter(measurement, :metric)

      Measurement.handle_unique_count(measurement, :metric_unique, "value1")
      Measurement.handle_unique_count(measurement, :metric_unique, "value2")

      Measurement.handle_summary(measurement, :metric_summary, 100)
      Measurement.handle_summary(measurement, :metric_summary, 200)

      # Each should work independently
      assert Measurement.calc_metric(measurement, :metric) == 2
      assert Measurement.calc_metric(measurement, :metric_unique) == 2

      summary = Measurement.calc_metric(measurement, :metric_summary)
      assert summary.min == 100
      assert summary.max == 200
    end

    test "clearing one metric type doesn't affect others", %{measurement: measurement} do
      Measurement.handle_counter(measurement, :counter_key)
      Measurement.handle_unique_count(measurement, :unique_key, "value")
      Measurement.handle_summary(measurement, :summary_key, 100)

      Measurement.clear_metric(measurement, :counter_key)

      assert Measurement.calc_metric(measurement, :counter_key, 0) == 0
      assert Measurement.calc_metric(measurement, :unique_key) == 1

      summary = Measurement.calc_metric(measurement, :summary_key)
      assert summary.min == 100
    end
  end
end
