defmodule Electric.ShapeCache.ShapeStatusBehaviour do
  @moduledoc """
  Behaviour defining the ShapeStatus functions to be used in mocks
  """
  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Postgres.LogicalReplication.Messages
  alias Electric.Replication.Changes.Relation

  @callback initialise(ShapeStatus.options()) :: {:ok, ShapeStatus.t()} | {:error, term()}
  @callback list_shapes(ShapeStatus.t()) :: [{ShapeStatus.shape_id(), Shape.t()}]
  @callback list_active_shapes(opts :: keyword()) :: [
              {ShapeStatus.shape_id(), ShapeStatus.shape_def(), ShapeStatus.xmin()}
            ]
  @callback get_relation(ShapeStatus.t(), Messages.relation_id()) :: Relation.t() | nil
  @callback store_relation(ShapeStatus.t(), Relation.t()) :: :ok
  @callback remove_shape(ShapeStatus.t(), ShapeStatus.shape_id()) ::
              {:ok, ShapeStatus.t()} | {:error, term()}
end

defmodule Electric.ShapeCache.ShapeStatus do
  @moduledoc """
  Keeps track of shape state.

  Serializes just enough to some persistent storage to bootstrap the
  ShapeCache by writing the mapping of `shape_id => %Shape{}` to
  storage.

  The shape cache then loads this and starts processes (storage and consumer)
  for each `{shape_id, %Shape{}}` pair. These then use their attached storage
  to recover the status information for the shape (snapshot xmin and latest
  offset).

  The ETS metadata table name is part of the config because we need to be able
  to access the data in the ETS from anywhere, so there's an internal api,
  using the full state and an external api using just the table name.
  """
  alias Electric.PersistentKV
  alias Electric.Shapes.Shape
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes.{Column, Relation}

  @schema NimbleOptions.new!(
            persistent_kv: [type: :any, required: true],
            shape_meta_table: [type: {:or, [:atom, :reference]}, required: true],
            root: [type: :string, default: "./shape_cache"]
          )

  defstruct [:persistent_kv, :root, :shape_meta_table]

  @type shape_id() :: Electric.ShapeCache.shape_id()
  @type table() :: atom() | reference()
  @type t() :: %__MODULE__{
          persistent_kv: PersistentKV.t(),
          root: String.t(),
          shape_meta_table: table()
        }
  @type option() :: unquote(NimbleOptions.option_typespec(@schema))
  @type options() :: [option()]

  @shape_meta_data :shape_meta_data
  @shape_hash_lookup :shape_hash_lookup
  @shape_meta_shape_pos 2
  @shape_meta_xmin_pos 3
  @shape_meta_latest_offset_pos 4
  @relation_data :relation_data

  @spec initialise(options()) :: {:ok, t()} | {:error, term()}
  def initialise(opts) do
    with {:ok, config} <- NimbleOptions.validate(opts, @schema),
         {:ok, kv_backend} <- Access.fetch(config, :persistent_kv),
         {:ok, table_name} = Access.fetch(config, :shape_meta_table) do
      persistent_kv =
        PersistentKV.Serialized.new!(
          backend: kv_backend,
          decoder: {__MODULE__, :decode_shapes, []}
        )

      meta_table = :ets.new(table_name, [:named_table, :public, :ordered_set])

      state =
        struct(
          __MODULE__,
          Keyword.merge(config, persistent_kv: persistent_kv, shape_meta_table: meta_table)
        )

      load(state)
    end
  end

  @spec add_shape(t(), Shape.t()) :: {:ok, shape_id(), LogOffset.t()} | {:error, term()}
  def add_shape(state, shape) do
    {hash, shape_id} = Shape.generate_id(shape)
    # fresh snapshots always start with a zero offset - only once they
    # are folded into the log do we have non-zero offsets
    offset = LogOffset.first()

    true =
      :ets.insert_new(
        state.shape_meta_table,
        [
          {{@shape_hash_lookup, hash}, shape_id},
          {{@shape_meta_data, shape_id}, shape, nil, offset}
        ]
      )

    with :ok <- save(state) do
      {:ok, shape_id}
    end
  end

  @spec list_shapes(t()) :: [{shape_id(), Shape.t()}]
  def list_shapes(state) do
    :ets.select(state.shape_meta_table, [
      {
        {{@shape_meta_data, :"$1"}, :"$2", :_, :_},
        [true],
        [{{:"$1", :"$2"}}]
      }
    ])
  end

  @spec remove_shape(t(), shape_id()) :: {:ok, t()} | {:error, term()}
  def remove_shape(state, shape_id) do
    try do
      shape =
        :ets.lookup_element(
          state.shape_meta_table,
          {@shape_meta_data, shape_id},
          @shape_meta_shape_pos
        )

      :ets.select_delete(
        state.shape_meta_table,
        [
          {{{@shape_meta_data, shape_id}, :_, :_, :_}, [], [true]},
          {{{@shape_hash_lookup, :_}, shape_id}, [], [true]}
        ]
      )

      with :ok <- save(state) do
        {:ok, shape}
      end
    rescue
      # Sometimes we're calling cleanup when snapshot creation has failed for
      # some reason. In those cases we're not sure about the state of the ETS
      # keys, so we're doing our best to just delete everything without
      # crashing
      ArgumentError ->
        :error
    end
  end

  @spec existing_shape(t(), shape_id() | Shape.t()) :: nil | {shape_id(), LogOffset.t()}
  def existing_shape(%__MODULE__{shape_meta_table: table}, shape_or_id) do
    existing_shape(table, shape_or_id)
  end

  @spec existing_shape(table(), Shape.t()) :: nil | {shape_id(), LogOffset.t()}
  def existing_shape(meta_table, %Shape{} = shape) do
    hash = Shape.hash(shape)

    case :ets.select(meta_table, [{{{@shape_hash_lookup, hash}, :"$1"}, [true], [:"$1"]}]) do
      [] ->
        nil

      [shape_id] ->
        {shape_id, latest_offset!(meta_table, shape_id)}
    end
  end

  @spec existing_shape(table(), shape_id()) :: nil | {shape_id(), LogOffset.t()}
  def existing_shape(meta_table, shape_id) when is_binary(shape_id) do
    case :ets.lookup(meta_table, {@shape_meta_data, shape_id}) do
      [] -> nil
      [{_, _shape, _xmin, offset}] -> {shape_id, offset}
    end
  end

  def initialise_shape(state, shape_id, snapshot_xmin, latest_offset) do
    :ets.update_element(state.shape_meta_table, {@shape_meta_data, shape_id}, [
      {@shape_meta_xmin_pos, snapshot_xmin},
      {@shape_meta_latest_offset_pos, latest_offset}
    ])

    :ok
  end

  def set_snapshot_xmin(state, shape_id, snapshot_xmin) do
    :ets.update_element(state.shape_meta_table, {@shape_meta_data, shape_id}, [
      {@shape_meta_xmin_pos, snapshot_xmin}
    ])
  end

  def set_latest_offset(%__MODULE__{shape_meta_table: table} = _state, shape_id, latest_offset) do
    set_latest_offset(table, shape_id, latest_offset)
  end

  def set_latest_offset(meta_table, shape_id, latest_offset) do
    :ets.update_element(meta_table, {@shape_meta_data, shape_id}, [
      {@shape_meta_latest_offset_pos, latest_offset}
    ])
  end

  def latest_offset!(%__MODULE__{shape_meta_table: table} = _state, shape_id) do
    latest_offset(table, shape_id)
  end

  def latest_offset!(meta_table, shape_id) do
    :ets.lookup_element(
      meta_table,
      {@shape_meta_data, shape_id},
      @shape_meta_latest_offset_pos
    )
  end

  def latest_offset(%__MODULE__{shape_meta_table: table} = _state, shape_id) do
    latest_offset(table, shape_id)
  end

  def latest_offset(meta_table, shape_id) do
    turn_raise_into_error(fn ->
      :ets.lookup_element(
        meta_table,
        {@shape_meta_data, shape_id},
        @shape_meta_latest_offset_pos
      )
    end)
  end

  def snapshot_xmin(%__MODULE__{shape_meta_table: table} = _state, shape_id) do
    snapshot_xmin(table, shape_id)
  end

  def snapshot_xmin(meta_table, shape_id) when is_atom(meta_table) do
    turn_raise_into_error(fn ->
      :ets.lookup_element(
        meta_table,
        {@shape_meta_data, shape_id},
        @shape_meta_xmin_pos
      )
    end)
  end

  def snapshot_xmin?(%__MODULE__{shape_meta_table: table} = _state, shape_id) do
    snapshot_xmin?(table, shape_id)
  end

  def snapshot_xmin?(meta_table, shape_id) when is_atom(meta_table) do
    case snapshot_xmin(meta_table, shape_id) do
      {:ok, xmin} -> !is_nil(xmin)
      :error -> false
    end
  end

  def get_relation(%__MODULE__{shape_meta_table: table} = _state, relation_id) do
    get_relation(table, relation_id)
  end

  def get_relation(meta_table, relation_id) do
    case :ets.lookup(meta_table, {@relation_data, relation_id}) do
      [] -> nil
      [{{@relation_data, ^relation_id}, relation}] -> relation
    end
  end

  def store_relation(%__MODULE__{shape_meta_table: meta_table} = state, %Relation{} = relation) do
    with :ok <- store_relation(meta_table, relation) do
      save(state)
    end
  end

  def store_relation(meta_table, %Relation{} = relation) do
    true = :ets.insert(meta_table, {{@relation_data, relation.id}, relation})
    :ok
  end

  @doc false
  def decode_shapes(json) do
    with {:ok, %{"shapes" => shapes, "relations" => relations}} <- Jason.decode(json) do
      {:ok,
       %{
         shapes: Map.new(shapes, fn {id, shape} -> {id, Shape.from_json_safe!(shape)} end),
         relations:
           Map.new(relations, fn %{"id" => id} = relation ->
             {id, relation_from_json(relation)}
           end)
       }}
    end
  end

  defp relation_from_json(json) do
    %{"columns" => columns, "id" => id, "schema" => schema, "table" => table} = json

    %Relation{
      id: id,
      schema: schema,
      table: table,
      columns: Enum.map(columns, &relation_column_from_json/1)
    }
  end

  defp relation_column_from_json(json) do
    %{"name" => name, "type_oid" => type_oid} = json
    %Column{name: name, type_oid: type_oid}
  end

  defp save(state) do
    shapes = Map.new(list_shapes(state))
    relations = list_relations(state)

    PersistentKV.set(
      state.persistent_kv,
      key(state),
      %{
        shapes: shapes,
        relations: relations
      }
    )
  end

  defp load(state) do
    with {:ok, %{shapes: shapes, relations: relations}} <- load_shapes(state) do
      :ets.insert(
        state.shape_meta_table,
        Enum.concat([
          Enum.flat_map(shapes, fn {shape_id, shape} ->
            hash = Shape.hash(shape)

            [
              {{@shape_hash_lookup, hash}, shape_id},
              {{@shape_meta_data, shape_id}, shape, nil, LogOffset.first()}
            ]
          end),
          Enum.flat_map(relations, fn {relation_id, relation} ->
            [
              {{@relation_data, relation_id}, relation}
            ]
          end)
        ])
      )

      {:ok, state}
    end
  end

  defp load_shapes(state) do
    case PersistentKV.get(state.persistent_kv, key(state)) do
      {:ok, %{shapes: _shapes, relations: _relations} = data} ->
        {:ok, data}

      {:error, :not_found} ->
        {:ok, %{shapes: %{}, relations: %{}}}

      error ->
        error
    end
  end

  defp list_relations(%__MODULE__{shape_meta_table: meta_table}) do
    :ets.select(meta_table, [
      {
        {{@relation_data, :"$1"}, :"$2"},
        [true],
        [:"$2"]
      }
    ])
  end

  defp key(state) do
    Path.join(state.root, "shapes.json")
  end

  defp turn_raise_into_error(fun) do
    try do
      {:ok, fun.()}
    rescue
      ArgumentError ->
        :error
    end
  end
end
