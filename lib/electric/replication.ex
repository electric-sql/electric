defmodule Electric.Replication do
  use Broadway

  alias Broadway.Message
  alias __MODULE__

  alias Replication.Config
  alias Replication.Changes.Transaction

  def start_link(_opts) do
    Broadway.start_link(
      Replication,
      name: Replication,
      producer: [
        module: {Config.producer(), []},
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
    IO.inspect({:message, message})

    errors =
      changes
      |> Enum.reduce([], &handle_change/2)

    message =
      case errors do
        [] ->
          message

        reason ->
          Message.failed(message, reason)
      end

    message
  end

  def handle_change(_, acc), do: acc

  def ack(:ack_id, [], []), do: nil
  def ack(:ack_id, _, [_head | _tail]), do: throw("XXX ack failure handling not yet implemented")

  def ack(:ack_id, successful, []) do
    last_message =
      successful
      |> Enum.reverse()
      |> Enum.at(0)

    %{acknowledger: {_, _, {conn, end_lsn}}} = last_message
    IO.inspect({:ack, end_lsn})

    Replication.Client.acknowledge_lsn(conn, end_lsn)
  end
end
