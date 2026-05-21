defmodule Electric.Shapes.Consumer.SetupEffects do
  # Executes ordered boot-time setup effects for consumer handler initialization.

  alias Electric.Replication.ShapeLogCollector
  alias Electric.Shapes.Consumer.State
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex

  require Logger

  defmodule SubscribeShape do
    @moduledoc false
    defstruct [:action]
  end

  defmodule SeedSubqueryIndex do
    @moduledoc false
    defstruct []
  end

  @type t() :: %SubscribeShape{} | %SeedSubqueryIndex{}

  @spec execute([t()], State.t()) :: {:ok, State.t()} | {:error, State.t()}
  def execute(effects, %State{} = state) when is_list(effects) do
    Enum.reduce_while(effects, {:ok, state}, fn effect, {:ok, state} ->
      case execute_effect(effect, state) do
        {:ok, %State{} = state} -> {:cont, {:ok, state}}
        {:error, %State{} = state} -> {:halt, {:error, state}}
      end
    end)
  end

  defp execute_effect(%SubscribeShape{action: action}, %State{} = state) do
    case ShapeLogCollector.add_shape(state.stack_id, state.shape_handle, state.shape, action) do
      :ok ->
        {:ok, state}

      {:error, error} ->
        Logger.warning(
          "Shape #{state.shape_handle} cannot subscribe due to #{inspect(error)} - invalidating shape"
        )

        {:error, state}
    end
  end

  defp execute_effect(%SeedSubqueryIndex{}, %State{} = state) do
    case SubqueryIndex.for_stack(state.stack_id) do
      nil ->
        {:ok, state}

      index ->
        :ok = SubqueryIndex.mark_ready(index, state.shape_handle)
        {:ok, state}
    end
  end
end
