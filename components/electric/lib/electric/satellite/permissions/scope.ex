defmodule Electric.Satellite.Permissions.Scope do
  alias Electric.Replication.Changes

  @type state() :: term()
  @type relation() :: Electric.Postgres.relation()
  @type t() :: {module(), state()}
  @type record() :: Changes.record()
  @type id() :: binary()

  @doc """
  Returns the id of the root document of the tree based on the `root` table for the given change.

  If the change doesn't belong in the given tree, or is malformed in some way (e.g. not providing
  a fk value) then this will return `{:error, reason}`.

  If the lookup fails for some other reason, e.g. the backing store is offline or something, then
  this should raise.
  """
  @callback scope_id!(state(), root :: relation(), Changes.change()) ::
              {:ok, id()} | {:error, String.t()} | no_return()

  @callback modifies_fk?(state(), root :: relation(), Changes.UpdatedRecord.t()) :: boolean()

  defguardp is_relation(r) when is_tuple(r) and tuple_size(r) == 2

  defguardp is_change(c)
            when is_struct(c, Changes.NewRecord) or is_struct(c, Changes.DeletedRecord) or
                   is_struct(c, Changes.UpdatedRecord)

  defguardp is_update(c) when is_struct(c, Changes.UpdatedRecord)

  def scope_id!({module, state}, root, change) when is_relation(root) and is_change(change) do
    module.scope_id!(state, root, change)
  end

  def modifies_fk?({module, state}, root, change) when is_relation(root) and is_update(change) do
    module.modifies_fk?(state, root, change)
  end
end
