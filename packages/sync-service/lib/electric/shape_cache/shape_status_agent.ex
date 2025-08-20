defmodule Electric.ShapeCache.ShapeStatusAgent do
  @moduledoc """
  Owns the ETS table and the ShapeStatus state.

  This Agent creates the ETS table for shapes and initializes
  `Electric.ShapeCache.ShapeStatus` early in the supervision tree so that
  dependent processes (e.g., shape consumers) can use a single, shared
  ShapeStatus instance regardless of their own supervisor start order.
  """

  use Agent

  alias Electric.ShapeCache.ShapeStatus

  @type t :: %{
          shape_status_opts: ShapeStatus.t()
        }

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            shape_status: [type: :mod_arg, required: true]
          )

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      stack_id = Keyword.fetch!(opts, :stack_id)
      Agent.start_link(fn -> init_state(opts) end, name: name(stack_id))
    end
  end

  defp init_state(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    {shape_status, shape_status_opts} = Keyword.fetch!(opts, :shape_status)

    stack_id
    |> shape_status.shape_meta_table()
    |> :ets.new([:named_table, :public, :ordered_set])

    :ok = shape_status.initialise(shape_status_opts)

    %{shape_status_opts: shape_status_opts}
  end

  def shape_status_opts(stack_id) do
    Agent.get(name(stack_id), fn state -> state.shape_status_opts end)
  end
end
