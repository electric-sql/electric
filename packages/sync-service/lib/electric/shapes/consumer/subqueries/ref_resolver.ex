defmodule Electric.Shapes.Consumer.Subqueries.RefResolver do
  # Resolves canonical subquery refs from dependency ids and dependency indexes.

  @enforce_keys [:id_to_ref, :index_to_ref]
  defstruct [:id_to_ref, :index_to_ref]

  @type ref() :: [String.t()]
  @type t() :: %__MODULE__{
          id_to_ref: %{Electric.shape_id() => {non_neg_integer(), ref()}},
          index_to_ref: %{non_neg_integer() => ref()}
        }

  @spec new(%{Electric.shape_id() => {non_neg_integer(), ref()}}, %{non_neg_integer() => ref()}) ::
          t()
  def new(id_to_ref, index_to_ref) do
    %__MODULE__{id_to_ref: id_to_ref, index_to_ref: index_to_ref}
  end

  @spec ref_from_dep_id!(t(), Electric.shape_id()) :: ref()
  def ref_from_dep_id!(%__MODULE__{id_to_ref: mapping}, dep_id) do
    case Map.fetch(mapping, dep_id) do
      {:ok, {_dep_index, ref}} ->
        ref

      :error ->
        raise ArgumentError,
              "unexpected dependency id #{inspect(dep_id)}, " <>
                "known: #{inspect(Map.keys(mapping))}"
    end
  end

  @spec ref_from_dep_index!(t(), non_neg_integer()) :: ref()
  def ref_from_dep_index!(%__MODULE__{index_to_ref: mapping}, dep_index) do
    Map.fetch!(mapping, dep_index)
  end
end
