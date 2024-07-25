defmodule Support.TestUtils do
  alias Electric.ShapeCache.Storage
  alias Electric.Replication.Changes

  @doc """
  Preprocess a list of `Changes.data_change()` structs in the same way they
  are preprocessed before reaching storage.
  """
  def preprocess_changes(changes, pk \\ ["id"], xid \\ 1) do
    changes
    |> Enum.map(&Changes.fill_key(&1, pk))
    |> Enum.flat_map(&Storage.prepare_change_for_storage(&1, xid, pk))
  end
end
