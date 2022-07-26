defmodule Electric.Replication.Vaxine.DownstreamPipelineTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Vaxine.TransactionBuilder

  @external_resource Path.expand("vx_client_message_example.exs", __DIR__)
  @message @external_resource |> List.first() |> Code.eval_file() |> elem(0)

  test "correctly extracts metadata" do
    metadata = TransactionBuilder.extract_metadata(@message)

    assert %Electric.Replication.Metadata{
             commit_timestamp: %DateTime{},
             id: "0",
             publication: "all_tables"
           } = metadata
  end

  test "extracts origin transaction" do
    metadata = TransactionBuilder.extract_metadata(@message)
    origin_transaction = TransactionBuilder.build_transaction_for_origin(@message, metadata)

    assert %Electric.Replication.Changes.Transaction{
             changes: [
               %Electric.Replication.Changes.UpdatedRecord{
                 record: %{
                   "content" => "iliketrains100",
                   "content_b" => nil,
                   "id" => "f7a20872-67ec-4132-a417-e503446b9dba"
                 },
                 relation: {"public", "entries"}
               }
             ],
             commit_timestamp: commit_timestamp
           } = origin_transaction
  end

  test "extracts peer transaction" do
    metadata = TransactionBuilder.extract_metadata(@message)
    origin_transaction = TransactionBuilder.build_transaction_for_origin(@message, metadata)
    peers_transaction = TransactionBuilder.build_transaction_for_peers(@message, metadata)

    assert %Electric.Replication.Changes.Transaction{
             changes: [
               %Electric.Replication.Changes.NewRecord{
                 record: %{
                   "content" => "iliketrains100",
                   "content_b" => nil,
                   "id" => "f7a20872-67ec-4132-a417-e503446b9dba"
                 },
                 relation: {"public", "entries"}
               }
             ],
             commit_timestamp: ^commit_timestamp
           } = peers_transaction
  end
end
