defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.InMemory do
  @moduledoc """
  Pure ETS-backed, ephemeral implementation of the ShapeDb API.

  Provides the same public interface as `Electric.ShapeCache.ShapeStatus.ShapeDb`
  but stores all data in ETS tables owned by a single GenServer. There is no
  write buffer, no SQLite, and no persistence — all data is lost when the process
  stops.

  This is intended for testing and scenarios where persistence is not needed.

  ## ETS table layout

  A single named `:set` table per stack is used with the following key formats:

    - `{:shape, handle}` → `{shape, comparable_hash, hash, snapshot_complete?, [oid]}`
    - `{:comparable, comparable_hash}` → `handle`
    - `:count` → `integer` (number of live shapes)

  where `comparable_hash` is the SHA-256 of the deterministic term_to_binary of
  the shape's comparable form (matching the existing ShapeDb serialisation).
  """

  use GenServer

  require Logger

  alias Electric.Shapes.Shape

  import Electric, only: [is_stack_id: 1, is_shape_handle: 1]

  # ---------------------------------------------------------------------------
  # Naming helpers
  # ---------------------------------------------------------------------------

  def table_name(stack_id), do: :"shape_db_in_memory:#{stack_id}"

  def name(stack_id), do: Electric.ProcessRegistry.name(stack_id, __MODULE__)

  # ---------------------------------------------------------------------------
  # GenServer lifecycle
  # ---------------------------------------------------------------------------

  def start_link(args) do
    stack_id = Keyword.fetch!(args, :stack_id)
    GenServer.start_link(__MODULE__, args, name: name(stack_id))
  end

  @impl GenServer
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    Process.set_label({:shape_db_in_memory, stack_id})
    Logger.metadata(stack_id: stack_id)

    table = table_name(stack_id)

    :ets.new(table, [
      :named_table,
      :public,
      :set,
      read_concurrency: true,
      write_concurrency: :auto
    ])

    # Initialise the shape counter
    :ets.insert(table, {:count, 0})

    {:ok, %{stack_id: stack_id, table: table}}
  end

  # ---------------------------------------------------------------------------
  # Public API — mirroring Electric.ShapeCache.ShapeStatus.ShapeDb
  # ---------------------------------------------------------------------------

  @doc """
  Insert a shape into ETS. Returns `{:ok, shape_hash}`.
  """
  def add_shape(stack_id, %Shape{} = shape, shape_handle)
      when is_stack_id(stack_id) and is_shape_handle(shape_handle) do
    {comparable_shape, shape_hash} = Shape.comparable_hash(shape)
    relations = Shape.list_relations(shape)
    comparable_hash = comparable_to_hash(comparable_shape)
    table = table_name(stack_id)

    if :ets.insert_new(table, [
         {{:shape, shape_handle}, shape, comparable_hash, shape_hash, false, relations},
         {{:comparable, comparable_hash}, shape_handle}
       ]) do
      :ets.update_counter(table, :count, 1)
      {:ok, shape_hash}
    else
      {:error, "duplicate shape #{shape_handle} #{inspect(shape)}"}
    end
  end

  @doc """
  Remove a shape from ETS. Returns `:ok` or `{:error, {:enoshape, handle}}`.
  """
  def remove_shape(stack_id, shape_handle) when is_stack_id(stack_id) do
    table = table_name(stack_id)
    # comparable_hash is at position 3 in the shape tuple; default nil signals absence
    case :ets.lookup_element(table, {:shape, shape_handle}, 3, nil) do
      nil ->
        {:error, {:enoshape, shape_handle}}

      comparable_hash ->
        :ets.delete(table, {:shape, shape_handle})
        :ets.delete(table, {:comparable, comparable_hash})
        :ets.update_counter(table, :count, -1)
        :ok
    end
  end

  @doc """
  Mark the snapshot as complete for a shape.
  Returns `:ok` or `:error` if the handle does not exist.
  """
  def mark_snapshot_complete(stack_id, shape_handle) do
    table = table_name(stack_id)
    # snapshot_complete is at position 5 in the tuple (1-indexed)
    # tuple: {{:shape, handle}, shape, comparable_hash, hash, snapshot_complete, relations}
    #         1                 2      3                4     5                  6
    if :ets.update_element(table, {:shape, shape_handle}, {5, true}) do
      :ok
    else
      :error
    end
  end

  @doc """
  Clear all shapes.
  """
  def reset(stack_id) when is_stack_id(stack_id) do
    table = table_name(stack_id)
    :ets.delete_all_objects(table)
    :ets.insert(table, {:count, 0})
    :ok
  end

  @doc """
  Find a handle for a shape by its comparable hash.
  Returns `{:ok, handle}` or `:error`.
  """
  def handle_for_shape(stack_id, %Shape{} = shape) when is_stack_id(stack_id) do
    {comparable_shape, _hash} = Shape.comparable_hash(shape)
    comparable_hash = comparable_to_hash(comparable_shape)
    table = table_name(stack_id)

    # handle is at position 2 of the comparable row; default nil signals absence
    case :ets.lookup_element(table, {:comparable, comparable_hash}, 2, nil) do
      nil -> :error
      handle -> {:ok, handle}
    end
  end

  @doc """
  Same as `handle_for_shape/2` — no distinction needed since reads are
  always consistent in a single-table ETS store.
  """
  def handle_for_shape_critical(stack_id, %Shape{} = shape) when is_stack_id(stack_id) do
    handle_for_shape(stack_id, shape)
  end

  @doc """
  Find a shape by its handle. Returns `{:ok, shape}` or `:error`.
  """
  def shape_for_handle(stack_id, shape_handle) when is_stack_id(stack_id) do
    table = table_name(stack_id)

    # shape is at position 2 of the shape row; default nil signals absence
    case :ets.lookup_element(table, {:shape, shape_handle}, 2, nil) do
      nil -> :error
      shape -> {:ok, shape}
    end
  end

  @doc """
  List all shapes as `{handle, shape}` tuples, sorted by handle.
  Returns `{:ok, [{handle, shape}]}`.
  """
  def list_shapes(stack_id) when is_stack_id(stack_id) do
    shapes =
      table_name(stack_id)
      |> :ets.match({{:shape, :"$1"}, :"$2", :_, :_, :_, :_})
      |> Enum.map(fn [handle, shape] -> {handle, shape} end)
      |> Enum.sort_by(fn {handle, _} -> handle end)

    {:ok, shapes}
  end

  @doc """
  Same as `list_shapes/1` but raises on error.
  """
  def list_shapes!(stack_id) when is_stack_id(stack_id) do
    {:ok, shapes} = list_shapes(stack_id)
    shapes
  end

  @doc """
  Returns handles for shapes that touch any of the given relations (by OID).
  Returns `{:ok, [handle]}`.
  """
  def shape_handles_for_relations(stack_id, relations) when is_stack_id(stack_id) do
    if relations == [] do
      {:ok, []}
    else
      oids_set = relations |> Enum.map(fn {oid, _} -> oid end) |> MapSet.new()

      handles =
        table_name(stack_id)
        |> :ets.match({{:shape, :"$1"}, :_, :_, :_, :_, :"$2"})
        |> Enum.filter(fn [_handle, shape_rels] ->
          Enum.any?(shape_rels, fn {oid, _} -> MapSet.member?(oids_set, oid) end)
        end)
        |> Enum.map(fn [handle, _] -> handle end)
        |> Enum.sort()

      {:ok, handles}
    end
  end

  @doc """
  Same as `shape_handles_for_relations/2` but raises on error.
  """
  def shape_handles_for_relations!(stack_id, relations) when is_stack_id(stack_id) do
    {:ok, handles} = shape_handles_for_relations(stack_id, relations)
    handles
  end

  @doc """
  Fold over all `{handle, shape}` pairs.
  """
  def reduce_shapes(stack_id, acc, reducer_fun) when is_function(reducer_fun, 2) do
    :ets.foldl(
      fn
        {{:shape, handle}, shape, _comparable_hash, _hash, _snap, _rels}, acc ->
          reducer_fun.({handle, shape}, acc)

        _other, acc ->
          acc
      end,
      acc,
      table_name(stack_id)
    )
  end

  @doc """
  Fold over `{handle, hash, snapshot_complete?}` tuples.
  This mirrors the SQLite `reduce_shape_meta` API used during boot.
  """
  def reduce_shape_meta(stack_id, acc, reducer_fun) when is_function(reducer_fun, 2) do
    result =
      table_name(stack_id)
      |> :ets.match({{:shape, :"$1"}, :_, :_, :"$2", :"$3", :_})
      |> Enum.map(fn [handle, hash, snapshot_complete] -> {handle, hash, snapshot_complete} end)
      |> Enum.sort_by(fn {handle, _, _} -> handle end)
      |> Enum.reduce(acc, reducer_fun)

    result
  end

  @doc """
  Returns the total count of shapes. Returns `{:ok, count}`.
  """
  def count_shapes(stack_id) do
    count = :ets.lookup_element(table_name(stack_id), :count, 2)
    {:ok, count}
  end

  @doc """
  Same as `count_shapes/1` but raises on error.
  """
  def count_shapes!(stack_id) do
    {:ok, count} = count_shapes(stack_id)
    count
  end

  @doc false
  def handle_exists?(stack_id, shape_handle) when is_stack_id(stack_id) do
    :ets.member(table_name(stack_id), {:shape, shape_handle})
  end

  @doc """
  Validates existing shapes, removing any that have not completed their snapshot.
  Returns `{:ok, removed_handles, valid_count}`.

  In the InMemory implementation this is identical to the persistent version:
  shapes whose snapshot has not been marked complete are deleted.
  """
  def validate_existing_shapes(stack_id) do
    table = table_name(stack_id)

    # Find shapes with snapshot_complete = false
    incomplete =
      :ets.match(table, {{:shape, :"$1"}, :_, :"$2", :_, false, :_})
      |> Enum.map(fn [handle, comparable_hash] -> {handle, comparable_hash} end)

    Enum.each(incomplete, fn {handle, comparable_hash} ->
      :ets.delete(table, {:shape, handle})
      :ets.delete(table, {:comparable, comparable_hash})
      :ets.update_counter(table, :count, -1)
    end)

    removed_handles = Enum.map(incomplete, fn {handle, _} -> handle end)

    {:ok, count} = count_shapes(stack_id)
    {:ok, removed_handles, count}
  end

  @doc """
  Returns `false` — this implementation is ephemeral; data is not persisted
  across process restarts.
  """
  def persistent?, do: false

  @doc """
  No-op: there are no prepared statements to explain.
  """
  def explain(_stack_id), do: :ok

  @doc """
  Always returns 0: there is no write buffer.
  """
  def pending_buffer_size(_stack_id), do: 0

  @doc """
  Returns a statistics map. Since there is no SQLite, memory/disk values are 0.
  """
  def statistics(_stack_id) do
    {:ok, %{total_memory: 0, disk_size: 0}}
  end

  # ---------------------------------------------------------------------------
  # Internal helpers
  # ---------------------------------------------------------------------------

  # Matches the hashing logic in ShapeDb.Query.comparable_to_binary/1
  defp comparable_to_hash(comparable_shape) do
    comparable_shape
    |> :erlang.term_to_binary([:deterministic])
    |> then(&:crypto.hash(:sha256, &1))
  end
end
