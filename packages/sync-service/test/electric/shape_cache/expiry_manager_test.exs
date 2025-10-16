defmodule Electric.ExpiryManagerTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit

  alias Electric.ShapeCache.ExpiryManager
  alias Electric.ShapeCache.ShapeCleaner
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes.Shape
  alias Support.RepatchExt

  import Support.ComponentSetup
  import Support.TestUtils

  setup [
    :with_stack_id_from_test,
    :with_status_monitor
  ]

  @max_shapes 10

  setup %{stack_id: stack_id} do
    ShapeStatus.initialise(stack_id)

    expiry_manager =
      start_supervised!(
        {ExpiryManager,
         max_shapes: @max_shapes, expiry_batch_size: 1, period: 1, stack_id: stack_id}
      )

    Repatch.patch(ShapeCleaner, :remove_shape, [mode: :shared], fn shape_handle,
                                                                   stack_id: stack_id ->
      ShapeStatus.remove_shape(stack_id, shape_handle)
    end)

    Repatch.allow(self(), expiry_manager)
    %{expiry_manager: expiry_manager}
  end

  describe "when stack is active" do
    setup :set_status_to_active

    test "expires shapes if shape count has gone over max_shapes", ctx do
      for i <- 1..(@max_shapes + 1) do
        ShapeStatus.add_shape(ctx.stack_id, create_shape(i))
      end

      assert RepatchExt.called_within_ms?(ShapeCleaner, :remove_shape, 2, 50, ctx.expiry_manager)
    end

    test "does not expires shapes if shape count has not gone over max_shapes", ctx do
      for i <- 1..@max_shapes do
        ShapeStatus.add_shape(ctx.stack_id, create_shape(i))
      end

      refute RepatchExt.called_within_ms?(ShapeCleaner, :remove_shape, 2, 50, ctx.expiry_manager)
    end
  end

  describe "when stack is not active" do
    test "does not expires shapes even if shape count has gone over max_shapes", ctx do
      for i <- 1..(@max_shapes + 1) do
        ShapeStatus.add_shape(ctx.stack_id, create_shape(i))
      end

      refute RepatchExt.called_within_ms?(ShapeCleaner, :remove_shape, 2, 50, ctx.expiry_manager)
    end
  end

  @inspector Support.StubInspector.new(
               tables: ["t1"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0}
               ]
             )

  defp create_shape(id) do
    Shape.new!("t1", where: "id = #{id}", inspector: @inspector)
  end
end
