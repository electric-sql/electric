defmodule Electric.Replication.DownstreamProducer do
  @moduledoc """
  Behaviour for downstream producers

  Complimentary to GenStage.
  """

  @typedoc "Information that can be used by consumers to start from a point in time"
  @type offset_state :: term()

  @typedoc "The events produced follow this typespec"
  @type event :: {Electric.Replication.Changes.Transaction.t(), offset_state}

  @callback start_link(opts :: keyword()) :: {:ok, pid()} | {:error, term()}
  @callback start_replication(producer :: pid(), offset_state) :: :ok
  @callback connected?(producer :: pid()) :: boolean()

  @spec start_link(atom(), opts :: keyword()) :: {:ok, pid()} | {:error, term()}
  def start_link(module, start_arg) do
    module.start_link(start_arg)
  end

  @spec start_replication(atom(), pid(), offset_state()) :: :ok
  def start_replication(module, pid, offset_state) do
    module.start_replication(pid, offset_state)
  end

  @spec connected?(atom(), pid()) :: boolean()
  def connected?(module, pid) do
    module.connected?(pid)
  end
end
