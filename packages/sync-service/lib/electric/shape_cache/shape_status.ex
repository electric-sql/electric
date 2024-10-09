defmodule Electric.ShapeCache.ShapeStatusBehaviour do
  @moduledoc """
  Behaviour defining the ShapeStatus functions to be used in mocks
  """
  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Replication.LogOffset

  @type shape_id() :: Electric.ShapeCacheBehaviour.shape_id()
  @type xmin() :: Electric.ShapeCacheBehaviour.xmin()

  @callback initialise(ShapeStatus.options()) :: {:ok, ShapeStatus.t()} | {:error, term()}
  @callback list_shapes(ShapeStatus.t()) :: [{shape_id(), Shape.t()}]
  @callback get_existing_shape(ShapeStatus.t(), Shape.t() | shape_id()) ::
              {shape_id(), LogOffset.t()} | nil
  @callback add_shape(ShapeStatus.t(), Shape.t()) ::
              {:ok, shape_id()} | {:error, term()}
  @callback initialise_shape(ShapeStatus.t(), shape_id(), xmin(), LogOffset.t()) ::
              :ok
  @callback set_snapshot_xmin(ShapeStatus.t(), shape_id(), xmin()) :: :ok
  @callback set_latest_offset(ShapeStatus.t(), shape_id(), LogOffset.t()) :: :ok
  @callback mark_snapshot_started(ShapeStatus.t(), shape_id()) :: :ok
  @callback snapshot_started?(ShapeStatus.t(), shape_id()) :: boolean()
  @callback remove_shape(ShapeStatus.t(), shape_id()) ::
              {:ok, Shape.t()} | {:error, term()}
end

defmodule Electric.ShapeCache.ShapeStatus do
  @moduledoc """
  Keeps track of shape state.

  Can recover basic persisted shape metadata from shape storage to repopulate
  the in-memory cache.

  The shape cache then loads this and starts processes (storage and consumer)
  for each `{shape_id, %Shape{}}` pair. These then use their attached storage
  to recover the status information for the shape (snapshot xmin and latest
  offset).

  The ETS metadata table name is part of the config because we need to be able
  to access the data in the ETS from anywhere, so there's an internal api,
  using the full state and an external api using just the table name.
  """
  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.Storage
  alias Electric.Replication.LogOffset

  @schema NimbleOptions.new!(
            shape_meta_table: [type: {:or, [:atom, :reference]}, required: true],
            storage: [type: :mod_arg, required: true],
            root: [type: :string, default: "./shape_cache"]
          )

  defstruct [:root, :shape_meta_table, :storage]

  @type shape_id() :: Electric.ShapeCacheBehaviour.shape_id()
  @type xmin() :: Electric.ShapeCacheBehaviour.xmin()
  @type table() :: atom() | reference()
  @type t() :: %__MODULE__{
          root: String.t(),
          storage: Storage.storage(),
          shape_meta_table: table()
        }
  @type option() :: unquote(NimbleOptions.option_typespec(@schema))
  @type options() :: [option()]

  @shape_meta_data :shape_meta_data
  @shape_hash_lookup :shape_hash_lookup
  @shape_meta_shape_pos 2
  @shape_meta_xmin_pos 3
  @shape_meta_latest_offset_pos 4
  @snapshot_started :snapshot_started

  @spec initialise(options()) :: {:ok, t()} | {:error, term()}
  def initialise(opts) do
    with {:ok, config} <- NimbleOptions.validate(opts, @schema),
         {:ok, table_name} = Access.fetch(config, :shape_meta_table),
         {:ok, storage} = Access.fetch(config, :storage) do
      meta_table = :ets.new(table_name, [:named_table, :public, :ordered_set])

      state =
        struct(
          __MODULE__,
          Keyword.merge(config,
            shape_meta_table: meta_table,
            storage: storage
          )
        )

      load(state)
    end
  end

  @spec add_shape(t(), Shape.t()) :: {:ok, shape_id()} | {:error, term()}
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

    {:ok, shape_id}
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

      {:ok, shape}
    rescue
      # Sometimes we're calling cleanup when snapshot creation has failed for
      # some reason. In those cases we're not sure about the state of the ETS
      # keys, so we're doing our best to just delete everything without
      # crashing
      ArgumentError ->
        {:error, "No shape matching #{inspect(shape_id)}"}
    end
  end

  @spec get_existing_shape(t(), shape_id() | Shape.t()) :: nil | {shape_id(), LogOffset.t()}
  def get_existing_shape(%__MODULE__{shape_meta_table: table}, shape_or_id) do
    get_existing_shape(table, shape_or_id)
  end

  @spec get_existing_shape(table(), Shape.t()) :: nil | {shape_id(), LogOffset.t()}
  def get_existing_shape(meta_table, %Shape{} = shape) do
    hash = Shape.hash(shape)

    case :ets.select(meta_table, [{{{@shape_hash_lookup, hash}, :"$1"}, [true], [:"$1"]}]) do
      [] ->
        nil

      [shape_id] ->
        {shape_id, latest_offset!(meta_table, shape_id)}
    end
  end

  @spec get_existing_shape(table(), shape_id()) :: nil | {shape_id(), LogOffset.t()}
  def get_existing_shape(meta_table, shape_id) when is_binary(shape_id) do
    case :ets.lookup(meta_table, {@shape_meta_data, shape_id}) do
      [] -> nil
      [{_, _shape, _xmin, offset}] -> {shape_id, offset}
    end
  end

  @spec initialise_shape(t(), shape_id(), xmin(), LogOffset.t()) :: :ok
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

  def snapshot_started?(%__MODULE__{shape_meta_table: table} = _state, shape_id) do
    snapshot_started?(table, shape_id)
  end

  def snapshot_started?(meta_table, shape_id) do
    case :ets.lookup(meta_table, {@snapshot_started, shape_id}) do
      [] -> false
      [{{@snapshot_started, ^shape_id}, true}] -> true
    end
  end

  def mark_snapshot_started(%__MODULE__{shape_meta_table: table} = _state, shape_id) do
    :ets.insert(table, {{@snapshot_started, shape_id}, true})
    :ok
  end

  defp load(state) do
    with {:ok, shapes} <- Storage.get_all_stored_shapes(state.storage) do
      :ets.insert(
        state.shape_meta_table,
        Enum.concat([
          Enum.flat_map(shapes, fn {shape_id, shape} ->
            hash = Shape.hash(shape)

            [
              {{@shape_hash_lookup, hash}, shape_id},
              {{@shape_meta_data, shape_id}, shape, nil, LogOffset.first()}
            ]
          end)
        ])
      )

      {:ok, state}
    end
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
