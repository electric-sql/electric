defmodule Electric.Satellite.Permissions.WriteBuffer do
  alias Electric.Replication.Changes
  alias Electric.Satellite.Permissions
  alias Electric.Satellite.Auth

  require Record
  require Logger

  # Slightly arbitrary high-water mark prompting warning messages.
  # Having this many writes from the client that have not been received back from pg will start to
  # show warnings in the logs
  @high_ops 50

  @behaviour Electric.Satellite.Permissions.Graph

  Record.defrecordp(:state,
    empty: true,
    graph: nil,
    upstream: nil,
    tags: MapSet.new(),
    ops: 0,
    user_id: nil,
    roles: %{},
    deleted_roles: MapSet.new(),
    role_grants: %{}
  )

  @type state() :: term()
  @type t() :: {__MODULE__, state()}

  @spec new(Auth.t()) :: Permissions.Graph.impl()
  def new(%Auth{} = auth) do
    {__MODULE__, state(user_id: auth.user_id)}
  end

  @doc """
  Set the upstream graph. This will be used as a base if the buffer is empty when receiving a transaction.
  """
  @spec with_upstream(t(), Permissions.Graph.impl()) :: t()
  def with_upstream({__MODULE__, state}, upstream) do
    {__MODULE__, state(state, upstream: upstream)}
  end

  # Some util functions useful for testing

  @doc false
  def pending_changes({__MODULE__, state(graph: graph)}) do
    graph
  end

  def pending_changes(state(graph: graph)) do
    graph
  end

  @doc false
  def seen_tags({__MODULE__, state}) do
    seen_tags(state)
  end

  def seen_tags(state(tags: tags)) do
    tags
  end

  @doc false
  def empty?({__MODULE__, state(empty: empty)}) do
    empty
  end

  def transient_roles({__MODULE__, state(role_grants: role_grants)}, nil, action) do
    Map.get(role_grants, action)
  end

  def transient_roles({__MODULE__, state}, grants, action) do
    state(role_grants: role_grants, deleted_roles: deleted_roles) = state
    grants = merge_transient_roles(grants, role_grants, action)

    if MapSet.size(deleted_roles) == 0 do
      grants
    else
      [:scoped, :unscoped]
      |> Enum.reduce(
        grants,
        &Map.update!(&2, &1, fn role_grants ->
          Stream.reject(role_grants, fn %{role: role} = _role_grant ->
            MapSet.member?(deleted_roles, role_key(role))
          end)
        end)
      )
    end
  end

  defp merge_transient_roles(grants, role_grants, action) do
    transient_grants = Map.get(role_grants, action, %{})

    Map.merge(grants, transient_grants, fn _key, grants1, grants2 ->
      Stream.concat(grants1, grants2)
    end)
  end

  def update_transient_roles({__MODULE__, state}, role_changes, grants) do
    state(roles: roles, deleted_roles: deleted) = state

    {roles, deleted} = Enum.reduce(role_changes, {roles, deleted}, &update_intermediate_role/2)

    role_grants = Permissions.build_role_grants(Map.values(roles), grants)

    {__MODULE__, state(state, roles: roles, deleted_roles: deleted, role_grants: role_grants)}
  end

  defp update_intermediate_role({:insert, role}, {roles, deleted}) do
    key = role_key(role)

    {
      Map.put(roles, key, role),
      MapSet.delete(deleted, key)
    }
  end

  defp update_intermediate_role({:update, role}, {roles, deleted}) do
    {Map.put(roles, role_key(role), role), deleted}
  end

  defp update_intermediate_role({:delete, role}, {roles, deleted}) do
    key = role_key(role)

    case Map.pop(roles, key) do
      {nil, roles} ->
        # deleting a role that we haven't just written
        {roles, MapSet.put(deleted, key)}

      {%{}, roles} ->
        {roles, deleted}
    end
  end

  defp update_intermediate_role({:delete, {relation, id}}, {roles, deleted}) do
    {Map.delete(roles, {relation, id}), deleted}
  end

  defp role_key(role) do
    {role.assign_id, role.id}
  end

  @moduledoc """
  Allow for GCing the locally kept state by monitoring the txns coming out of PG
  and dropping any accrued updates once all the client writes have been received
  by the shapes.

  Must be run *after* the shapes have been updated by the tx, so that there's an overlap
  between the local state here and the data in the shape graph.

  Also worth running against the original tx from PG, not the version filtered for the client
  because we're only looking for tags and there's a tiny chance that the client can't read its
  writes...

  So, something like:

       perms
       |> Permissions.filter_read(txn)
       |> Shape.update(shapes)

       # the shape graph now contains all the updates in the txn so we're free to GC the write
       # buffer in the permissions without a danger of inconsistencies
       perms = Permissions.receive_transaction(perms, txn)
  """
  def receive_transaction({__MODULE__, state}, scopes, %Changes.Transaction{} = txn) do
    {__MODULE__, receive_transaction(state, scopes, txn)}
  end

  def receive_transaction(state(empty: true) = state, _scopes, %Changes.Transaction{} = _txn) do
    state
  end

  def receive_transaction(state, scopes, %Changes.Transaction{} = txn) do
    txn.changes
    |> Enum.reduce(state, fn change, state(tags: tags) = state ->
      state(state, tags: Enum.reduce(change.tags, tags, &MapSet.delete(&2, &1)))
    end)
    |> detect_empty()
    |> apply_transaction(scopes, txn)
  end

  defp detect_empty(state(tags: tags, upstream: upstream, user_id: user_id) = state) do
    if MapSet.size(tags) == 0 do
      state(upstream: upstream, user_id: user_id)
    else
      state
    end
  end

  # if the tx has the right tags to clear the buffer, then don't apply the changes
  # as this will just result in a full buffer again
  defp apply_transaction(state(empty: true) = state, _scopes, _txn) do
    state
  end

  defp apply_transaction(state, scopes, txn) do
    Enum.reduce(txn.changes, state, &do_apply_change(&2, scopes, &1))
  end

  def upstream_graph({__MODULE__, state(upstream: upstream)}) do
    upstream
  end

  @impl Permissions.Graph
  def scope_path(state(empty: true, upstream: upstream), root, relation, record) do
    Permissions.Graph.scope_path(upstream, root, relation, record)
  end

  def scope_path(state, root, relation, id) when is_list(id) do
    state(graph: graph) = state

    Permissions.Graph.scope_path(graph, root, relation, id)
  end

  @impl Permissions.Graph
  def parent(state(upstream: upstream), root, relation, record) do
    Permissions.Graph.parent(upstream, root, relation, record)
  end

  @impl Permissions.Graph
  def apply_change(state, roots, change) do
    state
    |> do_apply_change(roots, change)
    |> state(empty: false)
    |> apply_tags(change)
    |> log_state()
  end

  defp do_apply_change(state, roots, change) do
    graph =
      case state do
        state(empty: true, upstream: upstream) -> upstream
        state(graph: graph) -> graph
      end

    state(state, graph: Permissions.Graph.apply_change(graph, roots, change))
  end

  defp apply_tags(state(tags: tags, ops: ops) = state, %{tags: change_tags}) do
    state(state, tags: Enum.into(change_tags, tags), ops: ops + 1)
  end

  defp log_state(state(ops: ops, user_id: user_id) = state) when ops > 0 and rem(ops, 10) == 0 do
    level = if ops >= @high_ops, do: :warn, else: :debug

    Logger.log(level, fn -> "Write buffer holding #{ops} unsynced ops" end, user_id: user_id)

    state
  end

  defp log_state(state) do
    state
  end

  @impl Permissions.Graph
  def primary_key(state(upstream: upstream), relation, record) do
    Permissions.Graph.primary_key(upstream, relation, record)
  end

  @impl Permissions.Graph
  def modified_fks(state(upstream: upstream), root, update) do
    Permissions.Graph.modified_fks(upstream, root, update)
  end
end
