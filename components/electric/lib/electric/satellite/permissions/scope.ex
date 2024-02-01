defmodule Electric.Satellite.Permissions.Scope do
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
  @type impl() :: {module(), state()}
  @type record() :: Changes.record()

  @type id() :: [Electric.Postgres.pk(), ...]
  @type tx_fun() :: (Changes.Transaction.t(), state() -> Changes.Transaction.t())
  @type change() :: Changes.change()
  @type scope_path_information() :: term()
  @type scope_result() :: {id(), scope_path_information()} | nil

  @enforce_keys [:read, :write]

  defstruct [:read, :write]

  @type t() :: %__MODULE__{read: impl(), write: impl()}

  @doc """
  Returns the id of the root document of the tree based on the `root` table for the given change
  and some opaque-to-the-caller, implementation dependant, path information useful for
  shape-related data moves following a permissions check.

  If the change doesn't belong in the given tree, or is malformed in some way (e.g. not providing
  a fk value) then this will return `nil`.

  If the lookup fails for some other reason, e.g. the backing store is offline or something, then
  this should raise.
  """
  @callback scope_id(state(), scope_root(), relation(), record() | id()) :: scope_result()

  @doc """
  Get the scope of the parent to this record, that is the scope of the record one level up* in the
  tree.

  Needed when we're trying to get the scope of an update that represents something that doesn't
  exist (yet) but is being inserted into the tree at a certain point represented by a fk on the
  row.

  * trees grow _down_, obviously
  """
  @callback parent_scope_id(state(), scope_root(), relation(), record()) :: scope_result()

  @doc """
  Returns an updated (temporary) scope state including the given change.
  """
  @callback apply_change(state(), [scope_root(), ...], change()) :: state()

  @doc """
  Returns the primary key value for the given record.
  """
  @callback primary_key(state(), relation(), Changes.record()) :: id()

  @doc """
  Determines if the given update modifies a foreign key that affects the row's scope based on the
  `root` relation.

  That is, does this update move the row from one scope to another?
  """
  @callback modifies_fk?(state(), scope_root(), Changes.UpdatedRecord.t()) :: boolean()

  @doc """
  Returns the parent id, that is a `{relation(), id()}` tuple, based on the given relation and
  record.

  This does not lookup values in the tree, it merely uses the foreign key information and the
  values in the record.
  """
  @callback parent(state(), scope_root(), relation(), record()) :: {relation(), id()} | nil

  @doc """
  Return the path through the tables' foreign keys that gets from the given relation to the root.

  If `relation` is the same as `root` then should return `[root]`.

  If there is no path from `relation` to `root`, returns `nil`.
  """
  @callback relation_path(state(), scope_root(), relation()) :: [relation(), ...] | nil

  @behaviour __MODULE__

  defguardp is_relation(r) when is_tuple(r) and tuple_size(r) == 2

  defguardp is_update(c) when is_struct(c, Changes.UpdatedRecord)

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
  def scope_id({module, state}, root, %Changes.NewRecord{} = change) when is_relation(root) do
    parent_scope_id({module, state}, root, change.relation, change.record)
  end

  # Similarly for our special ScopeMove update -- which is generated as a pseudo-change when a row
  # is being moved between permissions scopes in `Permissions.expand_change/2`, we need to verify
  # the scope of a row that doesn't exist in the tree, so instead we find the scope of the parent.
  def scope_id({module, state}, root, %ScopeMove{} = change) when is_relation(root) do
    parent_scope_id({module, state}, root, change.relation, change.record)
  end

  def scope_id({module, state}, root, %Changes.DeletedRecord{} = change) when is_relation(root) do
    scope_id({module, state}, root, change.relation, change.old_record)
  end

  def scope_id({module, state}, root, %{relation: relation, record: record})
      when is_relation(root) do
    module.scope_id(state, root, relation, record)
  end

  @impl __MODULE__
  def scope_id({module, state}, root, relation, record_or_ids)
      when is_relation(root) and is_relation(relation) and
             (is_map(record_or_ids) or is_list(record_or_ids)) do
    module.scope_id(state, root, relation, record_or_ids)
  end

  @impl __MODULE__
  def parent_scope_id({module, state}, root, relation, record)
      when is_relation(root) and is_relation(relation) do
    module.parent_scope_id(state, root, relation, record)
  end

  @impl __MODULE__
  def parent({module, state}, root, relation, record) do
    module.parent(state, root, relation, record)
  end

  @spec transaction_context(impl(), [relation()], Change.t()) :: impl()
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
  def modifies_fk?({module, state}, root, change) when is_relation(root) and is_update(change) do
    module.modifies_fk?(state, root, change)
  end

  def modifies_fk?(_resolver, root, _change) when is_relation(root) do
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
