defmodule Electric.Client.Fetch.MintTest do
  use ExUnit.Case, async: true

  alias Electric.Client
  alias Electric.Client.Fetch
  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client.ShapeDefinition

  import Support.DbSetup
  import Support.ClientHelpers

  defp client do
    Fetch.Mint.client(base_url: Application.fetch_env!(:electric_client, :electric_url))
  end

  defp client_stream(ctx, opts) do
    Client.stream(ctx.client, ctx.shape, opts)
  end

  defp stream(ctx, limit) when is_integer(limit) do
    client_stream(ctx, []) |> Enum.take(limit)
  end

  setup :with_unique_table

  setup(ctx) do
    {:ok, client} = client()

    shape = ShapeDefinition.new!(ctx.tablename)

    on_exit(fn ->
      Client.delete_shape(client, shape)
    end)

    [client: client, shape: shape]
  end

  test "un-pooled connection mode works as expected", ctx do
    %{tablename: table} = ctx

    {:ok, id1} = insert_item(ctx)
    {:ok, id2} = insert_item(ctx)
    {:ok, id3} = insert_item(ctx)

    assert [
             %ChangeMessage{
               headers: %{operation: :insert, relation: ["public", ^table]},
               value: %{"id" => ^id1},
               offset: %Electric.Client.Offset{tx: 0, op: 0}
             },
             %ChangeMessage{
               headers: %{operation: :insert, relation: ["public", ^table]},
               value: %{"id" => ^id2},
               offset: %Electric.Client.Offset{tx: 0, op: 0}
             },
             %ChangeMessage{
               headers: %{operation: :insert, relation: ["public", ^table]},
               value: %{"id" => ^id3},
               offset: %Electric.Client.Offset{tx: 0, op: 0}
             },
             up_to_date0()
           ] = stream(ctx, 4)
  end
end
