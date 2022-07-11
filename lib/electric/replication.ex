defmodule Electric.Replication do
  use Broadway

  alias Broadway.Message
  alias Electric.Replication
  alias Electric.VaxRepo

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
  def handle_message(_, %Message{data: %Transaction{changes: changes}} = message, _) do
    Logger.debug(inspect({:message, message}, pretty: true))

    changes
    |> process_changes()
    |> case do
      :ok ->
        Registry.dispatch(
          Electric.PostgresDispatcher,
          {:publication, message.metadata.publication},
          fn entries ->
            Enum.each(entries, fn {pid, _slot} ->
              send(pid, {:replication_message, message.data})
            end)
          end
        )

        message

      {change, error} ->
        Message.failed(message, {change, error})
    end
  end

  defp process_changes(changes) do
    VaxRepo.transaction(fn ->
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
