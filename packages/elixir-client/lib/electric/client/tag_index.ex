defmodule Electric.Client.TagIndex do
  @moduledoc """
  Positional index for efficient move-out pattern matching.

  Tags are pipe-delimited strings (e.g., "abc123|def456" for composite tags).
  The index maps each position -> value -> set of row keys, enabling O(1)
  lookup when processing move-out patterns.

  ## Tag Format

  - Simple tag: `"abc123def456..."` (single MD5 hash)
  - Composite tag: `"abc123|def456"` (multiple positions separated by `|`)
  - Wildcard: `"_"` at any position matches any pattern value

  ## Example

      iex> index = TagIndex.new()
      iex> index = TagIndex.add_tag(index, "row1", "abc|def")
      iex> index = TagIndex.add_tag(index, "row2", "abc|ghi")
      iex> TagIndex.find_rows_matching_pattern(index, %{pos: 0, value: "abc"})
      MapSet.new(["row1", "row2"])
      iex> TagIndex.find_rows_matching_pattern(index, %{pos: 1, value: "def"})
      MapSet.new(["row1"])
  """

  @type row_key :: String.t()
  @type move_tag :: String.t()
  @type parsed_tag :: [String.t()]
  @type position :: non_neg_integer()
  @type value :: String.t()
  @type move_out_pattern :: %{pos: position(), value: value()}

  @type t :: %__MODULE__{
          index: [%{value() => MapSet.t(row_key())}],
          tag_length: non_neg_integer() | nil
        }

  defstruct index: [], tag_length: nil

  @tag_wildcard "_"
  @tag_delimiter "|"
  @escaped_delimiter "\\|"

  @doc """
  Create a new empty tag index.
  """
  @spec new() :: t()
  def new do
    %__MODULE__{}
  end

  @doc """
  Parse a tag string into its components.

  Tags are split by the `|` delimiter. Escaped delimiters (`\\|`) are
  preserved in the output.

  ## Examples

      iex> TagIndex.parse_tag("abc123")
      ["abc123"]

      iex> TagIndex.parse_tag("abc|def|ghi")
      ["abc", "def", "ghi"]

      iex> TagIndex.parse_tag("abc\\|def|ghi")
      ["abc|def", "ghi"]
  """
  @spec parse_tag(move_tag()) :: parsed_tag()
  def parse_tag(tag) when is_binary(tag) do
    # Replace escaped delimiters with a placeholder, split, then restore
    placeholder = "\x00PIPE\x00"

    tag
    |> String.replace(@escaped_delimiter, placeholder)
    |> String.split(@tag_delimiter)
    |> Enum.map(&String.replace(&1, placeholder, @tag_delimiter))
  end

  @doc """
  Get the length (number of positions) of a parsed tag.
  """
  @spec get_tag_length(parsed_tag()) :: non_neg_integer()
  def get_tag_length(parsed_tag) when is_list(parsed_tag) do
    length(parsed_tag)
  end

  @doc """
  Get the value at a specific position in a parsed tag.

  Raises if position is out of bounds.
  """
  @spec get_value(parsed_tag(), position()) :: value()
  def get_value(parsed_tag, position) when is_list(parsed_tag) and is_integer(position) do
    Enum.at(parsed_tag, position) ||
      raise ArgumentError,
            "Position #{position} out of bounds for tag with length #{length(parsed_tag)}"
  end

  @doc """
  Check if a parsed tag matches a move-out pattern.

  A tag matches if the value at the pattern's position equals the pattern's
  value, or if the tag has a wildcard (`_`) at that position.

  ## Examples

      iex> TagIndex.tag_matches_pattern?(["abc", "def"], %{pos: 0, value: "abc"})
      true

      iex> TagIndex.tag_matches_pattern?(["_", "def"], %{pos: 0, value: "abc"})
      true

      iex> TagIndex.tag_matches_pattern?(["xyz", "def"], %{pos: 0, value: "abc"})
      false
  """
  @spec tag_matches_pattern?(parsed_tag(), move_out_pattern()) :: boolean()
  def tag_matches_pattern?(parsed_tag, %{pos: pos, value: pattern_value})
      when is_list(parsed_tag) do
    case Enum.at(parsed_tag, pos) do
      nil -> false
      @tag_wildcard -> true
      tag_value -> tag_value == pattern_value
    end
  end

  @doc """
  Add a tag to the index for a given row.

  The tag length is inferred from the first tag added. Subsequent tags with
  different lengths are rejected with a warning logged.

  Wildcard values (`_`) are not indexed, as they match any pattern.
  """
  @spec add_tag(t(), row_key(), move_tag()) :: t()
  def add_tag(%__MODULE__{} = tag_index, row_key, tag) when is_binary(tag) do
    parsed_tag = parse_tag(tag)
    tag_len = get_tag_length(parsed_tag)

    tag_index = initialize_if_needed(tag_index, tag_len)

    if tag_index.tag_length != tag_len do
      require Logger

      Logger.warning(
        "Tag length mismatch: expected #{tag_index.tag_length}, got #{tag_len} for tag #{inspect(tag)}"
      )

      tag_index
    else
      add_parsed_tag_to_index(tag_index, row_key, parsed_tag)
    end
  end

  @doc """
  Add a pre-parsed tag to the index for a given row.

  Use this when you've already parsed the tag and want to avoid re-parsing.
  """
  @spec add_parsed_tag(t(), row_key(), parsed_tag()) :: t()
  def add_parsed_tag(%__MODULE__{} = tag_index, row_key, parsed_tag)
      when is_list(parsed_tag) do
    tag_len = get_tag_length(parsed_tag)
    tag_index = initialize_if_needed(tag_index, tag_len)

    if tag_index.tag_length != tag_len do
      tag_index
    else
      add_parsed_tag_to_index(tag_index, row_key, parsed_tag)
    end
  end

  defp initialize_if_needed(%__MODULE__{tag_length: nil} = tag_index, tag_len) do
    index = for _ <- 1..tag_len, do: %{}
    %{tag_index | index: index, tag_length: tag_len}
  end

  defp initialize_if_needed(tag_index, _tag_len), do: tag_index

  defp add_parsed_tag_to_index(tag_index, row_key, parsed_tag) do
    index =
      parsed_tag
      |> Enum.with_index()
      |> Enum.reduce(tag_index.index, fn {value, pos}, index ->
        if value == @tag_wildcard do
          # Don't index wildcards
          index
        else
          position_map = Enum.at(index, pos)
          row_set = Map.get(position_map, value, MapSet.new())
          updated_map = Map.put(position_map, value, MapSet.put(row_set, row_key))
          List.replace_at(index, pos, updated_map)
        end
      end)

    %{tag_index | index: index}
  end

  @doc """
  Remove a tag from the index for a given row.

  Cleans up empty sets and maps when the last row is removed.
  """
  @spec remove_tag(t(), row_key(), move_tag()) :: t()
  def remove_tag(%__MODULE__{tag_length: nil} = tag_index, _row_key, _tag) do
    # No tags have been added yet
    tag_index
  end

  def remove_tag(%__MODULE__{} = tag_index, row_key, tag) when is_binary(tag) do
    parsed_tag = parse_tag(tag)
    remove_parsed_tag(tag_index, row_key, parsed_tag)
  end

  @doc """
  Remove a pre-parsed tag from the index for a given row.
  """
  @spec remove_parsed_tag(t(), row_key(), parsed_tag()) :: t()
  def remove_parsed_tag(%__MODULE__{tag_length: nil} = tag_index, _row_key, _parsed_tag) do
    tag_index
  end

  def remove_parsed_tag(%__MODULE__{} = tag_index, row_key, parsed_tag)
      when is_list(parsed_tag) do
    if get_tag_length(parsed_tag) != tag_index.tag_length do
      tag_index
    else
      index =
        parsed_tag
        |> Enum.with_index()
        |> Enum.reduce(tag_index.index, fn {value, pos}, index ->
          if value == @tag_wildcard do
            index
          else
            position_map = Enum.at(index, pos)

            case Map.get(position_map, value) do
              nil ->
                index

              row_set ->
                new_set = MapSet.delete(row_set, row_key)

                updated_map =
                  if MapSet.size(new_set) == 0 do
                    Map.delete(position_map, value)
                  else
                    Map.put(position_map, value, new_set)
                  end

                List.replace_at(index, pos, updated_map)
            end
          end
        end)

      %{tag_index | index: index}
    end
  end

  @doc """
  Find all rows that have a tag matching the given pattern.

  Uses the positional index for O(1) lookup.

  ## Examples

      iex> index = TagIndex.new() |> TagIndex.add_tag("row1", "abc|def")
      iex> TagIndex.find_rows_matching_pattern(index, %{pos: 0, value: "abc"})
      MapSet.new(["row1"])

      iex> index = TagIndex.new()
      iex> TagIndex.find_rows_matching_pattern(index, %{pos: 0, value: "abc"})
      MapSet.new([])
  """
  @spec find_rows_matching_pattern(t(), move_out_pattern()) :: MapSet.t(row_key())
  def find_rows_matching_pattern(%__MODULE__{tag_length: nil}, _pattern) do
    MapSet.new()
  end

  def find_rows_matching_pattern(%__MODULE__{index: index}, %{pos: pos, value: value}) do
    case Enum.at(index, pos) do
      nil -> MapSet.new()
      position_map -> Map.get(position_map, value, MapSet.new())
    end
  end

  @doc """
  Clear all entries from the index.
  """
  @spec clear(t()) :: t()
  def clear(%__MODULE__{}) do
    new()
  end

  @doc """
  Check if the index is empty (no tags have been added).
  """
  @spec empty?(t()) :: boolean()
  def empty?(%__MODULE__{tag_length: nil}), do: true
  def empty?(%__MODULE__{}), do: false
end
