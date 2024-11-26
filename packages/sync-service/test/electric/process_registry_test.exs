defmodule Electric.ProcessRegistryTest do
  use ExUnit.Case, async: true
  alias Electric.ProcessRegistry

  @stack_id "foo"

  describe "alive?/2" do
    test "should return false for inexistent process" do
      {:ok, _} =
        ProcessRegistry.start_link(
          name: ProcessRegistry.registry_name(@stack_id),
          keys: :duplicate,
          stack_id: @stack_id
        )

      assert false == ProcessRegistry.alive?(@stack_id, "bar")
    end

    test "should return false for any process if registry not started" do
      assert false == ProcessRegistry.alive?(@stack_id, "bar")
    end
  end
end
