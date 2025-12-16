defmodule Electric.Shapes.TreeIndex.Supervisor do
  @moduledoc """
  Supervises tree index processes for a stack.

  Tree indexes are used to precompute derived attributes that would otherwise
  require recursive queries. The primary use case is permission anchor computation
  for hierarchical ACL systems.

  ## Configuration

  Tree indexes are configured per-stack via the `:tree_indexes` option:

  ```elixir
  # In stack configuration
  tree_indexes: [
    %{
      type: :permission_anchor,
      table: {"public", "blocks"},
      id_column: "id",
      parent_column: "parent_id",
      has_acl_column: "permissions"
    }
  ]
  ```

  ## Integration with Shapes

  Once a tree index is running, shapes can reference the computed anchor
  in their WHERE clauses:

  ```
  GET /v1/shape?table=blocks
    &where=page_id=$1 AND __perm_anchor_id IN (SELECT anchor_id FROM user_anchors WHERE user_id=$2)
    &params[1]=page-123&params[2]=user-456
  ```

  The `__perm_anchor_id` is a virtual column provided by the tree index.
  """

  use Supervisor

  alias Electric.Shapes.TreeIndex.PermissionAnchorIndex

  require Logger

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    tree_indexes = Keyword.get(opts, :tree_indexes, [])

    Supervisor.start_link(__MODULE__, {stack_id, tree_indexes}, name: name(stack_id))
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @impl Supervisor
  def init({stack_id, tree_indexes}) do
    children =
      Enum.map(tree_indexes, fn config ->
        build_child_spec(stack_id, config)
      end)

    Logger.info("Starting TreeIndex.Supervisor with #{length(children)} indexes")

    Supervisor.init(children, strategy: :one_for_one)
  end

  defp build_child_spec(stack_id, %{type: :permission_anchor} = config) do
    full_config = Map.put(config, :stack_id, stack_id)

    %{
      id: {PermissionAnchorIndex, config.table},
      start: {PermissionAnchorIndex, :start_link, [full_config]},
      restart: :permanent,
      type: :worker
    }
  end

  @doc """
  Get all configured tree indexes for a stack.
  """
  def list_indexes(stack_id) do
    case Process.whereis(name(stack_id)) do
      nil ->
        []

      pid ->
        Supervisor.which_children(pid)
        |> Enum.map(fn {id, _pid, _type, _modules} -> id end)
    end
  end

  @doc """
  Check if a permission anchor index exists for a table.
  """
  def has_permission_anchor_index?(stack_id, table) do
    case Process.whereis(PermissionAnchorIndex.name(stack_id, table)) do
      nil -> false
      pid -> Process.alive?(pid)
    end
  end
end
