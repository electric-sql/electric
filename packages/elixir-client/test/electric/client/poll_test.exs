defmodule Electric.Client.PollTest do
  use ExUnit.Case, async: true

  alias Electric.Client.ShapeState
  alias Electric.Client.Message.ResumeMessage
  alias Electric.Client.Offset

  describe "ShapeState" do
    test "new/0 creates initial state" do
      state = ShapeState.new()

      assert state.offset == Offset.before_all()
      assert state.up_to_date? == false
      assert state.shape_handle == nil
      assert state.schema == nil
      assert state.value_mapper_fun == nil
      assert state.tag_to_keys == %{}
      assert state.key_data == %{}
    end

    test "new/1 accepts options" do
      state = ShapeState.new(shape_handle: "test-handle", offset: "123_0")

      assert state.shape_handle == "test-handle"
      assert state.offset == "123_0"
      assert state.up_to_date? == false
    end

    test "from_resume/1 creates state from ResumeMessage" do
      resume = %ResumeMessage{
        shape_handle: "resume-handle",
        offset: "456_1",
        schema: %{"id" => %{type: "int8"}},
        tag_to_keys: %{"tag1" => MapSet.new(["key1", "key2"])},
        key_data: %{"key1" => %{tags: MapSet.new(["tag1"]), msg: :some_msg}}
      }

      state = ShapeState.from_resume(resume)

      assert state.shape_handle == "resume-handle"
      assert state.offset == "456_1"
      assert state.schema == %{"id" => %{type: "int8"}}
      assert state.up_to_date? == true
      assert state.tag_to_keys == %{"tag1" => MapSet.new(["key1", "key2"])}
      assert state.key_data == %{"key1" => %{tags: MapSet.new(["tag1"]), msg: :some_msg}}
    end

    test "to_resume/1 converts state to ResumeMessage" do
      state = %ShapeState{
        shape_handle: "my-handle",
        offset: "789_2",
        schema: %{"name" => %{type: "text"}},
        tag_to_keys: %{"tagX" => MapSet.new(["keyA"])},
        key_data: %{"keyA" => %{tags: MapSet.new(["tagX"]), msg: :another_msg}}
      }

      resume = ShapeState.to_resume(state)

      assert %ResumeMessage{} = resume
      assert resume.shape_handle == "my-handle"
      assert resume.offset == "789_2"
      assert resume.schema == %{"name" => %{type: "text"}}
      assert resume.tag_to_keys == %{"tagX" => MapSet.new(["keyA"])}
      assert resume.key_data == %{"keyA" => %{tags: MapSet.new(["tagX"]), msg: :another_msg}}
    end

    test "round-trip through ResumeMessage preserves essential state" do
      original =
        ShapeState.new(
          shape_handle: "round-trip",
          offset: "100_5"
        )

      original = %{original | schema: %{"col" => %{type: "text"}}, up_to_date?: true}

      resumed = original |> ShapeState.to_resume() |> ShapeState.from_resume()

      assert resumed.shape_handle == original.shape_handle
      assert resumed.offset == original.offset
      assert resumed.schema == original.schema
      assert resumed.up_to_date? == true
    end
  end
end
