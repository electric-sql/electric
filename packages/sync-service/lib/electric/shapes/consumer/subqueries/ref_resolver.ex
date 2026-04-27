defmodule Electric.Shapes.Consumer.Subqueries.RefResolver do
  # Resolves canonical subquery refs from dependency handles and dependency indexes.

  @enforce_keys [:handle_to_ref, :index_to_ref]
  defstruct [:handle_to_ref, :index_to_ref]

  @type ref() :: [String.t()]
  @type t() :: %__MODULE__{
          handle_to_ref: %{String.t() => {non_neg_integer(), ref()}},
          index_to_ref: %{non_neg_integer() => ref()}
        }

  @spec new(%{String.t() => {non_neg_integer(), ref()}}, %{non_neg_integer() => ref()}) :: t()
  def new(handle_to_ref, index_to_ref) do
    %__MODULE__{handle_to_ref: handle_to_ref, index_to_ref: index_to_ref}
  end

  @spec ref_from_dep_handle!(t(), String.t()) :: ref()
  def ref_from_dep_handle!(%__MODULE__{handle_to_ref: mapping}, dep_handle) do
    case Map.fetch(mapping, dep_handle) do
      {:ok, {_dep_index, ref}} ->
        ref

      :error ->
        raise ArgumentError,
              "unexpected dependency handle #{inspect(dep_handle)}, " <>
                "known: #{inspect(Map.keys(mapping))}"
    end
  end

  @spec ref_from_dep_index!(t(), non_neg_integer()) :: ref()
  def ref_from_dep_index!(%__MODULE__{index_to_ref: mapping}, dep_index) do
    Map.fetch!(mapping, dep_index)
  end
end
