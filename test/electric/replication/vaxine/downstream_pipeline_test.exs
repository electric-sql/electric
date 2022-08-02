defmodule Electric.Replication.Vaxine.DownstreamPipelineTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Vaxine.DownstreamPipeline

  @external_resource Path.expand("vx_client_message_example.exs", __DIR__)
  @message @external_resource |> List.first() |> Code.eval_file() |> elem(0)

  test "messages go through the pipeline correctly" do
    ref = Broadway.test_message(DownstreamPipeline, @message, metadata: %{})
    assert_receive {:ack, ^ref, [_], _}
  end

  test "messages are turned into transactions" do
    Registry.register(Electric.PostgresDispatcher, {:publication, "all_tables"}, "postgres_1")
    Registry.register(Electric.PostgresDispatcher, {:publication, "all_tables"}, "other")

    ref = Broadway.test_message(DownstreamPipeline, @message, metadata: %{})
    assert_receive {:ack, ^ref, [_], _}

    assert_receive {:replication_message,
                    %Electric.Replication.Changes.Transaction{
                      changes: [
                        %Electric.Replication.Changes.UpdatedRecord{
                          record: %{
                            "content" => "iliketrains1",
                            "content_b" => nil,
                            "id" => "cb2fb0f0-dd12-4e87-a3cd-4eaff087995c"
                          },
                          relation: {"public", "entries"}
                        }
                      ],
                      commit_timestamp: commit_timestamp
                    }}

    assert_receive {:replication_message,
                    %Electric.Replication.Changes.Transaction{
                      changes: [
                        %Electric.Replication.Changes.UpdatedRecord{
                          record: %{
                            "content" => "iliketrains1",
                            "content_b" => nil,
                            "id" => "cb2fb0f0-dd12-4e87-a3cd-4eaff087995c"
                          },
                          relation: {"public", "entries"}
                        }
                      ],
                      commit_timestamp: ^commit_timestamp
                    }}

    assert %DateTime{} = commit_timestamp
  end
end
