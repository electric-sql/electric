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
           client
           |> Client.stream(ctx.shape)
           |> Enum.each(fn evt -> send(parent, {:event, evt}) end)
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
        last_offset: Offset.new(0, 1),
        shape_handle: "my-shape",
        next_cursor: 1,
        body: [
          Client.Mock.change(value: %{id: "4444"}),
          Client.Mock.up_to_date(lsn: 1234)
        ]
      )

    event_stream =
      Stream.repeatedly(fn ->
        receive do
          {:event, event} -> event
        after
          1_000 -> raise "client stream has crashed"
        end
      end)

    events = Enum.take(event_stream, 5)

    assert [
             %ChangeMessage{value: %{"id" => 1111}},
             %ChangeMessage{value: %{"id" => 2222}},
             %ChangeMessage{value: %{"id" => 3333}},
             %ChangeMessage{value: %{"id" => 4444}},
             up_to_date(1234)
           ] = events

    {:ok, _request} =
      Client.Mock.response(client,
        status: 200,
        schema: %{id: %{type: "int8"}},
        last_offset: Offset.new(0, 1),
        shape_handle: "my-shape",
        body: [
          Client.Mock.change(value: %{id: "5555"}),
          Client.Mock.up_to_date(lsn: 1235)
        ]
      )

    assert [_, up_to_date(1235)] = Enum.take(event_stream, 2)
  end
end
