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
end
