defmodule Electric.Shapes.Consumer.EventHandlerBuilder do
  # Builds the initial event handler and ordered setup effects for a consumer shape.

  alias Electric.Shapes.Consumer.EventHandler
  alias Electric.Shapes.Consumer.Materializer
  alias Electric.Shapes.Consumer.SetupEffects
  alias Electric.Shapes.Consumer.State
  alias Electric.Shapes.DnfPlan
  alias Electric.Shapes.Shape

  @spec build(State.t(), :create | :restore) ::
          {:ok, EventHandler.t(), [SetupEffects.t()]}
  def build(%State{shape: %Shape{shape_dependencies_handles: dep_handles}} = state, action)
      when dep_handles != [] do
    {:ok, dnf_plan} = DnfPlan.compile(state.shape)
    dependency_move_policy = dependency_move_policy(state.stack_id, state.shape)

    {views, dep_handle_to_ref, dep_index_to_ref} =
      dep_handles
      |> Enum.with_index()
      |> Enum.reduce({%{}, %{}, %{}}, fn {handle, index},
                                         {views, handle_mapping, index_mapping} ->
        materializer_opts = %{stack_id: state.stack_id, shape_handle: handle}
        :ok = Materializer.wait_until_ready(materializer_opts)

        # Seed the dependency view from the value captured at subscribe time
        # (as-of this consumer's persisted moves-position), so that any moves
        # the materializer replays are not eliminated as redundant against a
        # view that already reflects them. Falls back to the materializer's
        # current link values if no seed was captured (non-restart paths).
        view =
          case Map.fetch(state.dep_seed_views, handle) do
            {:ok, seed_view} -> seed_view
            :error -> Materializer.get_link_values(materializer_opts)
          end

        ref = ["$sublink", Integer.to_string(index)]

        {Map.put(views, ref, view), Map.put(handle_mapping, handle, {index, ref}),
         Map.put(index_mapping, index, ref)}
      end)

    buffer_max_transactions =
      Electric.StackConfig.lookup(
        state.stack_id,
        :subquery_buffer_max_transactions,
        Electric.Config.default(:subquery_buffer_max_transactions)
      )

    handler = %EventHandler.Subqueries.Steady{
      shape_info: %Electric.Shapes.Consumer.Subqueries.ShapeInfo{
        shape: state.shape,
        stack_id: state.stack_id,
        shape_handle: state.shape_handle,
        dnf_plan: dnf_plan,
        ref_resolver:
          Electric.Shapes.Consumer.Subqueries.RefResolver.new(dep_handle_to_ref, dep_index_to_ref),
        buffer_max_transactions: buffer_max_transactions,
        dependency_move_policy: dependency_move_policy
      },
      views: views
    }

    {:ok, handler,
     [%SetupEffects.SubscribeShape{action: action}, %SetupEffects.SeedSubqueryIndex{}]}
  end

  def build(%State{} = state, action) do
    handler = %EventHandler.Default{
      shape: state.shape,
      stack_id: state.stack_id,
      shape_handle: state.shape_handle
    }

    {:ok, handler, [%SetupEffects.SubscribeShape{action: action}]}
  end

  defp dependency_move_policy(stack_id, _shape) do
    feature_flags = Electric.StackConfig.lookup(stack_id, :feature_flags, [])

    if "tagged_subqueries" not in feature_flags do
      :invalidate_on_dependency_move
    else
      :stream_dependency_moves
    end
  end
end
