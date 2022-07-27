defmodule Electric.Replication.Metadata do
  use Vax.Schema

  @type t() :: %__MODULE__{}

  schema "metadata" do
    field(:commit_timestamp, :string)
    field(:publication, :string)
    field(:origin, :string)
  end

  @doc """
  Updates the metadata key.

  There's a single metadata key which is updated for every postgres transaction.
  For more information about the metadata key, see the documentation for
  `Electric.Replication.Vaxine.TransactionBuilder.extract_metadata/1`
  """
  @spec new(commit_timestamp :: integer(), publication :: String.t(), origin :: String.t()) :: t()
  def new(commit_timestamp, publication, origin) do
    %__MODULE__{
      id: "0",
      commit_timestamp: to_string(commit_timestamp),
      publication: publication,
      origin: origin
    }
  end
end
