defmodule Electric.Replication.Vaxine.DownstreamPipeline do
  use Broadway

  alias Broadway.Message
  alias Electric.Replication.Vaxine.TransactionBuilder

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
  def handle_message(_, %Message{data: vaxine_tx} = message, _) do
    with {:ok, metadata} <- TransactionBuilder.extract_metadata(vaxine_tx),
         {:ok, origin_tx} <- TransactionBuilder.build_transaction_for_origin(vaxine_tx, metadata),
         {:ok, peers_tx} <- TransactionBuilder.build_transaction_for_peers(vaxine_tx, metadata) do
      Registry.dispatch(
        Electric.PostgresDispatcher,
        {:publication, metadata.publication},
        fn entries ->
          Enum.each(entries, fn {pid, slot} ->
            transaction = if slot == metadata.origin, do: origin_tx, else: peers_tx

            Logger.debug("Sending transaction #{inspect(transaction)} to slot: #{inspect(slot)}")

            send(pid, {:replication_message, transaction})
          end)
        end
      )

      message
    else
      {:error, _} = error ->
        "Failed to process Vaxine message with error #{inspect(error)}, no-op done"
        |> Logger.error(message: message)

        message
    end
  end
end
