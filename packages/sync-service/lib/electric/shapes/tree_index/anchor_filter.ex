defmodule Electric.Shapes.TreeIndex.AnchorFilter do
  @moduledoc """
  Provides permission anchor filtering for shapes.

  This module enables shapes to filter records based on precomputed permission
  anchors. Instead of expressing permission inheritance as recursive WHERE
  clauses, shapes can use the computed `perm_anchor_id` for simple membership
  checks.

  ## How It Works

  1. The `PermissionAnchorIndex` maintains a `block_id -> perm_anchor_id` mapping
  2. Shapes define which anchors a user can access (via subquery or explicit list)
  3. This filter checks if a record's anchor is in the accessible set

  ## Usage in Shapes

  There are two ways to use anchor filtering:

  ### Option 1: Virtual Column in WHERE Clause

  ```
  GET /v1/shape?table=blocks
    &where=page_id=$1 AND __perm_anchor_id IN (SELECT anchor_id FROM user_anchors WHERE user_id=$2)
  ```

  The `__perm_anchor_id` virtual column is resolved by looking up the record's
  ID in the permission anchor index.

  ### Option 2: Shape Configuration

  ```elixir
  %Shape{
    root_table: {"public", "blocks"},
    where: "page_id = $1",
    anchor_filter: %{
      accessible_anchors: ["anchor-1", "anchor-2", "anchor-3"]
    }
  }
  ```

  ## Filter Semantics

  A record passes the filter if:
  1. The record's ID exists in the permission anchor index, AND
  2. The record's computed `perm_anchor_id` is in the set of accessible anchors

  Records not in the index are excluded by default (fail-safe).
  """

  alias Electric.Shapes.TreeIndex.PermissionAnchorIndex

  require Logger

  @type filter_config :: %{
          accessible_anchors: MapSet.t(String.t()) | [String.t()],
          fail_open: boolean()
        }

  @doc """
  Check if a record passes the permission anchor filter.

  ## Parameters

  - `stack_id`: The Electric stack ID
  - `table`: The table relation (e.g., `{"public", "blocks"}`)
  - `record`: The record to check (must include the ID column)
  - `id_column`: Name of the ID column in the record
  - `accessible_anchors`: Set of anchor IDs the user can access

  ## Returns

  - `true` if the record's anchor is in the accessible set
  - `false` if the record's anchor is not accessible or record not in index
  """
  @spec includes_record?(String.t(), Electric.relation(), map(), String.t(), MapSet.t(String.t())) ::
          boolean()
  def includes_record?(stack_id, table, record, id_column, accessible_anchors) do
    block_id = Map.get(record, id_column)

    if block_id == nil do
      Logger.warning("Record missing ID column #{id_column}: #{inspect(record)}")
      false
    else
      case PermissionAnchorIndex.get_anchor(stack_id, table, block_id) do
        nil ->
          # Block not in index - fail-safe to exclusion
          Logger.debug(fn -> "Block #{block_id} not in permission anchor index" end)
          false

        anchor_id ->
          MapSet.member?(accessible_anchors, anchor_id)
      end
    end
  end

  @doc """
  Filter a list of records based on permission anchors.

  More efficient than calling `includes_record?/5` repeatedly as it batches
  the index lookups.
  """
  @spec filter_records(
          String.t(),
          Electric.relation(),
          [map()],
          String.t(),
          MapSet.t(String.t())
        ) :: [map()]
  def filter_records(stack_id, table, records, id_column, accessible_anchors) do
    # Get all block IDs
    block_ids = Enum.map(records, &Map.get(&1, id_column))

    # Batch lookup anchors
    anchors_map = PermissionAnchorIndex.get_anchors_for_blocks(stack_id, table, block_ids)

    # Filter records
    Enum.filter(records, fn record ->
      block_id = Map.get(record, id_column)
      anchor_id = Map.get(anchors_map, block_id)
      anchor_id != nil and MapSet.member?(accessible_anchors, anchor_id)
    end)
  end

  @doc """
  Build a filter function that can be used in shape processing.

  Returns a function that takes a record and returns true/false.
  """
  @spec build_filter_fn(String.t(), Electric.relation(), String.t(), MapSet.t(String.t())) ::
          (map() -> boolean())
  def build_filter_fn(stack_id, table, id_column, accessible_anchors) do
    fn record ->
      includes_record?(stack_id, table, record, id_column, accessible_anchors)
    end
  end

  @doc """
  Compute which blocks would be visible if the accessible anchors changed.

  Useful for implementing move-in semantics when permission changes.
  """
  @spec blocks_for_anchors(String.t(), Electric.relation(), MapSet.t(String.t())) :: [String.t()]
  def blocks_for_anchors(stack_id, table, anchor_ids) do
    anchor_ids
    |> Enum.flat_map(fn anchor_id ->
      PermissionAnchorIndex.get_blocks_with_anchor(stack_id, table, anchor_id)
    end)
    |> Enum.uniq()
  end

  @doc """
  Get the anchor ID for a specific block.

  Convenience wrapper around `PermissionAnchorIndex.get_anchor/3`.
  """
  @spec get_anchor(String.t(), Electric.relation(), String.t()) :: String.t() | nil
  def get_anchor(stack_id, table, block_id) do
    PermissionAnchorIndex.get_anchor(stack_id, table, block_id)
  end
end
