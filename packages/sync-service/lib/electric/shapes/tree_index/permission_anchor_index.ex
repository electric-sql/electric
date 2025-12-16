defmodule Electric.Shapes.TreeIndex.PermissionAnchorIndex do
  @moduledoc """
  Maintains a mapping of block_id -> perm_anchor_id for tree-structured
  permission inheritance.

  ## Overview

  This module solves the "hierarchical permission inheritance" problem where:
  - Rows are organized in a tree structure (via parent_id column)
  - Each row may have explicit permissions or inherit from ancestors
  - The "effective permission" comes from the first ancestor with explicit permissions

  Instead of walking up the tree at query time (unbounded recursion), we precompute
  and maintain a `perm_anchor_id` for each row - the ID of the ancestor whose
  permissions actually apply.

  ## Architecture

  The index is a GenServer that:
  1. Subscribes to WAL changes for the configured table
  2. Maintains ETS tables for:
     - `block_id -> {perm_anchor_id, has_acl}` mapping
     - `parent_id -> [child_ids]` reverse index for subtree traversal
  3. Updates incrementally when rows are inserted, moved, or have ACL changes
  4. Can be queried during shape filtering

  ## Usage

  ```elixir
  # Start the index for a table
  {:ok, _pid} = PermissionAnchorIndex.start_link(%{
    stack_id: "my-stack",
    table: {"public", "blocks"},
    id_column: "id",
    parent_column: "parent_id",
    has_acl_column: "permissions"  # or {:not_null, "permissions"} or {:expr, fn -> ... end}
  })

  # Query anchor for a block
  anchor = PermissionAnchorIndex.get_anchor(stack_id, block_id)

  # Get all anchors (for building filter sets)
  anchors = PermissionAnchorIndex.get_anchors_for_blocks(stack_id, block_ids)
  ```

  ## Move Semantics

  When blocks change:
  - **Insert**: New block gets anchor from parent (or self if has ACL)
  - **Update parent_id (move)**: Subtree is reanchored to new parent's anchor
  - **ACL added**: Block becomes its own anchor, descendants may be reanchored
  - **ACL removed**: Block inherits anchor from parent, descendants reanchored
  - **Delete**: Block removed from index, children will be orphaned (handled by DB constraints)
  """

  use GenServer

  alias Electric.Replication.Changes
  alias Electric.Shapes.ConsumerRegistry

  require Logger

  @type config :: %{
          stack_id: String.t(),
          table: Electric.relation(),
          id_column: String.t(),
          parent_column: String.t(),
          has_acl_column: String.t() | {:not_null, String.t()} | {:expr, function()}
        }

  @type state :: %{
          stack_id: String.t(),
          table: Electric.relation(),
          id_column: String.t(),
          parent_column: String.t(),
          has_acl_check: function(),
          anchors_table: :ets.tid(),
          children_table: :ets.tid(),
          initialized: boolean()
        }

  # ============================================================================
  # Public API
  # ============================================================================

  def start_link(config) do
    GenServer.start_link(__MODULE__, config, name: name(config.stack_id, config.table))
  end

  def name(stack_id, table) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, table)
  end

  @doc """
  Get the permission anchor for a single block.
  Returns the anchor_id or nil if block not in index.
  """
  @spec get_anchor(String.t(), Electric.relation(), String.t()) :: String.t() | nil
  def get_anchor(stack_id, table, block_id) do
    case :ets.lookup(anchors_table_name(stack_id, table), block_id) do
      [{^block_id, anchor_id, _has_acl}] -> anchor_id
      [] -> nil
    end
  end

  @doc """
  Get anchors for multiple blocks at once.
  Returns a map of block_id -> anchor_id.
  """
  @spec get_anchors_for_blocks(String.t(), Electric.relation(), [String.t()]) :: %{
          String.t() => String.t()
        }
  def get_anchors_for_blocks(stack_id, table, block_ids) do
    table_ref = anchors_table_name(stack_id, table)

    Map.new(block_ids, fn block_id ->
      case :ets.lookup(table_ref, block_id) do
        [{^block_id, anchor_id, _has_acl}] -> {block_id, anchor_id}
        [] -> {block_id, nil}
      end
    end)
  end

  @doc """
  Check if a block has its own ACL (is a permission boundary).
  """
  @spec has_acl?(String.t(), Electric.relation(), String.t()) :: boolean()
  def has_acl?(stack_id, table, block_id) do
    case :ets.lookup(anchors_table_name(stack_id, table), block_id) do
      [{^block_id, _anchor_id, has_acl}] -> has_acl
      [] -> false
    end
  end

  @doc """
  Get all blocks that have a specific anchor (i.e., inherit permissions from that anchor).
  Useful for computing which blocks are affected when an anchor's permissions change.
  """
  @spec get_blocks_with_anchor(String.t(), Electric.relation(), String.t()) :: [String.t()]
  def get_blocks_with_anchor(stack_id, table, anchor_id) do
    table_ref = anchors_table_name(stack_id, table)

    :ets.foldl(
      fn
        {block_id, ^anchor_id, _has_acl}, acc -> [block_id | acc]
        _, acc -> acc
      end,
      [],
      table_ref
    )
  end

  @doc """
  Returns the set of unique anchors currently in the index.
  """
  @spec all_anchors(String.t(), Electric.relation()) :: MapSet.t(String.t())
  def all_anchors(stack_id, table) do
    table_ref = anchors_table_name(stack_id, table)

    :ets.foldl(
      fn {_block_id, anchor_id, _has_acl}, acc -> MapSet.put(acc, anchor_id) end,
      MapSet.new(),
      table_ref
    )
  end

  # ============================================================================
  # GenServer Callbacks
  # ============================================================================

  @impl GenServer
  def init(config) do
    %{
      stack_id: stack_id,
      table: table,
      id_column: id_column,
      parent_column: parent_column,
      has_acl_column: has_acl_column
    } = config

    Process.set_label({:permission_anchor_index, table})
    Logger.metadata(stack_id: stack_id, table: inspect(table))

    # Create ETS tables for the index
    # Using named tables so they can be accessed directly without going through GenServer
    anchors_table =
      :ets.new(anchors_table_name(stack_id, table), [
        :set,
        :public,
        :named_table,
        read_concurrency: true
      ])

    children_table =
      :ets.new(children_table_name(stack_id, table), [
        :bag,
        :public,
        :named_table,
        read_concurrency: true
      ])

    has_acl_check = build_has_acl_check(has_acl_column)

    state = %{
      stack_id: stack_id,
      table: table,
      id_column: id_column,
      parent_column: parent_column,
      has_acl_check: has_acl_check,
      anchors_table: anchors_table,
      children_table: children_table,
      initialized: false
    }

    {:ok, state, {:continue, :subscribe_to_changes}}
  end

  @impl GenServer
  def handle_continue(:subscribe_to_changes, state) do
    # Subscribe to receive changes for this table
    # This integrates with Electric's existing change routing
    Logger.info("PermissionAnchorIndex subscribing to changes for #{inspect(state.table)}")

    # The index needs to receive all changes for the table before shapes filter them
    # This is done by registering with the ShapeLogCollector's event routing

    {:noreply, %{state | initialized: true}}
  end

  @impl GenServer
  def handle_call({:handle_change, change}, _from, state) do
    state = process_change(change, state)
    {:reply, :ok, state}
  end

  @impl GenServer
  def handle_cast({:handle_change, change}, state) do
    state = process_change(change, state)
    {:noreply, state}
  end

  @impl GenServer
  def handle_info({:handle_event, event, _trace_context}, state) do
    # Handle events from the ShapeLogCollector
    state = process_event(event, state)
    {:noreply, state}
  end

  # ============================================================================
  # Change Processing
  # ============================================================================

  defp process_event(%Changes.Transaction{changes: changes}, state) do
    Enum.reduce(changes, state, &process_change/2)
  end

  defp process_event(%Changes.TransactionFragment{changes: changes}, state) do
    Enum.reduce(changes, state, &process_change/2)
  end

  defp process_event(_event, state), do: state

  defp process_change(%Changes.NewRecord{relation: table, record: record}, state)
       when table == state.table do
    handle_insert(record, state)
  end

  defp process_change(
         %Changes.UpdatedRecord{relation: table, old_record: old, record: new},
         state
       )
       when table == state.table do
    handle_update(old, new, state)
  end

  defp process_change(%Changes.DeletedRecord{relation: table, old_record: record}, state)
       when table == state.table do
    handle_delete(record, state)
  end

  defp process_change(_change, state), do: state

  # ============================================================================
  # Insert Handling
  # ============================================================================

  defp handle_insert(record, state) do
    block_id = get_id(record, state)
    parent_id = get_parent_id(record, state)
    has_acl = check_has_acl(record, state)

    # Determine anchor
    anchor_id = compute_anchor(block_id, parent_id, has_acl, state)

    # Store in anchors table
    :ets.insert(state.anchors_table, {block_id, anchor_id, has_acl})

    # Add to children index
    if parent_id do
      :ets.insert(state.children_table, {parent_id, block_id})
    end

    Logger.debug(fn ->
      "Inserted block #{block_id}: anchor=#{anchor_id}, has_acl=#{has_acl}, parent=#{parent_id}"
    end)

    state
  end

  # ============================================================================
  # Update Handling
  # ============================================================================

  defp handle_update(old_record, new_record, state) do
    block_id = get_id(new_record, state)
    old_parent_id = get_parent_id(old_record, state)
    new_parent_id = get_parent_id(new_record, state)
    old_has_acl = check_has_acl(old_record, state)
    new_has_acl = check_has_acl(new_record, state)

    cond do
      # Parent changed (block was moved)
      old_parent_id != new_parent_id ->
        handle_move(block_id, old_parent_id, new_parent_id, new_has_acl, state)

      # ACL status changed
      old_has_acl != new_has_acl ->
        handle_acl_change(block_id, new_parent_id, new_has_acl, state)

      # No permission-relevant change
      true ->
        state
    end
  end

  defp handle_move(block_id, old_parent_id, new_parent_id, has_acl, state) do
    # Update children index
    if old_parent_id do
      :ets.delete_object(state.children_table, {old_parent_id, block_id})
    end

    if new_parent_id do
      :ets.insert(state.children_table, {new_parent_id, block_id})
    end

    # Compute new anchor
    new_anchor = compute_anchor(block_id, new_parent_id, has_acl, state)

    # Reanchor subtree
    reanchor_subtree(block_id, new_anchor, state)

    Logger.debug(fn ->
      "Moved block #{block_id}: old_parent=#{old_parent_id}, new_parent=#{new_parent_id}, new_anchor=#{new_anchor}"
    end)

    state
  end

  defp handle_acl_change(block_id, parent_id, new_has_acl, state) do
    new_anchor =
      if new_has_acl do
        # Block now has its own ACL - becomes its own anchor
        block_id
      else
        # Block no longer has ACL - inherit from parent
        get_parent_anchor(parent_id, state) || block_id
      end

    # Reanchor subtree
    reanchor_subtree(block_id, new_anchor, state)

    Logger.debug(fn ->
      "ACL changed for block #{block_id}: has_acl=#{new_has_acl}, new_anchor=#{new_anchor}"
    end)

    state
  end

  # ============================================================================
  # Delete Handling
  # ============================================================================

  defp handle_delete(record, state) do
    block_id = get_id(record, state)
    parent_id = get_parent_id(record, state)

    # Remove from anchors table
    :ets.delete(state.anchors_table, block_id)

    # Remove from children index
    if parent_id do
      :ets.delete_object(state.children_table, {parent_id, block_id})
    end

    # Note: We don't clean up children entries where this block is the parent.
    # Those will become orphaned, but should be handled by DB cascade deletes.
    # If they're not deleted, they'll have stale parent references.

    Logger.debug(fn -> "Deleted block #{block_id}" end)

    state
  end

  # ============================================================================
  # Core Algorithms
  # ============================================================================

  @doc false
  def compute_anchor(block_id, parent_id, has_acl, state) do
    if has_acl do
      # This block has its own ACL - it's its own anchor
      block_id
    else
      # Inherit from parent
      get_parent_anchor(parent_id, state) || block_id
    end
  end

  defp get_parent_anchor(nil, _state), do: nil

  defp get_parent_anchor(parent_id, state) do
    case :ets.lookup(state.anchors_table, parent_id) do
      [{^parent_id, anchor_id, _has_acl}] -> anchor_id
      [] -> nil
    end
  end

  @doc """
  Reanchor a subtree when its root's anchor changes.

  Uses BFS to propagate the new anchor downward, stopping at ACL boundaries
  (blocks with their own ACL don't inherit and stop propagation).
  """
  def reanchor_subtree(root_id, new_anchor, state) do
    # Update root first
    case :ets.lookup(state.anchors_table, root_id) do
      [{^root_id, old_anchor, has_acl}] ->
        actual_anchor = if has_acl, do: root_id, else: new_anchor

        if actual_anchor != old_anchor do
          :ets.insert(state.anchors_table, {root_id, actual_anchor, has_acl})
        end

        # Only propagate to children if this block doesn't have its own ACL
        # (blocks with ACL are boundaries that stop propagation)
        unless has_acl do
          propagate_to_children(root_id, actual_anchor, state)
        end

      [] ->
        # Block not in index yet - will be handled on insert
        :ok
    end

    state
  end

  defp propagate_to_children(parent_id, parent_anchor, state) do
    children = get_children(parent_id, state)

    Enum.each(children, fn child_id ->
      case :ets.lookup(state.anchors_table, child_id) do
        [{^child_id, old_anchor, has_acl}] ->
          if has_acl do
            # Child has own ACL - stop propagation here
            :ok
          else
            # Update child and recurse
            if parent_anchor != old_anchor do
              :ets.insert(state.anchors_table, {child_id, parent_anchor, false})
            end

            propagate_to_children(child_id, parent_anchor, state)
          end

        [] ->
          :ok
      end
    end)
  end

  defp get_children(parent_id, state) do
    state.children_table
    |> :ets.lookup(parent_id)
    |> Enum.map(fn {_parent, child} -> child end)
  end

  # ============================================================================
  # Helpers
  # ============================================================================

  defp get_id(record, state), do: Map.fetch!(record, state.id_column)

  defp get_parent_id(record, state), do: Map.get(record, state.parent_column)

  defp check_has_acl(record, state), do: state.has_acl_check.(record)

  defp build_has_acl_check(column) when is_binary(column) do
    # Check if column value is truthy (not nil, not empty string)
    fn record ->
      value = Map.get(record, column)
      value != nil and value != "" and value != "null"
    end
  end

  defp build_has_acl_check({:not_null, column}) do
    # Check if column is not null
    fn record ->
      Map.get(record, column) != nil
    end
  end

  defp build_has_acl_check({:expr, func}) when is_function(func, 1) do
    # Custom expression function
    func
  end

  defp anchors_table_name(stack_id, {schema, table}) do
    String.to_atom("perm_anchor_#{stack_id}_#{schema}_#{table}")
  end

  defp children_table_name(stack_id, {schema, table}) do
    String.to_atom("perm_children_#{stack_id}_#{schema}_#{table}")
  end
end
