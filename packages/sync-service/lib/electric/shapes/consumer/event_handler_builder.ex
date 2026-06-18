defmodule Electric.Shapes.Consumer.EventHandlerBuilder do
  # Builds the initial event handler and ordered setup effects for a consumer shape.

  alias Electric.ShapeCache.ShapeStatus
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

    {views, dep_id_to_ref, dep_index_to_ref} =
      dep_handles
      |> Enum.with_index()
      |> Enum.reduce({%{}, %{}, %{}}, fn {handle, index}, {views, id_mapping, index_mapping} ->
        dep_id = dep_id_for_handle!(state.stack_id, handle)
        materializer_opts = %{stack_id: state.stack_id, shape_id: dep_id}
        :ok = Materializer.wait_until_ready(materializer_opts)
        view = Materializer.get_link_values(materializer_opts)
        ref = ["$sublink", Integer.to_string(index)]

        {Map.put(views, ref, view), Map.put(id_mapping, dep_id, {index, ref}),
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
          Electric.Shapes.Consumer.Subqueries.RefResolver.new(dep_id_to_ref, dep_index_to_ref),
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

  # Inner (dependency) shapes always have their ids minted in ShapeStatus before
  # the outer shape's consumer starts (on create the inner shapes are created
  # first; on restore populate_shape_meta_table mints ids for all handles at
  # boot). A missing id here is therefore the same kind of deletion race the
  # surrounding setup code already treats as a hard failure, so we raise rather
  # than thread a nil id into the resolver.
  defp dep_id_for_handle!(stack_id, handle) do
    case ShapeStatus.id_for_handle(stack_id, handle) do
      {:ok, id} ->
        id

      :error ->
        raise "missing shape_id for dependency handle #{inspect(handle)}"
    end
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
