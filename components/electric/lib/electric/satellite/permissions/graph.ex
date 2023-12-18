defmodule Electric.Satellite.Permissions.Graph do
  @moduledoc """
  Defines a simple behaviour that allows the permissions system to find a record's position within
  a DAG.

  The DAG is defined by scope roots in DDLX `ASSIGN` statements and the foreign key relations
  within the db tables.
  """
  alias Electric.Replication.Changes
  alias Electric.Satellite.Permissions.ScopeMove

  @type state() :: term()
  @type relation() :: Electric.Postgres.relation()
  @type scope_root() :: relation()
  @type impl() :: {module(), state()} | state()
  @type record() :: Changes.record()

  @type id() :: [Electric.Postgres.pk(), ...]
  @type tx_fun() :: (Changes.Transaction.t(), state() -> Changes.Transaction.t())
  @type change() :: Changes.change()
  @type scope_path_information() :: term()
  @type scope_result() :: {id(), scope_path_information()}
  @type path_metadata() :: term()
  @type path_elem() :: {relation(), id(), path_metadata()}
  @type scope_path() :: [path_elem(), ...]

  @enforce_keys [:read, :write]

  defstruct [:read, :write]

  @type t() :: %__MODULE__{read: impl(), write: impl()}

  @doc """
  Returns the path through the graph from the given `relation()` or `nil` if there is no path from
  relation to root.

  Should be in "reverse" order, i.e. the first element of a valid path should be the root of the path.

  The returned `path_elem()` elements contain a `path_metadata()` term that could be
  unecessary but allows for the underlying graph impl (i.e. the shapes manager) to append
  per-node data.
  """
  @callback scope_path(impl(), scope_root(), relation(), id()) :: scope_path() | nil

  @doc """
  Returns an updated scope state including the given change.
  """
  @callback apply_change(impl(), [scope_root(), ...], change()) :: impl()

  @doc """
  Returns the primary key value for the given record.
  """
  @callback primary_key(impl(), relation(), Changes.record()) :: id()

  @doc """
  Returns a list of modified fks for the scope given by `root`.

  That is, does this update move this row, or any of the rows it points to, from one scope to
  another?

  The list is a list of `{relation(), old_id :: id(), new_id :: id()}` tuples, pointing to the row
  affected by the fk change (which in the case of many to one relations, would be the updated row
  itself).

  For many-to-one relations the `old_id` and `new_id` values will be identical. For one-to-one
  relations, the old- and new-ids will be different, reflecting the changed target of the foreign
  key.
  """
  @callback modified_fks(impl(), scope_root(), Changes.UpdatedRecord.t()) :: [{relation(), id()}]

  @doc """
  Returns the parent id, that is a `{relation(), id()}` tuple, based on the given relation and
  record.

  This does not lookup values in the tree, it merely uses the foreign key information and the
  values in the record.

  Returns `nil` if the given relation does not have a foreign key for the given scope (which may
  happen in the case of scopes built via join tables).
  """
  @callback parent(impl(), scope_root(), relation(), record()) :: {relation(), id()} | nil

  @doc """
  Return the path through the tables' foreign keys that gets from the given relation to the root.

  If `relation` is the same as `root` then should return `[root]`.

  If there is no path from `relation` to `root`, returns `nil`.
  """
  @callback relation_path(impl(), scope_root(), relation()) :: [relation(), ...] | nil

  @behaviour __MODULE__

  defguardp is_relation(r) when is_tuple(r) and tuple_size(r) == 2

  defguardp is_update(c) when is_struct(c, Changes.UpdatedRecord)

  def graph(attrs \\ []) do
    Graph.new(Keyword.merge(attrs, vertex_identifier: & &1))
  end

  # if the relation path is invalid, like going against the fks
  # then the relation_path is nil and so the scope is nil
  def traverse_fks(_graph, nil, _table, _id) do
    []
  end

  # doesn't validate that the traversal reaches the given root
  def traverse_fks(graph, [table | relation_path], table, id) do
    do_traverse_fks(graph, relation_path, {table, id}, [{table, id}])
  end

  defp do_traverse_fks(_graph, [], _record, path) do
    [path]
  end

  defp do_traverse_fks(graph, [relation | relation_path], record, path) do
    parents =
      graph
      |> Graph.edges(record)
      |> Enum.flat_map(fn
        %{v1: {^relation, _id} = parent} ->
          [parent]

        %{v2: {^relation, _id} = parent} ->
          [parent]

        _ ->
          []
      end)

    case parents do
      [] ->
        # rather than returning an empty result at this point, we want to return the partial
        # result so that it's possible to continue the resolution elsewhere if necessary
        [path]

      parents ->
        Enum.flat_map(parents, &do_traverse_fks(graph, relation_path, &1, [&1 | path]))
    end
  end

  @spec new(Access.t()) :: t() | no_return()
  def new(attrs) do
    with {:ok, read} <- Access.fetch(attrs, :read),
         {:ok, write} <- Access.fetch(attrs, :write) do
      %__MODULE__{read: read, write: write}
    else
      :error ->
        raise ArgumentError, message: "you must pass both :read and :write scope implementations"
    end
  end

  @doc """
  `scope_id/3` is a wrapper around the #{__MODULE__} callback `scope_id/4` that provides some
  logic for handling resolving scope ids for the various kinds of changes.

  This is not part of the behaviour because there's no need for the implementations to have do
  duplicate this logic, but provides the most useful API for the permissions checks.
  """
  # for the new record case, we need to find the parent table we're adding a child of
  # in order to find its place in the tree
  @spec scope_id(impl(), scope_root(), relation(), Changes.change() | ScopeMove.t()) ::
          nil | [scope_result(), ...]
  def scope_id(impl, root, %Changes.NewRecord{} = change) when is_relation(root) do
    parent_scope_id(impl, root, change.relation, change.record)
  end

  # Similarly for our special ScopeMove update -- which is generated as a pseudo-change when a row
  # is being moved between permissions scopes in `Permissions.expand_change/2`, we need to verify
  # the scope of a row that doesn't exist in the tree, so instead we find the scope of the parent.
  def scope_id(impl, root, %ScopeMove{} = change) when is_relation(root) do
    parent_scope_id(impl, root, change.relation, change.record)
  end

  def scope_id(impl, root, %Changes.DeletedRecord{} = change) when is_relation(root) do
    scope_id(impl, root, change.relation, change.old_record)
  end

  @spec scope_id(impl(), scope_root(), relation(), %{relation: relation(), record: record()}) :: [
          scope_result()
        ]
  def scope_id(impl, root, %{relation: relation, record: record}) when is_relation(root) do
    scope_id(impl, root, relation, primary_key(impl, relation, record))
  end

  @spec scope_id(impl(), scope_root(), relation(), Changes.record()) :: [scope_result()]
  def scope_id(impl, root, relation, record)
      when is_relation(root) and is_relation(relation) and is_map(record) do
    scope_id(impl, root, relation, primary_key(impl, relation, record))
  end

  @spec scope_id(impl(), scope_root(), relation(), id()) :: [scope_result()]
  def scope_id(_impl, root, root, id) do
    [{id, [{root, id}]}]
  end

  def scope_id({module, state}, root, relation, id)
      when is_relation(root) and is_relation(relation) and is_list(id) do
    state
    |> module.scope_path(root, relation, id)
    |> Enum.flat_map(fn
      [{^root, id, _attrs} | _] = path -> [{id, path}]
      _other -> []
    end)
  end

  def parent_scope_id(impl, root, relation, record)
      when is_relation(root) and is_relation(relation) and is_map(record) do
    case parent(impl, root, relation, record) do
      {parent_relation, parent_id} ->
        scope_id(impl, root, parent_relation, parent_id)

      nil ->
        []
    end
  end

  @impl __MODULE__
  def scope_path({_module, _state}, root, root, id) when is_relation(root) and is_list(id) do
    [{root, id, []}]
  end

  def scope_path({module, state}, root, relation, id)
      when is_relation(root) and is_relation(relation) and is_list(id) do
    module.scope_path(state, root, relation, id)
  end

  @impl __MODULE__
  # [VAX-1626] we don't support recursive relations
  def parent(_state, root, root, _record) do
    nil
  end

  def parent({module, state}, root, relation, record) do
    module.parent(state, root, relation, record)
  end

  @spec transaction_context(impl(), [relation()], Changes.Transaction.t()) :: impl()
  def transaction_context({_module, _state} = impl, roots, %Changes.Transaction{changes: changes}) do
    Enum.reduce(changes, impl, &apply_change(&2, roots, &1))
  end

  @impl __MODULE__
  def apply_change({module, state}, _roots, %ScopeMove{} = _change) do
    {module, state}
  end

  def apply_change({module, state}, roots, change) do
    {module, module.apply_change(state, roots, change)}
  end

  @impl __MODULE__
  def modified_fks({module, state}, root, change) when is_relation(root) and is_update(change) do
    module.modified_fks(state, root, change)
  end

  def modified_fks(_resolver, root, _change) when is_relation(root) do
    false
  end

  @impl __MODULE__
  def primary_key({module, state}, relation, record) do
    module.primary_key(state, relation, record)
  end

  @impl __MODULE__
  def relation_path(_impl, root, root) do
    [root]
  end

  def relation_path({module, state}, root, relation) do
    module.relation_path(state, root, relation)
  end
end
