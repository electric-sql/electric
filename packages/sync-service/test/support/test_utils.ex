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
    |> Enum.map(fn item -> {item.offset, Jason.encode!(item)} end)
  end

  def with_electric_instance_id(ctx) do
    %{electric_instance_id: String.to_atom(full_test_name(ctx))}
  end

  def full_test_name(ctx) do
    "#{ctx.module} #{ctx.test}"
  end
end
