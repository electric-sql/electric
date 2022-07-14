defmodule Electric.Replication do
  use Broadway

  alias Broadway.Message
  alias Electric.Replication
  alias Electric.VaxRepo

  alias Electric.Replication.Metadata

  alias Replication.Changes.Transaction

  require Logger

  def start_link(opts) do
    producer = Keyword.fetch!(opts, :producer)

    Broadway.start_link(
      Replication,
      name: Keyword.get(opts, :name, Replication),
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
        %Message{data: %Transaction{changes: changes, commit_timestamp: ts}} = message,
        _
      ) do
    Logger.debug(inspect({:message, message}, pretty: true))

    changes
    |> process_changes(ts, message.metadata.publication)
    |> case do
      :ok ->
        message

      {change, error} ->
        Message.failed(message, {change, error})
    end
  end

  defp process_changes(changes, commit_timestamp, publication) do
    VaxRepo.transaction(fn ->
      Metadata.new(commit_timestamp, publication)
      |> VaxRepo.insert()

      changes
      |> Enum.reduce_while(:ok, fn change, :ok ->
        case Electric.Replication.ToVaxine.handle_change(change) do
          :ok -> {:cont, :ok}
          error -> {:halt, {change, error}}
        end
      end)
    end)
  end
end
