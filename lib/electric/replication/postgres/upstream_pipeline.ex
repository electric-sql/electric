defmodule Electric.Replication.Postgres.UpstreamPipeline do
  use Broadway

  alias Broadway.Message

  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Vaxine

  require Logger
  require Electric.Retry

  def start_link(opts) do
    producer = Map.fetch!(opts, :producer)

    Broadway.start_link(
      __MODULE__,
      name: Map.get(opts, :name, __MODULE__),
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
  def handle_message(
        _,
        %Message{data: %Transaction{changes: []}} = message,
        _
      ) do
    %{metadata: %{origin: origin, publication: publication}} = message

    Logger.debug(
      "Empty transaction in publication `#{publication}`",
      origin: origin
    )

    message
  end

  @impl true
  def handle_message(_, %Message{data: transaction} = message, _) do
    %{metadata: %{origin: origin, publication: publication}} = message

    Logger.debug(
      "New transaction in publication `#{publication}`: #{inspect(message.data, pretty: true)}",
      origin: origin
    )

    Electric.Retry.retry_while total_timeout: 10000, max_single_backoff: 1000 do
      transaction
      |> Vaxine.transaction_to_vaxine(publication, origin)
      |> case do
        :ok ->
          {:halt, message}

        {change, error} ->
          {:cont, Message.failed(message, {change, error})}
      end
    end
  end
end
