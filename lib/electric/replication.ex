defmodule Electric.Replication do
  use Broadway

  alias Broadway.Message
  alias Electric.Replication
  alias Electric.VaxRepo

  alias Electric.Replication.Metadata

  alias Replication.Changes.Transaction

  require Logger

  def start_link(opts) do
    producer = Map.fetch!(opts, :producer)

    Broadway.start_link(
      Replication,
      name: Map.get(opts, :name, Replication),
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
  def handle_message(
        _,
        %Message{data: %Transaction{changes: changes, commit_timestamp: ts}} = message,
        _
      ) do
    %{metadata: %{origin: origin, publication: publication}} = message

    Logger.debug(
      "New transaction in publication `#{publication}`: #{inspect(message.data, pretty: true)}",
      origin: origin
    )

    changes
    |> process_changes(ts, publication, origin)
    |> case do
      :ok ->
        message

      {change, error} ->
        Message.failed(message, {change, error})
    end
  end

  defp process_changes(changes, commit_timestamp, publication, origin) do
    VaxRepo.transaction(fn ->
      Metadata.new(commit_timestamp, publication, origin)
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
