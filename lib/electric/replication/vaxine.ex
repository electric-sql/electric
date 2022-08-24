defmodule Electric.Replication.Vaxine do
  alias Electric.VaxRepo
  alias Electric.Replication.Metadata

  defprotocol ToVaxine do
    @spec handle_change(change :: term()) :: :ok | {:error, reason :: term()}
    def handle_change(change)
  end

  def transaction_to_vaxine(
        %Electric.Replication.Changes.Transaction{} = transaction,
        publication,
        origin
      ) do
    VaxRepo.transaction(fn ->
      Metadata.new(transaction.commit_timestamp, publication, origin)
      |> VaxRepo.insert()

      transaction.changes
      |> Enum.reduce_while(:ok, fn change, :ok ->
        case ToVaxine.handle_change(change) do
          :ok -> {:cont, :ok}
          error -> {:halt, {change, error}}
        end
      end)
    end)
  end
end
