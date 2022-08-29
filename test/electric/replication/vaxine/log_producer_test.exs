defmodule Electric.Replication.Vaxine.LogProducerTest do
  use ExUnit.Case

  alias Electric.Replication.Vaxine.LogProducer

  defmodule TestConsumer do
    use GenStage

    def start_link(test_pid) do
      GenStage.start_link(__MODULE__, test_pid)
    end

    @impl true
    def init(test_pid) do
      {:consumer, test_pid}
    end

    @impl true
    def handle_events(events, {sender, _ref}, test_pid) do
      send(test_pid, {:events, sender, events})

      {:noreply, [], test_pid}
    end
  end

  test "connected?/1 returns true if connected to Vaxine and false otherwise" do
    producer = start_log_producer_with_forwarder!()
    refute LogProducer.connected?(producer)
    :ok = LogProducer.start_replication(producer, nil)
    assert LogProducer.connected?(producer)
  end

  test "Doesn't start replication until requested" do
    start_log_producer_with_forwarder!()
    refute_receive {:events, _, _}, 200
  end

  test "Allows starting replication synchronously without an offset" do
    producer = start_log_producer_with_forwarder!()
    assert :ok = LogProducer.start_replication(producer, nil)

    initialize_registry("replication_start")
    insert_data("replication_start")

    # big timeout because this can take a while on CI
    assert_receive {:events, _, [_]}, 5000
  end

  test "Allows starting replication from a specific offset" do
    initialize_registry("replication_restart")

    producer_1 = start_log_producer_with_forwarder!(1)
    offset = clean_offset(producer_1)

    stop_supervised!(:log_consumer_1)
    stop_supervised!(:log_producer_1)

    producer_2 = start_log_producer_with_forwarder!(2)
    assert :ok = LogProducer.start_replication(producer_2, offset)

    refute_receive {:events, _, _}, 200

    insert_data("replication_restart")

    assert_receive {:events, ^producer_2, [{received_transaction, _new_offset}]}, 5000

    assert %Electric.Replication.Changes.Transaction{
             changes: [
               %Electric.Replication.Changes.UpdatedRecord{
                 record: %{
                   "message" => "content",
                   "id" => "911fee88-2a0f-4fff-9d71-0c3eb7c9a380"
                 },
                 relation: {"public", "replication_restart_test"}
               }
             ]
           } = received_transaction
  end

  defp start_log_producer_with_forwarder!(number \\ 1) do
    producer_args = ["log_producer_#{number}", [vaxine_hostname: "localhost", vaxine_port: 8088]]

    producer_pid =
      start_supervised!(
        Supervisor.child_spec(
          %{id: :"log_producer_#{number}", start: {LogProducer, :start_link, producer_args}},
          []
        )
      )

    consumer_pid =
      start_supervised!(
        Supervisor.child_spec(
          %{id: :"log_consumer_#{number}", start: {TestConsumer, :start_link, [self()]}},
          []
        )
      )

    {:ok, _} = GenStage.sync_subscribe(consumer_pid, to: producer_pid)
    producer_pid
  end

  # Gives a starting offset that is clean
  defp clean_offset(producer) do
    LogProducer.start_replication(producer, nil)

    rec_receive_until_timeout(nil)
  end

  defp rec_receive_until_timeout(last_offset) do
    receive do
      {:events, _, [{_transaction, offset}]} -> rec_receive_until_timeout(offset)
    after
      1000 -> last_offset
    end
  end

  defp initialize_registry(test_identifier) do
    Electric.Test.SchemaRegistryHelper.initialize_registry(
      "#{test_identifier}_test_pub",
      {"public", "#{test_identifier}_test"},
      [id: :uuid, message: :text],
      ["id"],
      100_002
    )

    on_exit(fn ->
      "#{test_identifier}_test_pub"
      |> Electric.Postgres.SchemaRegistry.clear_replicated_tables()
    end)
  end

  defp default_transaction(test_identifier) do
    %Electric.Replication.Changes.Transaction{
      changes: [
        %Electric.Replication.Changes.NewRecord{
          record: %{
            "message" => "content",
            "id" => "911fee88-2a0f-4fff-9d71-0c3eb7c9a380"
          },
          relation: {"public", "#{test_identifier}_test"}
        }
      ],
      commit_timestamp: DateTime.utc_now()
    }
  end

  defp insert_data(test_identifier, transaction \\ nil) do
    transaction = transaction || default_transaction(test_identifier)

    Electric.Replication.Vaxine.transaction_to_vaxine(
      transaction,
      "#{test_identifier}_pub",
      "some_origin"
    )
  end
end
