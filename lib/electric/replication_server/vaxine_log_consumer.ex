defmodule Electric.ReplicationServer.VaxineLogConsumer do
  use Broadway

  alias Broadway.Message
  alias Electric.ReplicationServer.VaxineLogConsumer.TransactionBuilder

  require Logger

  def start_link(opts) do
    producer = Keyword.fetch!(opts, :producer)

    Broadway.start_link(
      __MODULE__,
      name: Keyword.get(opts, :name, __MODULE__),
      producer: [
        module: {producer, opts},
        concurrency: 1
      ],
      processors: [
        default: [concurrency: 1]
      ]
    )
  end

  @impl true
  def handle_message(_, %Message{data: vx_transaction} = message, _) do
    metadata = TransactionBuilder.extract_metadata(vx_transaction)
    origin_transaction = TransactionBuilder.build_transaction_for_origin(vx_transaction, metadata)
    peers_transaction = TransactionBuilder.build_transaction_for_peers(vx_transaction, metadata)

    Registry.dispatch(
      Electric.PostgresDispatcher,
      {:publication, metadata.publication},
      fn entries ->
        Enum.each(entries, fn {pid, slot} ->
          transaction =
            if slot == metadata.origin, do: origin_transaction, else: peers_transaction

          Logger.debug("Sending transaction #{inspect(transaction)} to slot: #{inspect(slot)}")
          send(pid, {:replication_message, transaction})
        end)
      end
    )

    message
  end
end
