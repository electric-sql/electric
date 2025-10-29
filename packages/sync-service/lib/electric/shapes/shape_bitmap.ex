defmodule Electric.Shapes.ShapeBitmap do
  @moduledoc """
  Utility module for managing the mapping between shape handles and integer IDs
  required by RoaringBitmap.

  This module provides bidirectional mapping between arbitrary shape handles
  (which can be any term) and compact integer IDs (u32) used by the bitmap
  implementation.

  ## Architecture

  Roaring bitmaps require integer IDs, but Electric's shapes use arbitrary terms
  as handles. This module bridges that gap by:

  1. Assigning sequential u32 IDs to shapes as they're added
  2. Maintaining bidirectional mappings (handle <-> ID)
  3. Converting between MapSets of handles and RoaringBitmaps of IDs
  4. Reclaiming IDs when shapes are removed

  This enables the Filter system to use highly-optimized bitmap operations
  (union, intersection) while maintaining the existing shape handle API.
  """

  alias Electric.Shapes.RoaringBitmap

  defstruct handle_to_id: %{},
            id_to_handle: %{},
            next_id: 0,
            # Track free IDs from removed shapes for reuse
            free_ids: []

  @type shape_handle :: term()
  @type shape_id :: non_neg_integer()
  @type t :: %__MODULE__{
          handle_to_id: %{shape_handle() => shape_id()},
          id_to_handle: %{shape_id() => shape_handle()},
          next_id: non_neg_integer(),
          free_ids: [shape_id()]
        }

  @doc """
  Creates a new empty ShapeBitmap mapping.
  """
  @spec new() :: t()
  def new do
    %__MODULE__{}
  end

  @doc """
  Adds a shape handle to the mapping, assigning it a unique integer ID.
  Returns the updated mapping and the assigned ID.
  """
  @spec add_shape(t(), shape_handle()) :: {t(), shape_id()}
  def add_shape(%__MODULE__{} = mapping, handle) do
    if Map.has_key?(mapping.handle_to_id, handle) do
      raise ArgumentError, "Shape handle #{inspect(handle)} already exists in mapping"
    end

    {id, mapping} =
      case mapping.free_ids do
        [id | rest] ->
          # Reuse a free ID from a previously removed shape
          {id, %{mapping | free_ids: rest}}

        [] ->
          # Allocate a new ID
          {mapping.next_id, %{mapping | next_id: mapping.next_id + 1}}
      end

    mapping = %{
      mapping
      | handle_to_id: Map.put(mapping.handle_to_id, handle, id),
        id_to_handle: Map.put(mapping.id_to_handle, id, handle)
    }

    {mapping, id}
  end

  @doc """
  Removes a shape handle from the mapping, freeing its ID for reuse.
  Returns the updated mapping and the freed ID.
  """
  @spec remove_shape(t(), shape_handle()) :: {t(), shape_id()}
  def remove_shape(%__MODULE__{} = mapping, handle) do
    case Map.fetch(mapping.handle_to_id, handle) do
      {:ok, id} ->
        mapping = %{
          mapping
          | handle_to_id: Map.delete(mapping.handle_to_id, handle),
            id_to_handle: Map.delete(mapping.id_to_handle, id),
            free_ids: [id | mapping.free_ids]
        }

        {mapping, id}

      :error ->
        raise ArgumentError, "Shape handle #{inspect(handle)} not found in mapping"
    end
  end

  @doc """
  Gets the integer ID for a shape handle.
  Returns `{:ok, id}` if found, `:error` otherwise.
  """
  @spec get_id(t(), shape_handle()) :: {:ok, shape_id()} | :error
  def get_id(%__MODULE__{} = mapping, handle) do
    Map.fetch(mapping.handle_to_id, handle)
  end

  @doc """
  Gets the integer ID for a shape handle, raising if not found.
  """
  @spec get_id!(t(), shape_handle()) :: shape_id()
  def get_id!(%__MODULE__{} = mapping, handle) do
    case get_id(mapping, handle) do
      {:ok, id} -> id
      :error -> raise ArgumentError, "Shape handle #{inspect(handle)} not found in mapping"
    end
  end

  @doc """
  Gets the shape handle for an integer ID.
  Returns `{:ok, handle}` if found, `:error` otherwise.
  """
  @spec get_handle(t(), shape_id()) :: {:ok, shape_handle()} | :error
  def get_handle(%__MODULE__{} = mapping, id) do
    Map.fetch(mapping.id_to_handle, id)
  end

  @doc """
  Gets the shape handle for an integer ID, raising if not found.
  """
  @spec get_handle!(t(), shape_id()) :: shape_handle()
  def get_handle!(%__MODULE__{} = mapping, id) do
    case get_handle(mapping, id) do
      {:ok, handle} -> handle
      :error -> raise ArgumentError, "Shape ID #{id} not found in mapping"
    end
  end

  @doc """
  Checks if a shape handle exists in the mapping.
  """
  @spec has_handle?(t(), shape_handle()) :: boolean()
  def has_handle?(%__MODULE__{} = mapping, handle) do
    Map.has_key?(mapping.handle_to_id, handle)
  end

  @doc """
  Returns the number of shapes in the mapping.
  """
  @spec size(t()) :: non_neg_integer()
  def size(%__MODULE__{} = mapping) do
    map_size(mapping.handle_to_id)
  end

  @doc """
  Creates a RoaringBitmap from a MapSet of shape handles.
  """
  @spec from_handles(t(), MapSet.t(shape_handle())) :: RoaringBitmap.t()
  def from_handles(%__MODULE__{} = mapping, handles) do
    ids =
      handles
      |> MapSet.to_list()
      |> Enum.map(&get_id!(mapping, &1))

    RoaringBitmap.from_list(ids)
  end

  @doc """
  Converts a RoaringBitmap to a MapSet of shape handles.
  """
  @spec to_handles(t(), RoaringBitmap.t()) :: MapSet.t(shape_handle())
  def to_handles(%__MODULE__{} = mapping, bitmap) do
    bitmap
    |> RoaringBitmap.to_list()
    |> Enum.map(&get_handle!(mapping, &1))
    |> MapSet.new()
  end

  @doc """
  Creates a RoaringBitmap containing a single shape ID.
  """
  @spec bitmap_for_handle(t(), shape_handle()) :: RoaringBitmap.t()
  def bitmap_for_handle(%__MODULE__{} = mapping, handle) do
    id = get_id!(mapping, handle)
    RoaringBitmap.from_list([id])
  end

  @doc """
  Creates a RoaringBitmap containing all shape IDs in the mapping.
  """
  @spec all_shapes_bitmap(t()) :: RoaringBitmap.t()
  def all_shapes_bitmap(%__MODULE__{} = mapping) do
    mapping.handle_to_id
    |> Map.values()
    |> RoaringBitmap.from_list()
  end

  @doc """
  Returns all shape handles in the mapping.
  """
  @spec all_handles(t()) :: [shape_handle()]
  def all_handles(%__MODULE__{} = mapping) do
    Map.keys(mapping.handle_to_id)
  end
end
