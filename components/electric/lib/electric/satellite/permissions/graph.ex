defmodule Electric.Satellite.Permissions.Graph do
  @moduledoc """
  Defines a simple behaviour that allows the permissions system to find a record's position within
  a DAG.

  The DAG is defined by scope roots in DDLX `ASSIGN` statements and the foreign key relations
  within the db tables.
  """
  alias Electric.Replication.Changes
  alias Electric.Satellite.Permissions.ScopeMove
  alias Electric.Satellite.Permissions.Structure

  import Electric.Postgres.Extension, only: [is_extension_relation: 1]

  @type state() :: term()
  @type relation() :: Electric.Postgres.relation()
  @type scope_root() :: relation()
  @type impl() :: {module(), state()} | state()
  @type record() :: Changes.record()

  @type txn() :: Changes.Transaction.t()
  @type id() :: [Electric.Postgres.pk(), ...]
  @type tx_fun() :: (txn(), state() -> txn())
  @type change() :: Changes.change()
  @type scope_path_information() :: term()
  @type scope_result() :: {id(), scope_path_information()}
  @type path_metadata() :: term()
  @type path_elem() :: {relation(), id(), path_metadata()}
  @type scope_path() :: [path_elem(), ...]

  defmodule Error do
    defexception [:message]
  end

  @doc """
  Returns the path through the graph from the given `relation()` or `nil` if there is no path from
  relation to root.

  Should be in "reverse" order, i.e. the first element of a valid path should be the root of the path.

  The returned `path_elem()` elements contain a `path_metadata()` term that could be
  unecessary but allows for the underlying graph impl (i.e. the shapes manager) to append
  per-node data.
  """
  @callback scope_path(impl(), Structure.t(), scope_root(), relation(), id()) ::
              scope_path() | nil

  @doc """
  Returns an updated scope state including the given change.
  """
  @callback apply_change(impl(), Structure.t(), change()) :: impl()

  @behaviour __MODULE__

  @data_change_types [Changes.NewRecord, Changes.UpdatedRecord, Changes.DeletedRecord]

  defguardp is_relation(r) when is_tuple(r) and tuple_size(r) == 2

  def graph(attrs \\ []) do
    Graph.new(Keyword.merge(attrs, vertex_identifier: & &1))
  end

  @doc """
  `scope_id/3` is a wrapper around the #{__MODULE__} callback `scope_id/4` that provides some
  logic for handling resolving scope ids for the various kinds of changes.

  This is not part of the behaviour because there's no need for the implementations to have do
  duplicate this logic, but provides the most useful API for the permissions checks.
  """
  # for the new record case, we need to find the parent table we're adding a child of
  # in order to find its place in the tree
  @spec scope_id(
          impl(),
          Structure.t(),
          scope_root(),
          relation(),
          Changes.change() | ScopeMove.t()
        ) :: [
          scope_result()
        ]
  def scope_id(impl, structure, root, %Changes.NewRecord{relation: root, record: record})
      when is_relation(root) do
    scope_id(impl, structure, root, root, Structure.pk_val(structure, root, record))
  end

  def scope_id(impl, structure, root, %Changes.NewRecord{relation: relation, record: record})
      when is_relation(root) do
    parent_scope_id(impl, structure, root, relation, record)
  end

  # Similarly for our special ScopeMove update -- which is generated as a pseudo-change when a row
  # is being moved between permissions scopes in `Permissions.expand_change/2`, we need to verify
  # the scope of a row that doesn't exist in the tree, so instead we find the scope of the parent.
  def scope_id(impl, structure, root, %ScopeMove{relation: relation, record: record})
      when is_relation(root) do
    parent_scope_id(impl, structure, root, relation, record)
  end

  def scope_id(impl, structure, root, %Changes.DeletedRecord{
        relation: relation,
        old_record: record
      })
      when is_relation(root) do
    scope_id(impl, structure, root, relation, record)
  end

  @spec scope_id(impl(), Structure.t(), scope_root(), relation(), %{
          relation: relation(),
          record: record()
        }) :: [
          scope_result()
        ]
  def scope_id(impl, structure, root, %{relation: relation, record: record})
      when is_relation(root) do
    scope_id(impl, structure, root, relation, Structure.pk_val(structure, relation, record))
  end

  @spec scope_id(impl(), Structure.t(), scope_root(), relation(), Changes.record()) :: [
          scope_result()
        ]
  def scope_id(impl, structure, root, relation, record)
      when is_relation(root) and is_relation(relation) and is_map(record) do
    scope_id(impl, structure, root, relation, Structure.pk_val(structure, relation, record))
  end

  @spec scope_id(impl(), Structure.t(), scope_root(), relation(), id()) :: [scope_result()]
  def scope_id(_impl, _structure, root, root, id) do
    [{id, [{root, id}]}]
  end

  def scope_id({module, state}, structure, root, relation, id)
      when is_relation(root) and is_relation(relation) and is_list(id) do
    state
    |> module.scope_path(structure, root, relation, id)
    |> Enum.flat_map(fn
      [{^root, id, _attrs} | _] = path -> [{id, path}]
      _other -> []
    end)
  end

  def parent_scope_id(impl, structure, root, relation, record)
      when is_relation(root) and is_relation(relation) and is_map(record) do
    structure
    |> Structure.parent(root, relation, record)
    |> Enum.flat_map(fn {parent_relation, parent_id} ->
      scope_id(impl, structure, root, parent_relation, parent_id)
    end)
  end

  @impl __MODULE__
  def scope_path({_module, _state}, _structure, root, root, id)
      when is_relation(root) and is_list(id) do
    [{root, id, []}]
  end

  def scope_path({module, state}, structure, root, relation, id)
      when is_relation(root) and is_relation(relation) and is_list(id) do
    module.scope_path(state, structure, root, relation, id)
  end

  @spec transaction_context(impl(), Structure.t(), txn()) :: impl()
  def transaction_context(impl, structure, %Changes.Transaction{
        changes: changes,
        referenced_records: rr
      }) do
    transaction_context(impl, structure, changes, rr)
  end

  @spec transaction_context(impl(), Structure.t(), [Changes.change()]) :: impl()
  def transaction_context({_module, _state} = impl, structure, changes, referenced_records \\ []) do
    for {_relation, records} <- referenced_records,
        {_pk, %{relation: relation, record: record}} <- records do
      %Changes.NewRecord{relation: relation, record: record}
    end
    |> Stream.concat(changes)
    |> Enum.reduce(impl, &apply_change(&2, structure, &1))
  end

  @impl __MODULE__
  def apply_change({module, state}, _structure, %{relation: relation})
      when is_extension_relation(relation) do
    {module, state}
  end

  def apply_change({module, state}, structure, %type{} = change)
      when type in @data_change_types do
    {module, module.apply_change(state, structure, change)}
  end

  def apply_change({module, state}, _structure, _change) do
    {module, state}
  end
end
