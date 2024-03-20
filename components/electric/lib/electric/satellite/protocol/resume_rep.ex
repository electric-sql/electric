defmodule Electric.Satellite.Protocol.ResumeRep do
  alias Electric.Postgres.LogicalReplication
  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Postgres.LogicalMessages

  defstruct [:repl_conn, :repl_context, :end_lsn]

  @type t :: %__MODULE__{
          repl_conn: :epgsql.connection(),
          repl_context: LogicalMessages.Context.t(),
          end_lsn: Lsn.t()
        }

  def process_message(binary_msg, %__MODULE__{} = rep) do
    rep =
      update_in(rep.repl_context, fn context ->
        binary_msg
        |> LogicalReplication.decode_message()
        |> LogicalMessages.process(context)
      end)

    case rep.repl_context.transaction do
      nil -> {nil, rep}
      %Transaction{} = tx -> {tx, reset_tx(rep)}
    end
  end

  defp reset_tx(%__MODULE__{} = rep) do
    update_in(rep.repl_context, &LogicalMessages.Context.reset_tx/1)
  end
end
