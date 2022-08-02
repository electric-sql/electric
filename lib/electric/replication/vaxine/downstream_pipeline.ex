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
         {:ok, tx} <- TransactionBuilder.build_transaction(vaxine_tx, metadata) do
      Registry.dispatch(
        Electric.PostgresDispatcher,
        {:publication, metadata.publication},
        fn entries ->
          Enum.each(entries, fn {pid, slot} ->
            Logger.debug("Sending transaction #{inspect(tx)} to slot: #{inspect(slot)}")
            send(pid, {:replication_message, tx})
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
