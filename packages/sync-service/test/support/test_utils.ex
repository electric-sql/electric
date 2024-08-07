defmodule Support.TestUtils do
  alias Electric.LogItems
  alias Electric.Replication.Changes

  @doc """
  Preprocess a list of `Changes.data_change()` structs in the same way they
  are preprocessed before reaching storage.
  """
  def changes_to_log_items(changes, pk \\ ["id"], xid \\ 1) do
    changes
    |> Enum.map(&Changes.fill_key(&1, pk))
    |> Enum.flat_map(&LogItems.from_change(&1, xid, pk))
  end
end
