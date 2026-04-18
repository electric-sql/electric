defmodule Electric.Shapes.Consumer.EventHandler.Default do
  @moduledoc false

  @behaviour Electric.Shapes.Consumer.EventHandler

  alias Electric.Replication.Changes.Transaction
  alias Electric.Shapes.Consumer.EffectList
  alias Electric.Shapes.Consumer.Effects
  alias Electric.Shapes.Consumer.TransactionConverter
  alias Electric.Shapes.Shape

  @enforce_keys [:shape, :stack_id, :shape_handle]
  defstruct [:shape, :stack_id, :shape_handle]

  @type t() :: %__MODULE__{
          shape: Shape.t(),
          stack_id: String.t(),
          shape_handle: String.t()
        }

  @impl true
  def handle_event(state, %Transaction{} = txn) do
    with {:ok, effects} <-
           TransactionConverter.transaction_to_effects(
             txn,
             state.shape,
             stack_id: state.stack_id,
             shape_handle: state.shape_handle
           ) do
      effects =
        effects
        |> EffectList.new()
        |> EffectList.append(%Effects.NotifyFlushed{log_offset: txn.last_log_offset})
        |> EffectList.to_list()

      {:ok, state, effects}
    end
  end

  def handle_event(state, {:global_last_seen_lsn, _lsn}) do
    {:ok, state, []}
  end
end
