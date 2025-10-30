defmodule Electric.Shapes.Api.ErrorCodeTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Api.ErrorCode

  describe "to_string/1" do
    test "returns STACK_UNAVAILABLE for :stack_unavailable" do
      assert ErrorCode.to_string(:stack_unavailable) == "STACK_UNAVAILABLE"
    end
  end
end
