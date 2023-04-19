defmodule Electric.Replication.Vaxine.TransactionBuilderTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Vaxine.TransactionBuilder

  @external_resource Path.expand("vx_client_message_example.exs", __DIR__)
  @message @external_resource |> List.first() |> Code.eval_file() |> elem(0)

  test "correctly extracts metadata" do
    metadata = TransactionBuilder.extract_metadata(@message)

    assert {:ok,
            %Electric.Replication.Metadata{
              commit_timestamp: %DateTime{},
              id: "0",
              publication: "all_tables"
            }} = metadata
  end

  test "extracts transaction" do
    {:ok, metadata} = TransactionBuilder.extract_metadata(@message)
    transaction = TransactionBuilder.build_transaction(@message, metadata)

    assert {:ok,
            %Electric.Replication.Changes.Transaction{
              changes: [
                %Electric.Replication.Changes.UpdatedRecord{
                  record: %{
                    "content" => "entries kjdlksjklkdlsajdklasjdlt",
                    "content_b" => "extra content",
                    "id" => "911fee88-2a0f-4fff-9d71-0c3eb7c9a380"
                  },
                  relation: {"public", "entries"}
                }
              ],
              commit_timestamp: %DateTime{}
            }} = transaction
  end
end
