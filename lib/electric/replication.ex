defmodule Electric.Replication do
  use Broadway

  alias Broadway.Message
  alias Electric.Replication

  alias Replication.Changes.Transaction

  require Logger

  def start_link(opts) do
    producer = Keyword.fetch!(opts, :producer)

    Broadway.start_link(
      Replication,
      name: Keyword.get(opts, :name, Replication),
      producer: [
        module: {producer, opts},
        transformer: {Replication, :transform, []},
        concurrency: 1
      ],
      processors: [
        default: [concurrency: 1]
      ]
    )
  end

  def transform({txn, end_lsn, conn}, _opts) do
    %Message{
      data: txn,
      acknowledger: {__MODULE__, :ack_id, {conn, end_lsn}}
    }
  end

  @impl true
  def handle_message(_, %Message{data: %Transaction{changes: changes}} = message, _) do
    Logger.debug(inspect({:message, message}, pretty: true))

    changes
    |> Enum.reduce_while(:ok, fn change, :ok ->
      case Electric.Replication.ToVaxine.handle_change(change) do
        :ok -> {:cont, :ok}
        error -> {:halt, {change, error}}
      end
    end)
    |> case do
      :ok -> message
      {change, error} -> Message.failed(message, {change, error})
    end
  end

  def ack(:ack_id, [], []), do: nil
  def ack(:ack_id, _, [_head | _tail]), do: throw("XXX ack failure handling not yet implemented")

  def ack(:ack_id, successful, []) do
    last_message =
      successful
      |> Enum.reverse()
      |> Enum.at(0)

    %{acknowledger: {_, _, {conn, end_lsn}}} = last_message
    Logger.debug(inspect({:ack, end_lsn}))

    Replication.PostgresClient.acknowledge_lsn(conn, end_lsn)
  end
end
