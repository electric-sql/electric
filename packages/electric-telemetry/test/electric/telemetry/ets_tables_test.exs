defmodule ElectricTelemetry.EtsTablesTest do
  use ExUnit.Case, async: true

  alias ElectricTelemetry.EtsTables

  describe "top_tables/1" do
    test "returns top N tables by memory usage" do
      # Create some test tables
      table1 = :ets.new(:test_table_1, [:public, :named_table])
      table2 = :ets.new(:test_table_2, [:public, :named_table])
      table3 = :ets.new(:test_table_3, [:public, :named_table])

      # Insert data to create memory usage differences
      for i <- 1..100, do: :ets.insert(table1, {i, :binary.copy(<<0>>, 1000)})
      for i <- 1..50, do: :ets.insert(table2, {i, :binary.copy(<<0>>, 1000)})
      for i <- 1..10, do: :ets.insert(table3, {i, :binary.copy(<<0>>, 1000)})

      results = EtsTables.top_tables(3)

      # Check that we get results
      assert is_list(results)
      assert length(results) >= 3

      # Check that results have the right structure
      for result <- results do
        assert Map.has_key?(result, :name)
        assert Map.has_key?(result, :type)
        assert Map.has_key?(result, :memory)
        assert is_integer(result.memory)
        assert result.memory > 0
      end

      # Check that results are sorted by memory (descending)
      memories = Enum.map(results, & &1.memory)
      assert memories == Enum.sort(memories, :desc)

      # Cleanup
      :ets.delete(table1)
      :ets.delete(table2)
      :ets.delete(table3)
    end

    test "handles different table counts" do
      results = EtsTables.top_tables(2)
      assert is_list(results)
      assert length(results) <= 2
    end

    test "excludes tables with zero memory" do
      results = EtsTables.top_tables(100)
      assert Enum.all?(results, fn %{memory: memory} -> memory > 0 end)
    end
  end

  describe "top_by_type/1" do
    test "groups tables by type and sums memory" do
      # Create tables with patterns that should be grouped
      table1 = :ets.new(:"Electric.Test:6dd7c00b-8e31-4cfa", [:public])
      table2 = :ets.new(:"Electric.Test:61fec704-7dbf-49a5", [:public])
      table3 = :ets.new(:"Another.Module:abcd1234-5678-9abc", [:public])

      # Insert some data
      for i <- 1..10, do: :ets.insert(table1, {i, :binary.copy(<<0>>, 100)})
      for i <- 1..10, do: :ets.insert(table2, {i, :binary.copy(<<0>>, 100)})
      for i <- 1..10, do: :ets.insert(table3, {i, :binary.copy(<<0>>, 100)})

      results = EtsTables.top_by_type(50)

      # Find our test types
      electric_test_type = Enum.find(results, fn %{type: type} -> type == :"Electric.Test" end)
      another_module_type = Enum.find(results, fn %{type: type} -> type == :"Another.Module" end)

      # Electric.Test should have 2 tables grouped together
      if electric_test_type do
        assert electric_test_type.table_count == 2
        assert is_integer(electric_test_type.memory)
        assert electric_test_type.memory > 0
      end

      # Another.Module should have 1 table
      if another_module_type do
        assert another_module_type.table_count == 1
        assert is_integer(another_module_type.memory)
        assert another_module_type.memory > 0
      end

      # Check that results are sorted by memory (descending)
      memories = Enum.map(results, & &1.memory)
      assert memories == Enum.sort(memories, :desc)

      # Cleanup
      :ets.delete(table1)
      :ets.delete(table2)
      :ets.delete(table3)
    end

    test "handles unnamed tables with same name" do
      # Create multiple unnamed tables
      table1 = :ets.new(:unnamed_test, [:public, :named_table])
      table2 = :ets.new(:unnamed_test_2, [:public])

      # Insert data
      for i <- 1..5, do: :ets.insert(table1, {i, :data})

      results = EtsTables.top_by_type(50)

      # Find our test type
      unnamed_type = Enum.find(results, fn %{type: type} -> type == :unnamed_test end)

      if unnamed_type do
        assert unnamed_type.table_count >= 1
        assert is_integer(unnamed_type.memory)
      end

      # Cleanup
      :ets.delete(table1)
      :ets.delete(table2)
    end

    test "respects the count parameter" do
      results = EtsTables.top_by_type(3)
      assert is_list(results)
      assert length(results) <= 3
    end
  end

  describe "top_memory_stats/2" do
    test "returns both individual and type statistics" do
      results = EtsTables.top_memory_stats(5, 3)

      assert Map.has_key?(results, :top_tables)
      assert Map.has_key?(results, :top_by_type)

      assert is_list(results.top_tables)
      assert is_list(results.top_by_type)

      assert length(results.top_tables) <= 5
      assert length(results.top_by_type) <= 3

      # Check structure of top_tables
      for item <- results.top_tables do
        assert Map.has_key?(item, :name)
        assert Map.has_key?(item, :type)
        assert Map.has_key?(item, :memory)
      end

      # Check structure of top_by_type
      for item <- results.top_by_type do
        assert Map.has_key?(item, :type)
        assert Map.has_key?(item, :memory)
        assert Map.has_key?(item, :table_count)
      end
    end
  end

  describe "table type extraction" do
    test "extracts type from colon-separated stack_id pattern" do
      table1 = :ets.new(:"Electric.StatusMonitor:6dd7c00b-8e31", [:public])
      table2 = :ets.new(:"shapedb:shape_lookup:61fec704-7dbf-49a5", [:public])

      results = EtsTables.top_tables(100)

      monitor_result =
        Enum.find(results, fn %{name: name} ->
          name == :"Electric.StatusMonitor:6dd7c00b-8e31"
        end)

      shapedb_result =
        Enum.find(results, fn %{name: name} ->
          name == :"shapedb:shape_lookup:61fec704-7dbf-49a5"
        end)

      if monitor_result do
        assert monitor_result.type == :"Electric.StatusMonitor"
      end

      if shapedb_result do
        assert shapedb_result.type == :"shapedb:shape_lookup"
      end

      # Cleanup
      :ets.delete(table1)
      :ets.delete(table2)
    end

    test "extracts type from underscore-separated stack_id pattern" do
      table1 = :ets.new(:stack_call_home_telemetry_6dd7c00b, [:public])

      results = EtsTables.top_tables(100)

      result =
        Enum.find(results, fn %{name: name} ->
          name == :stack_call_home_telemetry_6dd7c00b
        end)

      if result do
        assert result.type == :stack_call_home_telemetry
      end

      # Cleanup
      :ets.delete(table1)
    end

    test "uses full name when no pattern is detected" do
      table1 = :ets.new(:simple_table_name, [:public, :named_table])

      results = EtsTables.top_tables(100)

      result = Enum.find(results, fn %{name: name} -> name == :simple_table_name end)

      if result do
        assert result.type == :simple_table_name
      end

      # Cleanup
      :ets.delete(table1)
    end

    test "handles partial UUID patterns correctly" do
      # Some production tables have truncated UUIDs
      table1 = :ets.new(:"Electric.Test:6dd7c00b", [:public])
      table2 = :ets.new(:"Electric.Test:61fec704-7dbf", [:public])

      results = EtsTables.top_tables(100)

      result1 = Enum.find(results, fn %{name: name} -> name == :"Electric.Test:6dd7c00b" end)
      result2 = Enum.find(results, fn %{name: name} -> name == :"Electric.Test:61fec704-7dbf" end)

      if result1 do
        assert result1.type == :"Electric.Test"
      end

      if result2 do
        assert result2.type == :"Electric.Test"
      end

      # Cleanup
      :ets.delete(table1)
      :ets.delete(table2)
    end
  end
end
