defmodule Electric.Client.MockTest do
  use ExUnit.Case, async: true

  import Support.ClientHelpers

  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client
  alias Electric.Client.Offset
  alias Electric.Client.ShapeDefinition

  setup do
    [shape: ShapeDefinition.new!("my_table")]
  end

  test "allows for us to push arbitrary messages into the pipeline", ctx do
    parent = self()
    {:ok, client} = Client.Mock.new()

    {:ok, _} =
      start_supervised(
        {Task,
         fn ->
           events = Client.stream(client, ctx.shape) |> Enum.take(5)
           send(parent, {:events, events})
         end}
      )

    {:ok, _request} =
      Client.Mock.response(client,
        status: 200,
        schema: %{id: %{type: "int8"}},
        last_offset: Offset.new(0, 0),
        shape_handle: "my-shape",
        body: [
          Client.Mock.change(value: %{id: "1111"}),
          Client.Mock.change(value: %{id: "2222"}),
          Client.Mock.change(value: %{id: "3333"})
        ]
      )

    {:ok, _request} =
      Client.Mock.response(client,
        status: 200,
        schema: %{id: %{type: "int8"}},
        last_offset: Offset.new(0, 0),
        shape_handle: "my-shape",
        body: [
          Client.Mock.change(value: %{id: "4444"}),
          Client.Mock.up_to_date()
        ]
      )

    events =
      receive do
        {:events, events} -> events
      end

    assert [
             %ChangeMessage{value: %{"id" => 1111}},
             %ChangeMessage{value: %{"id" => 2222}},
             %ChangeMessage{value: %{"id" => 3333}},
             %ChangeMessage{value: %{"id" => 4444}},
             up_to_date0()
           ] = events
  end
end
