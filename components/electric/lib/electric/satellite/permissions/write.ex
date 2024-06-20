defmodule Electric.Satellite.Permissions.Write do
  alias Electric.Replication.Changes
  alias Electric.Satellite.Permissions
  alias Electric.Satellite.Protocol

  defmodule Error do
    defstruct [:reason, :tx]

    @type t() :: %__MODULE__{reason: String.t(), tx: Changes.Transaction.t()}

    def error_response(%__MODULE__{} = error) do
      %Electric.Satellite.SatErrorResp{
        error_type: :PERMISSION_DENIED,
        lsn: error.tx.lsn,
        message: error.reason
      }
    end

    defimpl String.Chars do
      def to_string(error) do
        "Changes in transaction [LSN #{error.tx.lsn || "?"}] " <>
          "were refused for the following reason: " <>
          error.reason
      end
    end
  end

  def validate(txns, %Protocol.State{} = state) when is_list(txns) do
    if Permissions.enabled?() do
      %{permissions: permissions, out_rep: %{sent_rows_graph: srg}} = state
      graph_impl = Electric.Replication.ScopeGraph.impl(srg)
      validate_txns(txns, permissions, graph_impl, [])
    else
      {:ok, state.permissions}
    end
  end

  def error_response(%{message: message, tx: tx}) do
    %Electric.Satellite.SatErrorResp{
      error_type: :PERMISSION_DENIED,
      lsn: tx.lsn,
      message: message
    }
  end

  defp validate_txns([], permissions, _graph, _acc) do
    {:ok, permissions}
  end

  defp validate_txns([tx | txns], permissions, graph, acc) do
    case Permissions.validate_write(permissions, graph, tx) do
      {:ok, permissions} ->
        validate_txns(txns, permissions, graph, [tx | acc])

      {:error, reason} ->
        {:error, %Error{reason: reason, tx: tx}, permissions, Enum.reverse(acc), txns}
    end
  end
end
