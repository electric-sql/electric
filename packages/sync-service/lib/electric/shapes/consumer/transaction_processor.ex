defmodule Electric.Shapes.Consumer.TransactionProcessor do
  @moduledoc """
  Processes transactions through the buffering/filtering pipeline.

  Decides whether to buffer, filter, or process each transaction based on
  the BufferingCoordinator's state.

  This module is pure decision logic - it doesn't perform side effects like
  writing to storage (that's done by the caller in Consumer).
  """

  alias Electric.Shapes.Consumer.ConsumerContext
  alias Electric.Shapes.Consumer.BufferingCoordinator
  alias Electric.Shapes.Consumer.SnapshotCoordinator
  alias Electric.Replication.Changes.Transaction

  @type process_result ::
          {:buffer, ConsumerContext.t()}
          | {:filter, ConsumerContext.t()}
          | {:process, ConsumerContext.t()}

  @doc """
  Processes a transaction through the buffering/filtering pipeline.

  Returns:
  - `{:buffer, ctx}` - Transaction should be buffered
  - `{:filter, ctx}` - Transaction should be filtered (already in snapshot)
  - `{:process, ctx}` - Transaction should be processed normally
  """
  @spec process(Transaction.t(), ConsumerContext.t()) :: process_result()
  def process(txn, ctx) do
    case BufferingCoordinator.check_transaction(ctx.coordinator, txn) do
      :buffer ->
        {:buffer, ConsumerContext.buffer_transaction(ctx, txn)}

      :filter_initial ->
        # Transaction visible in initial snapshot - mark as flushed but don't process
        {:filter, ctx}

      :process ->
        # Process normally, but first clean up completed move-ins and update filtering state
        ctx =
          ctx
          |> cleanup_completed_move_ins(txn)
          |> SnapshotCoordinator.maybe_stop_initial_filtering(txn)

        {:process, ctx}
    end
  end

  @doc """
  Returns true if a change with the given key should be filtered out
  because it's already in a move-in snapshot.
  """
  @spec should_filter_change?(ConsumerContext.t(), Transaction.t(), String.t()) :: boolean()
  def should_filter_change?(ctx, txn, key) do
    BufferingCoordinator.should_filter_change?(ctx.coordinator, txn, key)
  end

  @doc """
  Stops buffering mode, preparing to process buffered transactions.
  """
  @spec stop_buffering(ConsumerContext.t()) :: ConsumerContext.t()
  def stop_buffering(ctx) do
    coordinator = BufferingCoordinator.stop_buffering(ctx.coordinator)
    %{ctx | coordinator: coordinator}
  end

  # Private: Remove completed move-in operations
  defp cleanup_completed_move_ins(ctx, txn) do
    coordinator = BufferingCoordinator.cleanup_completed_ops(ctx.coordinator, txn)
    %{ctx | coordinator: coordinator}
  end
end
