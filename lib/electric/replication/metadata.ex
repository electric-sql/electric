defmodule Electric.Replication.Metadata do
  use Vax.Schema

  @type t() :: %__MODULE__{}

  schema "metadata" do
    field(:commit_timestamp, :string)
    field(:publication, :string)
    field(:origin, :string)
  end

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
