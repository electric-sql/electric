defmodule Electric.Shapes.RoaringBitmap do
  @moduledoc """
  Elixir wrapper for RoaringBitmap NIF.

  Provides a high-performance compressed bitmap implementation for efficiently
  tracking sets of shape IDs in the shape routing system.

  Roaring bitmaps provide excellent compression and fast operations for set
  operations like union, intersection, and membership testing.
  """

  use Rustler, otp_app: :electric, crate: "roaring_nif"

  @type t :: reference()

  @doc """
  Creates a new empty bitmap.
  """
  @spec new() :: t()
  def new(), do: error()

  @doc """
  Creates a bitmap from a list of integers.
  """
  @spec from_list([non_neg_integer()]) :: t()
  def from_list(_values), do: error()

  @doc """
  Adds a value to the bitmap, returning a new bitmap.
  """
  @spec add(t(), non_neg_integer()) :: t()
  def add(_bitmap, _value), do: error()

  @doc """
  Adds multiple values to the bitmap, returning a new bitmap.
  """
  @spec add_many(t(), [non_neg_integer()]) :: t()
  def add_many(_bitmap, _values), do: error()

  @doc """
  Removes a value from the bitmap, returning a new bitmap.
  """
  @spec remove(t(), non_neg_integer()) :: t()
  def remove(_bitmap, _value), do: error()

  @doc """
  Checks if the bitmap contains a value.
  """
  @spec contains?(t(), non_neg_integer()) :: boolean()
  def contains?(bitmap, value), do: contains(bitmap, value)

  # NIF function - returns true if bitmap contains value
  defp contains(_bitmap, _value), do: error()

  @doc """
  Returns the union of two bitmaps.
  """
  @spec union(t(), t()) :: t()
  def union(_bitmap1, _bitmap2), do: error()

  @doc """
  Returns the intersection of two bitmaps.
  """
  @spec intersection(t(), t()) :: t()
  def intersection(_bitmap1, _bitmap2), do: error()

  @doc """
  Returns the difference of two bitmaps (elements in first but not in second).
  """
  @spec difference(t(), t()) :: t()
  def difference(_bitmap1, _bitmap2), do: error()

  @doc """
  Returns the number of elements in the bitmap.
  """
  @spec cardinality(t()) :: non_neg_integer()
  def cardinality(_bitmap), do: error()

  @doc """
  Checks if the bitmap is empty.
  """
  @spec empty?(t()) :: boolean()
  def empty?(bitmap), do: is_empty(bitmap)

  # NIF function - returns true if bitmap is empty
  defp is_empty(_bitmap), do: error()

  @doc """
  Converts the bitmap to a list of integers.
  """
  @spec to_list(t()) :: [non_neg_integer()]
  def to_list(_bitmap), do: error()

  @doc """
  Clears all elements from the bitmap.
  """
  @spec clear(t()) :: t()
  def clear(_bitmap), do: error()

  @doc """
  Checks if two bitmaps are equal.
  """
  @spec equal?(t(), t()) :: boolean()
  def equal?(bitmap1, bitmap2), do: equal(bitmap1, bitmap2)

  # NIF function - returns true if bitmaps are equal
  defp equal(_bitmap1, _bitmap2), do: error()

  @doc """
  Checks if the first bitmap is a subset of the second.
  """
  @spec subset?(t(), t()) :: boolean()
  def subset?(bitmap1, bitmap2), do: is_subset(bitmap1, bitmap2)

  # NIF function - returns true if first bitmap is subset of second
  defp is_subset(_bitmap1, _bitmap2), do: error()

  @doc """
  Returns the union of multiple bitmaps in a single operation.
  More efficient than chaining union/2 calls.
  """
  @spec union_many([t()]) :: t()
  def union_many(_bitmaps), do: error()

  @doc """
  Returns the intersection of multiple bitmaps in a single operation.
  More efficient than chaining intersection/2 calls.
  """
  @spec intersection_many([t()]) :: t()
  def intersection_many(_bitmaps), do: error()

  @doc """
  Checks if any bitmap in the list contains the value.
  Returns true on first match (early exit optimization).
  """
  @spec any_contains?([t()], non_neg_integer()) :: boolean()
  def any_contains?(_bitmaps, _value), do: error()

  @doc """
  Returns the minimum value in the bitmap, or nil if empty.
  """
  @spec min(t()) :: non_neg_integer() | nil
  def min(_bitmap), do: error()

  @doc """
  Returns the maximum value in the bitmap, or nil if empty.
  """
  @spec max(t()) :: non_neg_integer() | nil
  def max(_bitmap), do: error()

  defp error do
    :erlang.nif_error(:nif_not_loaded)
  end
end
