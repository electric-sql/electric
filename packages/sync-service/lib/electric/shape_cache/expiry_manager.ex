defmodule Electric.ShapeCache.ExpiryManager do
  use GenServer

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            shape_status: [type: :mod_arg, required: true],
            max_shapes: [type: {:or, [:non_neg_integer, nil]}, default: nil]
          )

  def name(stack_id) when not is_map(stack_id) and not is_list(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def name(opts) do
    stack_id = Access.fetch!(opts, :stack_id)
    name(stack_id)
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      GenServer.start_link(__MODULE__, opts, name: name(opts))
    end
  end

  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    Process.set_label({:shape_expiry_manager, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    {:ok,
     %{
       max_shapes: Keyword.fetch!(opts, :max_shapes),
       shape_status: Keyword.fetch!(opts, :shape_status)
     }}
  end
end
