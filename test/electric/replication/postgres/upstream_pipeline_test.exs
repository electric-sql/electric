defmodule Electric.Replication.Postgres.UpstreamPipelineTest do
  use ExUnit.Case, async: false

  alias Electric.Replication.Postgres.UpstreamPipeline
  alias Electric.Replication.Changes

  @id Ecto.UUID.generate()

  @new_record_change %Changes.NewRecord{
    record: %{"content" => "a", "id" => @id},
    relation: {"fake", "upstream_pipeline_test"}
  }

  @updated_record_change %Changes.UpdatedRecord{
    old_record: %{"content" => "a", "id" => @id},
    record: %{"content" => "b", "id" => @id},
    relation: {"fake", "upstream_pipeline_test"}
  }

  @deleted_record_change %Changes.DeletedRecord{
    old_record: %{"content" => "a", "id" => @id},
    relation: {"fake", "upstream_pipeline_test"}
  }

  setup _ do
    Electric.Test.SchemaRegistryHelper.initialize_registry(
      "dummy_publication",
      {"fake", "upstream_pipeline_test"},
      id: :uuid,
      content: :text
    )

    start_supervised!({UpstreamPipeline, %{producer: Broadway.DummyProducer}})

    :ok
  end

  describe "Postgres upstream pipeline correctly consumes and acks" do
    test "transactions that create new records" do
      ref = changes_test_message([@new_record_change])
      assert_receive {:ack, ^ref, _, _}
    end

    test "transactions with updates" do
      ref = changes_test_message([@updated_record_change])
      assert_receive {:ack, ^ref, _, _}
    end

    test "transactions with deletes" do
      ref = changes_test_message([@deleted_record_change])
      assert_receive {:ack, ^ref, _, _}
    end
  end

  defp changes_test_message(changes) do
    Broadway.test_message(UpstreamPipeline, %Changes.Transaction{changes: changes},
      metadata: %{publication: "dummy_publication", origin: "dummy_postgres"}
    )
  end
end
