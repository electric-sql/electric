defmodule Electric.Shapes.TreeIndex.ChangeHandler do
  @moduledoc """
  Handles routing of changes to tree indexes.

  This module provides the integration point between Electric's change processing
  pipeline and the tree index system. It intercepts changes before they're filtered
  by shapes and updates the relevant tree indexes.

  ## Integration Points

  The change handler can be integrated in two ways:

  1. **As a pre-filter in ShapeLogCollector**: Changes are sent to tree indexes
     before being matched to shapes. This ensures indexes are up-to-date when
     shapes evaluate their filters.

  2. **As a parallel subscriber**: Tree indexes subscribe to all changes for
     their configured tables, similar to how Materializers work.

  ## Usage

  ```elixir
  # In ShapeLogCollector, before routing to shapes:
  ChangeHandler.process_changes(stack_id, changes)

  # The handler will:
  # 1. Identify which tree indexes are affected
  # 2. Send changes to those indexes
  # 3. Wait for indexes to update (optional, for consistency)
  ```
  """

  alias Electric.Replication.Changes
  alias Electric.Shapes.TreeIndex.PermissionAnchorIndex

  require Logger

  @doc """
  Process a list of changes, routing them to appropriate tree indexes.

  This should be called before shapes filter the changes, so that indexes
  are up-to-date when WHERE clauses are evaluated.
  """
  @spec process_changes(String.t(), [Changes.change()], keyword()) :: :ok
  def process_changes(stack_id, changes, opts \\ []) do
    # Group changes by table
    changes_by_table = group_by_table(changes)

    # For each table, check if there's a tree index and send changes
    Enum.each(changes_by_table, fn {table, table_changes} ->
      maybe_send_to_permission_anchor_index(stack_id, table, table_changes, opts)
    end)

    :ok
  end

  @doc """
  Process a single transaction, routing changes to tree indexes.
  """
  @spec process_transaction(String.t(), Changes.Transaction.t(), keyword()) :: :ok
  def process_transaction(stack_id, %Changes.Transaction{changes: changes}, opts) do
    process_changes(stack_id, changes, opts)
  end

  @spec process_transaction(String.t(), Changes.TransactionFragment.t(), keyword()) :: :ok
  def process_transaction(stack_id, %Changes.TransactionFragment{changes: changes}, opts) do
    process_changes(stack_id, changes, opts)
  end

  # ============================================================================
  # Private Functions
  # ============================================================================

  defp group_by_table(changes) do
    Enum.group_by(changes, fn
      %{relation: relation} -> relation
      _ -> nil
    end)
    |> Map.delete(nil)
  end

  defp maybe_send_to_permission_anchor_index(stack_id, table, changes, opts) do
    case GenServer.whereis(PermissionAnchorIndex.name(stack_id, table)) do
      nil ->
        # No permission anchor index for this table
        :ok

      pid ->
        # Send changes to the index
        async? = Keyword.get(opts, :async, true)

        Enum.each(changes, fn change ->
          if async? do
            GenServer.cast(pid, {:handle_change, change})
          else
            GenServer.call(pid, {:handle_change, change})
          end
        end)
    end
  end

  @doc """
  Check if any tree indexes need to be notified about changes to a table.
  """
  @spec has_index_for_table?(String.t(), Electric.relation()) :: boolean()
  def has_index_for_table?(stack_id, table) do
    case GenServer.whereis(PermissionAnchorIndex.name(stack_id, table)) do
      nil -> false
      _pid -> true
    end
  end

  @doc """
  Get the list of tables that have tree indexes in a stack.
  """
  @spec indexed_tables(String.t()) :: [Electric.relation()]
  def indexed_tables(stack_id) do
    # This would need to be tracked by the supervisor
    # For now, return empty list - would be populated from config
    []
  end
end
