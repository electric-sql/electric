defmodule Electric.Satellite.Permissions.Scope do
  @moduledoc """
  Defines a simple behaviour that allows the permissions system to find a record's position within
  a DAG.

  The DAG is defined by scope roots in DDLX `ASSIGN` statements and the foreign key relations
  within the db tables.
  """
  alias Electric.Replication.Changes

  @type state() :: term()
  @type relation() :: Electric.Postgres.relation()
  @type t() :: {module(), state()}
  @type record() :: Changes.record()
  @type id() :: Electric.Postgres.pk()
  @type tx_fun() :: (Changes.Transaction.t(), state() -> Changes.Transaction.t())
  @type change() :: Changes.change()
  @type scope_path_information() :: term()

  @doc """
  Returns the id of the root document of the tree based on the `root` table for the given change
  and some opaque-to-the-caller, implementation dependant, path information useful for
  shape-related data moves following a permissions check.

  If the change doesn't belong in the given tree, or is malformed in some way (e.g. not providing
  a fk value) then this will return `nil`.

  If the lookup fails for some other reason, e.g. the backing store is offline or something, then
  this should raise.
  """
  @callback scope_id(state(), root :: relation(), Changes.change()) ::
              {id(), scope_path_information()} | nil

  @doc """
  Returns the same information as for the `scope_id/3` callback, but takes `relation()` and
  `record()` arguments.

  Useful when the caller wants to control exactly which values it sends for the row
  values, e.g. using the `old_record` values of an update, rather than the updated
  values.
  """
  @callback scope_id(state(), root :: relation(), relation(), record()) ::
              {id(), scope_path_information()} | nil

  @doc """
  Returns an updated scope state including the changes in the given transaction.
  """
  @callback transaction_context(state(), Changes.Transaction.t()) :: state()

  @doc """
  Returns the primary key value for the given record.
  """
  @callback primary_key(state(), relation(), Changes.record()) :: id()

  @doc """
  Determines if the given update modifies a foreign key that affects the row's scope based on the
  `root` relation.

  That is, does this update move the row from one scope to another?
  """
  @callback modifies_fk?(state(), root :: relation(), Changes.UpdatedRecord.t()) :: boolean()

  @behaviour __MODULE__

  defguardp is_relation(r) when is_tuple(r) and tuple_size(r) == 2

  defguardp is_change(c)
            when is_struct(c, Changes.NewRecord) or is_struct(c, Changes.DeletedRecord) or
                   is_struct(c, Changes.UpdatedRecord)

  defguardp is_update(c) when is_struct(c, Changes.UpdatedRecord)

  @impl __MODULE__
  def scope_id({module, state}, root, change) when is_relation(root) and is_change(change) do
    module.scope_id(state, root, change)
  end

  @impl __MODULE__
  def scope_id({module, state}, root, relation, record)
      when is_relation(root) and is_relation(relation) do
    module.scope_id(state, root, relation, record)
  end

  @impl __MODULE__
  def transaction_context({module, state}, %Changes.Transaction{} = tx) do
    {module, module.transaction_context(state, tx)}
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
end
