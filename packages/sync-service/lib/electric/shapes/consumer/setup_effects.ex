defmodule Electric.Shapes.Consumer.SetupEffects do
  # Executes ordered boot-time setup effects for consumer handler initialization.

  alias Electric.Replication.ShapeLogCollector
  alias Electric.Shapes.Consumer.State

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

  # TODO phase 2 (subquery-index RFC): replace per-shape `seed_membership` with
  # `SubqueryIndex.set_shape_subquery/5` per subquery_ref after the consumer
  # has registered with `SubqueryProgressMonitor` at the materializer's
  # current logical time. The shared child routing is seeded once, at child
  # creation, from `MultiTimeView.values/3` — not here. `mark_ready/2` still
  # clears fallback for the shape, but only after every `set_shape_subquery`
  # has been written so routing has a real logical time to read.
  defp execute_effect(%SeedSubqueryIndex{}, %State{} = state), do: {:ok, state}
end
