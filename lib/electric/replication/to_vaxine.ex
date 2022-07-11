defprotocol Electric.Replication.ToVaxine do
  @spec handle_change(change :: term()) :: :ok | {:error, reason :: term()}
  def handle_change(change)
end
