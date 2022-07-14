defmodule Electric.Replication.Metadata do
  use Vax.Schema

  @type t() :: %__MODULE__{}

  schema "metadata" do
    field(:commit_timestamp, :string)
    field(:publication, :string)
  end

  @spec new(commit_timestamp :: integer(), publication :: String.t()) :: t()
  def new(commit_timestamp, publication) do
    %__MODULE__{
      id: "0",
      commit_timestamp: to_string(commit_timestamp),
      publication: publication
    }
  end
end
