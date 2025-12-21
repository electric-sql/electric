defmodule ElectricTelemetry.EtsTables do
  @moduledoc """
  Functions for collecting memory usage statistics from ETS tables.

  This module provides functions to:
  - Get the top N individual ETS tables by memory usage
  - Get the top M "types" of ETS tables by aggregated memory usage

  ETS table "types" are extracted from table names using pattern matching:
  - Tables with `ModuleName:stack_id` format are grouped by the module name prefix
  - Tables with `name_uuid` format are grouped by the name prefix
  - Tables with identical names (unnamed/anonymous tables) are grouped together
  - All other tables are treated as unique types
  """

  @default_individual_count 10
  @default_type_count 10

  @doc """
  Returns the top N individual ETS tables by memory usage.

  ## Parameters
    - `count` - Number of top tables to return (default: #{@default_individual_count})

  ## Returns
  A list of maps with `:name`, `:type`, `:memory`, `:size`, `:type_table_count`, and `:avg_size_per_type` keys,
  sorted by memory (descending).

  ## Examples

      iex> ElectricTelemetry.EtsTables.top_tables(5)
      [
        %{name: :filter_shapes, type: :filter_shapes, memory: 605630464, size: 200122,
          type_table_count: 1, avg_size_per_type: 200122.0},
        %{name: :"shapedb:shape_lookup:6dd7c00b-...", type: :"shapedb:shape_lookup", memory: 605625344,
          size: 200122, type_table_count: 2, avg_size_per_type: 200122.0},
        ...
      ]
  """
  def top_tables(count \\ @default_individual_count)

  def top_tables(count) when is_integer(count) and count > 0 do
    all_table_info =
      :ets.all()
      |> Enum.map(&table_info/1)
      |> Enum.reject(&(&1.memory == 0))

    # Calculate type statistics
    type_stats = calculate_type_stats(all_table_info)

    # Enrich each table with type statistics
    all_table_info
    |> Enum.map(fn table ->
      stats = Map.get(type_stats, table.type)

      Map.merge(table, %{
        type_table_count: stats.count,
        avg_size_per_type: stats.avg_size
      })
    end)
    |> Enum.sort_by(& &1.memory, :desc)
    |> Enum.take(count)
  end

  @doc """
  Returns the top M "types" of ETS tables by aggregated memory usage.

  Table types are extracted from table names:
  - `ModuleName:stack_id` → grouped by `ModuleName`
  - `name_uuid` → grouped by `name`
  - Identical names → grouped together
  - Other → each table is its own type

  ## Parameters
    - `count` - Number of top types to return (default: #{@default_type_count})

  ## Returns
  A list of maps with `:type`, `:memory`, `:table_count`, and `:avg_size` keys, sorted by memory (descending).

  ## Examples

      iex> ElectricTelemetry.EtsTables.top_by_type(5)
      [
        %{type: :"Elixir.Electric.Registry.ShapeChange", memory: 6815744, table_count: 29, avg_size: 785.5},
        %{type: :tls_socket, memory: 60928, table_count: 24, avg_size: 1.0},
        ...
      ]
  """
  def top_by_type(count \\ @default_type_count)

  def top_by_type(count) when is_integer(count) and count > 0 do
    all_table_info =
      :ets.all()
      |> Enum.map(&table_info/1)
      |> Enum.reject(&(&1.memory == 0))

    type_stats = calculate_type_stats(all_table_info)

    type_stats
    |> Enum.map(fn {type, stats} ->
      %{
        type: type,
        memory: stats.total_memory,
        table_count: stats.count,
        avg_size: stats.avg_size
      }
    end)
    |> Enum.sort_by(& &1.memory, :desc)
    |> Enum.take(count)
  end

  @doc """
  Returns both top individual tables and top types in a single call.

  This is more efficient than calling both functions separately if you need both results.

  ## Parameters
    - `individual_count` - Number of top individual tables (default: #{@default_individual_count})
    - `type_count` - Number of top types (default: #{@default_type_count})

  ## Returns
  A map with `:top_tables` and `:top_by_type` keys.

  ## Examples

      iex> ElectricTelemetry.EtsTables.top_memory_stats(5, 3)
      %{
        top_tables: [...],
        top_by_type: [...]
      }
  """
  def top_memory_stats(
        individual_count \\ @default_individual_count,
        type_count \\ @default_type_count
      )

  def top_memory_stats(individual_count, type_count)
      when is_integer(individual_count) and individual_count > 0 and
             is_integer(type_count) and type_count > 0 do
    all_table_info =
      :ets.all()
      |> Enum.map(&table_info/1)
      |> Enum.reject(&(&1.memory == 0))

    # Calculate type statistics once
    type_stats = calculate_type_stats(all_table_info)

    top_tables =
      all_table_info
      |> Enum.map(fn table ->
        stats = Map.get(type_stats, table.type)

        Map.merge(table, %{
          type_table_count: stats.count,
          avg_size_per_type: stats.avg_size
        })
      end)
      |> Enum.sort_by(& &1.memory, :desc)
      |> Enum.take(individual_count)

    top_by_type =
      type_stats
      |> Enum.map(fn {type, stats} ->
        %{
          type: type,
          memory: stats.total_memory,
          table_count: stats.count,
          avg_size: stats.avg_size
        }
      end)
      |> Enum.sort_by(& &1.memory, :desc)
      |> Enum.take(type_count)

    %{
      top_tables: top_tables,
      top_by_type: top_by_type
    }
  end

  # Private functions

  defp table_info(table_ref) do
    name = table_name(table_ref)
    type = table_type(name)
    memory = table_memory(table_ref)
    size = table_size(table_ref)

    %{
      name: name,
      type: type,
      memory: memory,
      size: size
    }
  end

  defp calculate_type_stats(all_table_info) do
    all_table_info
    |> Enum.group_by(& &1.type)
    |> Enum.map(fn {type, tables} ->
      total_memory = Enum.reduce(tables, 0, fn table, acc -> acc + table.memory end)
      total_size = Enum.reduce(tables, 0, fn table, acc -> acc + table.size end)
      count = length(tables)
      avg_size = if count > 0, do: total_size / count, else: 0.0

      {type,
       %{
         total_memory: total_memory,
         count: count,
         avg_size: avg_size
       }}
    end)
    |> Map.new()
  end

  defp table_name(table_ref) do
    case :ets.info(table_ref, :name) do
      :undefined -> table_ref
      name -> name
    end
  end

  defp table_memory(table_ref) do
    case :ets.info(table_ref, :memory) do
      :undefined ->
        0

      words when is_integer(words) ->
        word_size = :erlang.system_info(:wordsize)
        words * word_size
    end
  end

  defp table_size(table_ref) do
    case :ets.info(table_ref, :size) do
      :undefined -> 0
      size when is_integer(size) -> size
    end
  end

  defp table_type(name) when is_atom(name) do
    name
    |> Atom.to_string()
    |> extract_type_from_name()
    |> String.to_atom()
  end

  defp table_type(name) when is_binary(name) do
    name
    |> extract_type_from_name()
    |> String.to_atom()
  end

  defp table_type(name), do: name

  # UUID pattern: 8 hex digits, optionally followed by -4hex-4hex-4hex-12hex
  # We're looking for this pattern after a colon or underscore
  @uuid_pattern ~r/^[0-9a-f]{8}(-[0-9a-f]{4}){0,3}(-[0-9a-f]{1,12})?/i

  defp extract_type_from_name(name_string) when is_binary(name_string) do
    cond do
      # Pattern 1: ModuleName:stack_id (e.g., "Electric.StatusMonitor:6dd7c00b-8e31")
      # Extract everything before the last colon that precedes a UUID-like pattern
      String.contains?(name_string, ":") ->
        extract_type_with_separator(name_string, ":", @uuid_pattern)

      # Pattern 2: name_stack_id (e.g., "stack_call_home_telemetry_6dd7c00b-8")
      # Extract everything before the last underscore that precedes a UUID-like pattern
      String.contains?(name_string, "_") ->
        extract_type_with_separator(name_string, "_", @uuid_pattern)

      # Pattern 3: No pattern detected, use the full name as the type
      true ->
        name_string
    end
  end

  defp extract_type_with_separator(name_string, separator, uuid_pattern) do
    # Split by the separator and try to find where the UUID starts
    parts = String.split(name_string, separator)

    # Find the index where UUID pattern starts
    uuid_start_index =
      parts
      |> Enum.with_index()
      |> Enum.find_index(fn {part, _idx} ->
        String.match?(part, uuid_pattern)
      end)

    case uuid_start_index do
      nil ->
        # No UUID pattern found, return the full name
        name_string

      0 ->
        # UUID starts at the beginning (unlikely but handle it)
        name_string

      index ->
        # Take all parts before the UUID and rejoin them
        parts
        |> Enum.take(index)
        |> Enum.join(separator)
    end
  end
end
