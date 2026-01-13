defmodule Electric.ExpiryManagerTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit

  alias Electric.ShapeCache.ExpiryManager
  alias Electric.ShapeCache.ShapeCleaner
  alias Electric.ShapeCache.ShapeStatus
  alias Support.Fixtures
  alias Support.RepatchExt

  import Support.ComponentSetup
  import Support.TestUtils

  @moduletag :tmp_dir

  setup [
    :with_stack_id_from_test,
    :with_status_monitor,
    :with_in_memory_storage,
    :with_shape_status
  ]

  @max_shapes 10

  setup %{stack_id: stack_id} do
    expiry_manager =
      start_supervised!({ExpiryManager, max_shapes: @max_shapes, period: 1, stack_id: stack_id})

    Repatch.patch(ShapeCleaner, :remove_shapes, [mode: :shared], fn stack_id, shape_handles ->
      Enum.each(shape_handles, &ShapeStatus.remove_shape(stack_id, &1))
    end)

    Repatch.allow(self(), expiry_manager)
    %{expiry_manager: expiry_manager}
  end

  describe "when stack is active" do
    setup :set_status_to_active

    test "expires shapes if shape count has gone over max_shapes", ctx do
      for i <- 1..(@max_shapes + 1) do
        ShapeStatus.add_shape(ctx.stack_id, Fixtures.Shape.new(i))
      end

      assert RepatchExt.called_within_ms?(
               ShapeCleaner,
               :remove_shapes,
               2,
               100,
               ctx.expiry_manager
             )
    end

    test "does not expires shapes if shape count has not gone over max_shapes", ctx do
      for i <- 1..@max_shapes do
        ShapeStatus.add_shape(ctx.stack_id, Fixtures.Shape.new(i))
      end

      refute RepatchExt.called_within_ms?(
               ShapeCleaner,
               :remove_shapes,
               2,
               100,
               ctx.expiry_manager
             )
    end
  end

  describe "when stack is not active" do
    test "does not expires shapes even if shape count has gone over max_shapes", ctx do
      for i <- 1..(@max_shapes + 1) do
        ShapeStatus.add_shape(ctx.stack_id, Fixtures.Shape.new(i))
      end

      refute RepatchExt.called_within_ms?(
               ShapeCleaner,
               :remove_shapes,
               2,
               100,
               ctx.expiry_manager
             )
    end
  end
end
